import { runSshCommand, shellQuote } from "./ssh";

/**
 * This panel's HA/replication setup used to assume Debian/Ubuntu everywhere it touched a host
 * directly — `apt-get install`, `systemctl restart` — which works for the common case but silently
 * fails (or does nothing at all) on anything else: Alpine/OpenRC-based NAS firmwares, RHEL-family
 * distros, Arch, openSUSE, or a minimal appliance with no package manager at all. Detecting what's
 * actually there and adapting the command (rather than guessing once and hoping) is what makes the
 * HA module usable across the heterogeneous fleet this panel targets, not just Debian boxes.
 */

const DETECT_TIMEOUT_MS = 15_000;

type PackageManager = "apt" | "dnf" | "yum" | "apk" | "pacman" | "zypper";

const PACKAGE_MANAGER_BINS: [PackageManager, string][] = [
  ["apt", "apt-get"],
  ["dnf", "dnf"],
  ["yum", "yum"],
  ["apk", "apk"],
  ["pacman", "pacman"],
  ["zypper", "zypper"],
];

// dpkg/apt's own lock (/var/lib/dpkg/lock-frontend) is held for the whole duration of any other
// apt/dpkg run on the same machine — extremely common right after boot, since Ubuntu ships
// unattended-upgrades enabled by default and it can start an update run at any time, unpredictably,
// with no way for this panel to know in advance. Failing immediately on "Could not get lock" turns
// a transient, self-resolving condition into a hard error the user then has to notice and retry by
// hand — instead this waits and retries for a while, and only gives up (with a message that
// actually explains why) if the lock is still held well past when any normal unattended-upgrades
// run should have finished.
// `apt-get update` and `apt-get install` are retried as two *separate* phases, each with their
// own lock-wait loop — retrying them as a single combined command (as an earlier version of this
// script did) re-ran `apt-get update` on every single lock-retry iteration too, which on a host
// with a slow mirror or many sources can itself take long enough to blow through the overall SSH
// timeout well before the lock-wait budget is even exhausted. Separating them means `update` only
// ever runs again if it specifically was the one that hit the lock.
const APT_LOCK_RETRY_SCRIPT = (pkg: string) =>
  [
    `PKG=${shellQuote(pkg)}`,
    `retry_apt() {`,
    `  CMD="$1"`,
    `  i=0`,
    `  while [ "$i" -lt 25 ]; do`,
    // Single-quoted at the call site below, so $CMD holds the literal text (including the
    // embedded $PKG) — `eval` is what actually expands $PKG, at the time each attempt runs, not
    // the call site up front.
    `    OUT=$(eval "$CMD" 2>&1)`,
    `    CODE=$?`,
    `    [ "$CODE" -eq 0 ] && { echo "$OUT"; return 0; }`,
    `    if echo "$OUT" | grep -qiE "could not get lock|dpkg frontend lock|resource temporarily unavailable"; then`,
    `      i=$((i + 1))`,
    `      sleep 7`,
    `      continue`,
    `    fi`,
    `    echo "$OUT" >&2`,
    `    return "$CODE"`,
    `  done`,
    `  echo "apt/dpkg est resté verrouillé par un autre processus pendant plus de 3 minutes (unattended-upgrades ou une autre installation en cours) — réessaie dans quelques minutes." >&2`,
    `  return 1`,
    `}`,
    `retry_apt 'apt-get update -qq' || exit $?`,
    `retry_apt 'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$PKG"'`,
  ].join("\n");

const INSTALL_COMMANDS: Record<PackageManager, (pkg: string) => string> = {
  apt: APT_LOCK_RETRY_SCRIPT,
  dnf: (pkg) => `dnf install -y -q ${shellQuote(pkg)}`,
  yum: (pkg) => `yum install -y -q ${shellQuote(pkg)}`,
  apk: (pkg) => `apk add --no-cache ${shellQuote(pkg)}`,
  pacman: (pkg) => `pacman -Sy --noconfirm ${shellQuote(pkg)}`,
  zypper: (pkg) => `zypper --non-interactive install ${shellQuote(pkg)}`,
};

async function detectPackageManager(hostId: number): Promise<PackageManager | null> {
  for (const [manager, bin] of PACKAGE_MANAGER_BINS) {
    const { code } = await runSshCommand(hostId, `command -v ${bin}`, { timeoutMs: DETECT_TIMEOUT_MS });
    if (code === 0) return manager;
  }
  return null;
}

/** Installs `pkg` with whichever supported package manager is actually present on the host,
 * substituting `altNames[manager]` when that distro packages it under a different name. A host
 * with none of the recognized managers (a minimal/immutable appliance) gets a clear manual-install
 * message instead of silently doing nothing. */
export async function installPackageUniversal(
  hostId: number,
  pkg: string,
  altNames: Partial<Record<PackageManager, string>> = {}
): Promise<void> {
  const manager = await detectPackageManager(hostId);
  if (!manager) {
    throw new Error(
      `Aucun gestionnaire de paquets reconnu sur cette machine (apt, dnf, yum, apk, pacman, zypper) — installe ` +
        `${pkg} manuellement puis relance la configuration.`
    );
  }
  const packageName = altNames[manager] || pkg;
  // apt's own retry loop above can legitimately spend up to ~3 minutes waiting out a concurrent
  // unattended-upgrades run on *each* of its two phases (update, then install) — the timeout has
  // to comfortably outlast the worst case of both back to back, plus the actual update/install
  // work itself, not just one phase's wait budget.
  const { code, stderr } = await runSshCommand(hostId, INSTALL_COMMANDS[manager](packageName), {
    sudo: true,
    timeoutMs: manager === "apt" ? 600_000 : 120_000,
  });
  if (code !== 0) {
    throw new Error(
      stderr ||
        `Impossible d'installer ${packageName} automatiquement via ${manager} sur cette machine — installe-le ` +
          `manuellement puis relance la configuration.`
    );
  }
}

