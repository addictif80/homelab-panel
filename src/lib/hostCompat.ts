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

const INSTALL_COMMANDS: Record<PackageManager, (pkg: string) => string> = {
  apt: (pkg) => `apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${shellQuote(pkg)}`,
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
  const { code, stderr } = await runSshCommand(hostId, INSTALL_COMMANDS[manager](packageName), {
    sudo: true,
    timeoutMs: 120_000,
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
