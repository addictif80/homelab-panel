import { runSshCommand, shellQuote } from "../ssh";
import { lookupRuntimeCves, lookupPackageCves, type PackageRef, type CveMatch } from "./vulnDb";
import type { Finding, Severity } from "./types";

const PROBE_TIMEOUT_MS = 15_000;
const MANIFEST_TIMEOUT_MS = 20_000;
const MAX_MANIFESTS = 5;
const MAX_PACKAGES_PER_MANIFEST = 300;

type RuntimeProbe = {
  key: string;
  label: string;
  vendor: string;
  product: string;
  /** OS service name to offer restarting after an upgrade — omitted where restarting carries more
   * risk than it's worth offering automatically (OpenSSH: a bad config kills remote access). */
  service?: string;
};

const PHP_BINS = ["php", "php8.4", "php8.3", "php8.2", "php8.1", "php8.0", "php7.4", "php7.3"];

/** One SSH round trip probes every runtime this scan knows about, each line tagged so parsing
 * doesn't depend on output order or every tool actually being present — most hosts only have a
 * handful of these installed, and a probe for one that's missing contributes nothing. */
const PROBE_SCRIPT = [
  `for b in ${PHP_BINS.map(shellQuote).join(" ")}; do`,
  `  if command -v "$b" >/dev/null 2>&1; then echo "PHP_RAW:$b:$("$b" -v 2>&1 | head -1)"; break; fi`,
  `done`,
  `command -v node >/dev/null 2>&1 && echo "NODE_RAW:node:$(node -v 2>&1)"`,
  `command -v mysql >/dev/null 2>&1 && echo "MYSQL_RAW:mysql:$(mysql --version 2>&1)"`,
  `command -v nginx >/dev/null 2>&1 && echo "NGINX_RAW:nginx:$(nginx -v 2>&1)"`,
  `if command -v apache2 >/dev/null 2>&1; then echo "APACHE_RAW:apache2:$(apache2 -v 2>&1 | head -1)";`,
  `elif command -v httpd >/dev/null 2>&1; then echo "APACHE_RAW:httpd:$(httpd -v 2>&1 | head -1)"; fi`,
  `command -v ssh >/dev/null 2>&1 && echo "OPENSSH_RAW:ssh:$(ssh -V 2>&1)"`,
].join("\n");

export type DetectedRuntime = RuntimeProbe & { version: string; packageName: string };

function extractVersion(raw: string, regex: RegExp): string | null {
  const m = regex.exec(raw);
  return m ? m[1] : null;
}

/** Parses the probe script's tagged output into one entry per runtime actually found on the
 * host. The "binary" captured per line (e.g. `php8.2` vs bare `php`) doubles as a best guess at
 * the distro's own package name for it — right for Debian/Ubuntu/RHEL-family naming, which covers
 * the overwhelming majority of this panel's fleet; the fix step's own warning text says to verify
 * rather than silently assuming it's always exact. */
export async function detectRuntimeVersions(hostId: number): Promise<DetectedRuntime[]> {
  const { stdout } = await runSshCommand(hostId, PROBE_SCRIPT, { timeoutMs: PROBE_TIMEOUT_MS });
  const runtimes: DetectedRuntime[] = [];

  for (const line of stdout.split("\n")) {
    const m = /^(PHP|NODE|MYSQL|NGINX|APACHE|OPENSSH)_RAW:([^:]+):(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, tag, bin, raw] = m;

    if (tag === "PHP") {
      const version = extractVersion(raw, /PHP\s+(\d+\.\d+\.\d+)/);
      if (version) runtimes.push({ key: "php", label: "PHP", vendor: "php", product: "php", service: undefined, version, packageName: bin });
    } else if (tag === "NODE") {
      const version = extractVersion(raw, /v?(\d+\.\d+\.\d+)/);
      if (version) runtimes.push({ key: "node", label: "Node.js", vendor: "nodejs", product: "node.js", version, packageName: "nodejs" });
    } else if (tag === "MYSQL") {
      const isMariaDb = /MariaDB/i.test(raw);
      const version = isMariaDb ? extractVersion(raw, /(\d+\.\d+\.\d+)-MariaDB/i) : extractVersion(raw, /Ver\s+(\d+\.\d+\.\d+)/);
      if (version) {
        runtimes.push(
          isMariaDb
            ? { key: "mariadb", label: "MariaDB", vendor: "mariadb", product: "mariadb", service: "mariadb", version, packageName: "mariadb-server" }
            : { key: "mysql", label: "MySQL", vendor: "oracle", product: "mysql", service: "mysql", version, packageName: "mysql-server" }
        );
      }
    } else if (tag === "NGINX") {
      const version = extractVersion(raw, /nginx\/(\d+\.\d+\.\d+)/);
      if (version) runtimes.push({ key: "nginx", label: "nginx", vendor: "nginx", product: "nginx", service: "nginx", version, packageName: "nginx" });
    } else if (tag === "APACHE") {
      const version = extractVersion(raw, /Apache\/(\d+\.\d+\.\d+)/);
      if (version) runtimes.push({ key: "apache", label: "Apache", vendor: "apache", product: "http_server", service: bin, version, packageName: bin });
    } else if (tag === "OPENSSH") {
      const version = extractVersion(raw, /OpenSSH_(\d+\.\d+)/);
      // No .0 patch component in OpenSSH's own version string (just "9.6") — NVD's CPE dictionary
      // for openssh is keyed the same way, so this isn't padded to x.y.0 here.
      if (version) runtimes.push({ key: "openssh", label: "OpenSSH", vendor: "openbsd", product: "openssh", version, packageName: "openssh-server" });
    }
  }
  return runtimes;
}