type ServiceManager = "systemd" | "openrc" | "sysvinit";

async function detectServiceManager(hostId: number): Promise<ServiceManager | null> {
  const { code: systemdCode } = await runSshCommand(hostId, "command -v systemctl", { timeoutMs: DETECT_TIMEOUT_MS });
  if (systemdCode === 0) return "systemd";
  const { code: openrcCode } = await runSshCommand(hostId, "command -v rc-service", { timeoutMs: DETECT_TIMEOUT_MS });
  if (openrcCode === 0) return "openrc";
  const { code: sysvCode } = await runSshCommand(hostId, "command -v service", { timeoutMs: DETECT_TIMEOUT_MS });
  if (sysvCode === 0) return "sysvinit";
  return null;
}

const NO_INIT_ERROR =
  "Aucun système d'init reconnu sur cette machine (systemd, OpenRC, SysV) — le service doit être géré manuellement.";

/** Enables (best-effort) and (re)starts `service` — tries systemd, then OpenRC (Alpine and many
 * router/NAS firmwares), then the generic SysV `service` wrapper, in that order, instead of
 * assuming systemd is always present. */
export async function restartService(hostId: number, service: string): Promise<{ code: number; stderr: string }> {
  const manager = await detectServiceManager(hostId);
  if (manager === "systemd") {
    return runSshCommand(
      hostId,
      `systemctl enable ${shellQuote(service)} >/dev/null 2>&1; systemctl restart ${shellQuote(service)}`,
      { sudo: true, timeoutMs: 60_000 }
    );
  }
  if (manager === "openrc") {
    return runSshCommand(
      hostId,
      `rc-update add ${shellQuote(service)} default >/dev/null 2>&1; rc-service ${shellQuote(service)} restart`,
      { sudo: true, timeoutMs: 60_000 }
    );
  }
  if (manager === "sysvinit") {
    return runSshCommand(hostId, `service ${shellQuote(service)} restart`, { sudo: true, timeoutMs: 60_000 });
  }
  return { code: 1, stderr: NO_INIT_ERROR };
}

/** Stops (and, best-effort, disables) `service` across the same three init systems. */
export async function stopService(hostId: number, service: string): Promise<{ code: number; stderr: string }> {
  const manager = await detectServiceManager(hostId);
  if (manager === "systemd") {
    return runSshCommand(
      hostId,
      `systemctl stop ${shellQuote(service)} 2>/dev/null; systemctl disable ${shellQuote(service)} 2>/dev/null; true`,
      { sudo: true, timeoutMs: 60_000 }
    );
  }
  if (manager === "openrc") {
    return runSshCommand(
      hostId,
      `rc-service ${shellQuote(service)} stop 2>/dev/null; rc-update del ${shellQuote(service)} default 2>/dev/null; true`,
      { sudo: true, timeoutMs: 60_000 }
    );
  }
  if (manager === "sysvinit") {
    return runSshCommand(hostId, `service ${shellQuote(service)} stop 2>/dev/null; true`, { sudo: true, timeoutMs: 60_000 });
  }
  return { code: 0, stderr: "" };
}

export async function serviceIsActive(hostId: number, service: string): Promise<{ active: boolean; raw: string }> {
  const manager = await detectServiceManager(hostId);
  if (manager === "systemd") {
    const { stdout } = await runSshCommand(hostId, `systemctl is-active ${shellQuote(service)} 2>&1`, {
      timeoutMs: DETECT_TIMEOUT_MS,
    });
    return { active: stdout.trim() === "active", raw: stdout.trim() };
  }
  if (manager === "openrc") {
    const { code, stdout } = await runSshCommand(hostId, `rc-service ${shellQuote(service)} status 2>&1`, {
      timeoutMs: DETECT_TIMEOUT_MS,
    });
    return { active: code === 0 && /started|running/i.test(stdout), raw: stdout.trim() };
  }
  if (manager === "sysvinit") {
    const { code, stdout } = await runSshCommand(hostId, `service ${shellQuote(service)} status 2>&1`, {
      timeoutMs: DETECT_TIMEOUT_MS,
    });
    return { active: code === 0 && /running/i.test(stdout), raw: stdout.trim() };
  }
  return { active: false, raw: NO_INIT_ERROR };
}

/** Best-effort extra context for a failed start/restart — a bare exit code from any of the above
 * says almost nothing on its own about *why* (a syntax error in a config just written, a missing
 * dependency, a crash loop). */
export async function diagnoseServiceFailure(hostId: number, service: string): Promise<string> {
  const manager = await detectServiceManager(hostId);
  if (manager === "systemd") {
    const { stdout } = await runSshCommand(
      hostId,
      `systemctl status ${shellQuote(service)} --no-pager -l 2>&1 | tail -n 15; journalctl -u ${shellQuote(service)} --no-pager -n 15 2>&1 | tail -n 15`,
      { sudo: true, timeoutMs: 15_000 }
    ).catch(() => ({ stdout: "" }));
    return stdout.trim();
  }
  if (manager === "openrc") {
    const { stdout } = await runSshCommand(
      hostId,
      `rc-service ${shellQuote(service)} status 2>&1`,
      { sudo: true, timeoutMs: 15_000 }
    ).catch(() => ({ stdout: "" }));
    return stdout.trim();
  }
  return "";
}