type ManifestKind = "composer" | "npm";
type Manifest = { kind: ManifestKind; path: string; dir: string; packages: { name: string; version: string }[] };

const FIND_MANIFESTS_CMD = [
  `find /var/www /home /srv /opt -maxdepth 6 \\( -name composer.lock -o -name package-lock.json \\)`,
  `-not -path '*/node_modules/*' -not -path '*/vendor/*' 2>/dev/null | head -${MAX_MANIFESTS}`,
].join(" ");

function parseComposerLock(raw: string): { name: string; version: string }[] {
  try {
    const data = JSON.parse(raw) as { packages?: { name: string; version: string }[] };
    return (data.packages ?? []).map((p) => ({ name: p.name, version: p.version.replace(/^v/, "") })).slice(0, MAX_PACKAGES_PER_MANIFEST);
  } catch {
    return [];
  }
}

function parseNpmLock(raw: string): { name: string; version: string }[] {
  try {
    const data = JSON.parse(raw) as {
      lockfileVersion?: number;
      packages?: Record<string, { version?: string }>;
      dependencies?: Record<string, { version?: string }>;
    };
    const out: { name: string; version: string }[] = [];
    if (data.packages) {
      // lockfile v2/v3 — a flat map of every install path (including transitive deps), keyed like
      // "node_modules/foo" or "node_modules/foo/node_modules/bar". Scanning every entry (not just
      // top-level) is deliberate: a transitive dependency's CVE is just as real as a direct one.
      for (const [path, info] of Object.entries(data.packages)) {
        const idx = path.lastIndexOf("node_modules/");
        if (idx === -1 || !info.version) continue;
        out.push({ name: path.slice(idx + "node_modules/".length), version: info.version });
      }
    } else if (data.dependencies) {
      // lockfile v1 (npm < 7) — only the top-level tree is read; nested .dependencies aren't
      // recursed into here, a reasonable scope limit for a legacy format most hosts won't have.
      for (const [name, info] of Object.entries(data.dependencies)) {
        if (info.version) out.push({ name, version: info.version });
      }
    }
    return out.slice(0, MAX_PACKAGES_PER_MANIFEST);
  } catch {
    return [];
  }
}

/** Finds composer.lock/package-lock.json under common web roots and reads each one — this is
 * deliberately panel-agnostic (no dependency on CyberPanel or any other hosting panel's own site
 * registry) so it works the same whether sites are managed by CyberPanel, CloudPanel, or by hand. */
export async function findPackageManifests(hostId: number): Promise<Manifest[]> {
  const { stdout: pathsOut } = await runSshCommand(hostId, FIND_MANIFESTS_CMD, { timeoutMs: MANIFEST_TIMEOUT_MS, sudo: true });
  const paths = pathsOut.split("\n").map((p) => p.trim()).filter(Boolean);

  const manifests: Manifest[] = [];
  for (const path of paths) {
    const { stdout: raw, code } = await runSshCommand(hostId, `cat ${shellQuote(path)}`, { timeoutMs: MANIFEST_TIMEOUT_MS, sudo: true });
    if (code !== 0 || !raw.trim()) continue;
    const dir = path.replace(/\/(composer\.lock|package-lock\.json)$/, "");
    const kind: ManifestKind = path.endsWith("composer.lock") ? "composer" : "npm";
    const packages = kind === "composer" ? parseComposerLock(raw) : parseNpmLock(raw);
    if (packages.length > 0) manifests.push({ kind, path, dir, packages });
  }
  return manifests;
}

function cvssSeverity(cve: CveMatch): Severity {
  return cve.severity === "critical" ? "critical" : "warning";
}

function formatCveDetail(cve: CveMatch, extra?: string): string {
  const score = cve.cvssScore ? ` (score CVSS ${cve.cvssScore})` : "";
  return `${cve.summary || "Pas de description disponible."}${score}${extra ? `\n${extra}` : ""}\n${cve.url}`;
}

/**
 * Known-vulnerability scan for one host — combines two independent checks, same best-effort
 * convention as every other category in scan.ts (a failure in one never blocks the other, or the
 * rest of the host's scan):
 *  - runtime binaries (PHP, Node, MySQL/MariaDB, nginx, Apache, OpenSSH) matched against NVD by
 *    CPE, offering a one-click OS package upgrade — the same class of fix `apply-updates` already
 *    offers, so held to the same "safe enough for one click" bar.
 *  - composer.lock/package-lock.json application dependencies matched against OSV.dev — given
 *    only as a `howTo` command, never a one-click button: bumping an arbitrary app dependency can
 *    break a running site in a way an OS package upgrade usually doesn't, so this stops short of
 *    offering to run it unattended.
 */
export async function vulnerabilityFindings(hostId: number): Promise<Finding[]> {
  const findings: Finding[] = [];

  const runtimes = await detectRuntimeVersions(hostId).catch(() => []);
  for (const rt of runtimes) {
    const cves = await lookupRuntimeCves(rt.vendor, rt.product, rt.version).catch(() => []);
    for (const cve of cves) {
      findings.push({
        id: `vuln-runtime-${rt.key}-${cve.id}`,
        category: "vulnerability",
        severity: cvssSeverity(cve),
        title: `${rt.label} ${rt.version} : ${cve.id}`,
        detail: formatCveDetail(cve),
        fixId: "upgrade-runtime-package",
        fixLabel: `Mettre à jour ${rt.label}`,
        fixWarning: `Lance une mise à jour du paquet "${rt.packageName}" via le gestionnaire de paquets du système${
          rt.service ? ` et redémarre le service ${rt.service}` : ""
        }. Vérifie après coup que le paquet mis à jour correspond bien à ${rt.label} sur cette distribution.`,
        fixParams: { pkg: rt.packageName, service: rt.service ?? "" },
        howTo: [`Mets à jour ${rt.label} vers une version corrigée via le gestionnaire de paquets de cette machine, ou manuellement si ${rt.label} n'est pas installé depuis un dépôt système.`],
      });
    }
  }

  const manifests = await findPackageManifests(hostId).catch(() => []);
  for (const manifest of manifests) {
    const refs: PackageRef[] = manifest.packages.map((p) => ({
      ecosystem: manifest.kind === "composer" ? "Packagist" : "npm",
      name: p.name,
      version: p.version,
    }));
    const cveMap = await lookupPackageCves(refs).catch(() => new Map<string, CveMatch[]>());
    for (const pkg of manifest.packages) {
      const cves = cveMap.get(`${pkg.name}@${pkg.version}`) ?? [];
      for (const cve of cves) {
        findings.push({
          id: `vuln-pkg-${manifest.path}-${pkg.name}-${cve.id}`,
          category: "vulnerability",
          severity: cvssSeverity(cve),
          title: `${pkg.name} ${pkg.version} (${manifest.kind === "composer" ? "Composer" : "npm"}) : ${cve.id}`,
          detail: formatCveDetail(cve, `Fichier : ${manifest.path}`),
          howTo: [
            manifest.kind === "composer"
              ? `cd ${manifest.dir} && composer update ${shellQuote(pkg.name)} --with-all-dependencies`
              : `cd ${manifest.dir} && npm update ${shellQuote(pkg.name)}`,
          ],
        });
      }
    }
  }

  return findings;
}
