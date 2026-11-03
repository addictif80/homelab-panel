import type { Client as SshClient, ClientChannel } from "ssh2";
import { runSshCommand, shellQuote } from "../ssh";
import { vaultDecrypt } from "../crypto";
import { openPrivilegedExec, restoreCommand } from "../dbManager/dumpRestore";
import type { DbConnection } from "../dbManager/sqlRunner";

// CloudPanel's own backup layout, confirmed against a real export:
//   home/<site>/htdocs/<domain>/...              — the site's files
//   home/<site>/backups/databases/<db>/<date>/<db>_<ts>.sql.gz  — one dump per database
// Everything below assumes exactly this shape.

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function assertSafeName(value: string, label: string): void {
  if (!SAFE_NAME.test(value)) {
    throw new Error(`${label} contient des caractères non supportés (lettres, chiffres, "." "_" "-" uniquement) : "${value}".`);
  }
}

function tarPathFor(backupRoot: string, site: string): string {
  return `${backupRoot.replace(/\/$/, "")}/${site}/backup.tar`;
}

function incusWrap(containerId: string, innerCmd: string): string {
  return `incus exec ${shellQuote(containerId)} -- sh -c ${shellQuote(innerCmd)}`;
}

export type CloudPanelDatabaseDump = { db: string; date: string; file: string; memberPath: string };

export type CloudPanelSiteInfo = {
  domains: string[];
  databases: CloudPanelDatabaseDump[];
};

/** Lists every site folder under `backupRoot` that actually contains a `backup.tar` — a plain
 * POSIX-sh loop rather than `find -printf`, since Synology DSM's BusyBox/toybox find commonly
 * lacks it. */
export async function listCloudPanelSites(nasHostId: number, backupRoot: string): Promise<string[]> {
  const root = backupRoot.replace(/\/$/, "");
  const script = `for d in ${shellQuote(root)}/*/; do [ -f "$d/backup.tar" ] && basename "$d"; done`;
  const { stdout, code, stderr } = await runSshCommand(nasHostId, script, { sudo: true, timeoutMs: 30_000 });
  if (code !== 0) throw new Error(stderr.trim() || "Impossible de lister les sauvegardes.");
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Reads a site's `backup.tar` listing (without extracting anything) to find every domain under
 * `htdocs/` and every database dump under `backups/databases/` — what the restore UI needs to
 * offer a picker instead of asking the user to know CloudPanel's internal layout by heart. */
export async function inspectCloudPanelSite(nasHostId: number, backupRoot: string, site: string): Promise<CloudPanelSiteInfo> {
  assertSafeName(site, "Le nom du site");
  const tarPath = tarPathFor(backupRoot, site);
  const script =
    `tar -tf ${shellQuote(tarPath)} | awk -F/ '` +
    `$3=="htdocs" && NF>=4 && $4!="" {print "DOMAIN:" $4} ` +
    `$3=="backups" && $4=="databases" && NF>=7 {print "DB:" $5"|"$6"|"$7}` +
    `' | sort -u`;
  const { stdout, code, stderr } = await runSshCommand(nasHostId, script, { sudo: true, timeoutMs: 60_000 });
  if (code !== 0) throw new Error(stderr.trim() || "Impossible de lire l'archive.");

  const domains = new Set<string>();
  const databases: CloudPanelDatabaseDump[] = [];
  for (const line of stdout.split("\n")) {
    if (line.startsWith("DOMAIN:")) {
      domains.add(line.slice("DOMAIN:".length).trim());
    } else if (line.startsWith("DB:")) {
      const [db, date, file] = line.slice("DB:".length).trim().split("|");
      if (db && date && file) databases.push({ db, date, file, memberPath: `home/${site}/backups/databases/${db}/${date}/${file}` });
    }
  }
  return { domains: [...domains].sort(), databases };
}

/** Relays bytes from `source`'s stdout straight into `dest`'s stdin, and only resolves once BOTH
 * sides have exited 0 — checking just `dest`'s exit code isn't enough: a `source` command that
 * fails before producing any output (a typo'd tar member path, say) would otherwise look like a
 * harmless empty transfer that "succeeded" at doing nothing. */
function relayChannels(source: ClientChannel, dest: ClientChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    let sourceStderr = "";
    let destStderr = "";
    let sourceCode: number | null = null;
    let destCode: number | null = null;
    let settled = false;

    const maybeFinish = () => {
      if (settled || destCode === null) return;
      if (sourceCode !== null && sourceCode !== 0) {
        settled = true;
        reject(new Error(sourceStderr.trim() || `La lecture de la sauvegarde a échoué (code ${sourceCode}).`));
        return;
      }
      if (destCode !== 0) {
        settled = true;
        reject(new Error(destStderr.trim() || `La restauration a échoué (code ${destCode}).`));
        return;
      }
      settled = true;
      resolve();
    };

    source.stderr.on("data", (d: Buffer) => (sourceStderr += d.toString("utf8")));
    dest.stderr.on("data", (d: Buffer) => (destStderr += d.toString("utf8")));
    source.on("close", (code: number) => {
      sourceCode = code;
      maybeFinish();
    });
    dest.on("close", (code: number) => {
      destCode = code;
      maybeFinish();
    });
    source.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      try {
        dest.end();
      } catch {
        // already closing
      }
      reject(err);
    });
    dest.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    source.pipe(dest);
  });
}

function endClients(...clients: SshClient[]): void {
  for (const c of clients) {
    try {
      c.end();
    } catch {
      // already closing
    }
  }
}

export type RestoreCloudPanelFilesOptions = {
  nasHostId: number;
  backupRoot: string;
  site: string;
  domain: string;
  targetHostId: number;
  targetContainerId: string;
  targetDomain: string;
  /** tar --exclude patterns, matched against the full archive path (e.g. "wp-content/debug.log" with a leading wildcard) */
  excludePatterns: string[];
  wipeFirst: boolean;
};

/**
 * Restores one domain's `htdocs/` files from a CloudPanel backup.tar into
 * `/home/<targetDomain>/public_html` on a CyberPanel instance running inside an Incus container —
 * entirely by relaying bytes between two live SSH connections (NAS -> this process -> target),
 * never writing the transfer to this panel's own disk.
 *
 * The NAS side re-packages just the matched subtree into a *fresh* tar stream (via a one-shot
 * scratch dir cleaned up in the same command) rather than using `tar -xf ... -O`, which only
 * dumps raw file bytes with no boundaries between files — fine for a single file (used for the
 * database dump below) but useless for a whole directory tree, since the receiving end would
 * have no way to tell where one file ends and the next begins.
 */
export async function restoreCloudPanelFiles(opts: RestoreCloudPanelFilesOptions): Promise<void> {
  assertSafeName(opts.site, "Le nom du site");
  assertSafeName(opts.domain, "Le domaine source");
  assertSafeName(opts.targetDomain, "Le domaine cible");

  const tarPath = tarPathFor(opts.backupRoot, opts.site);
  const targetPath = `/home/${opts.targetDomain}/public_html`;

  const existsRes = await runSshCommand(
    opts.targetHostId,
    incusWrap(opts.targetContainerId, `[ -d ${shellQuote(targetPath)} ] && echo yes || echo no`),
    { sudo: true, timeoutMs: 15_000 }
  );
  if (existsRes.stdout.trim() !== "yes") {
    throw new Error(`${targetPath} n'existe pas sur le conteneur — crée d'abord le site "${opts.targetDomain}" dans CyberPanel.`);
  }

  const ownerRes = await runSshCommand(
    opts.targetHostId,
    incusWrap(opts.targetContainerId, `stat -c '%U:%G' ${shellQuote(targetPath)} 2>/dev/null`),
    { sudo: true, timeoutMs: 15_000 }
  );
  const owner = ownerRes.code === 0 ? ownerRes.stdout.trim() : null;

  if (opts.wipeFirst) {
    const wipeRes = await runSshCommand(
      opts.targetHostId,
      incusWrap(opts.targetContainerId, `find ${shellQuote(targetPath)} -mindepth 1 -delete`),
      { sudo: true, timeoutMs: 180_000 }
    );
    if (wipeRes.code !== 0) throw new Error(wipeRes.stderr.trim() || "Échec du nettoyage du dossier cible.");
  }

  const excludeFlags = opts.excludePatterns.map((p) => shellQuote(`--exclude=${p}`)).join(" ");
  const wildcard = shellQuote(`home/${opts.site}/htdocs/${opts.domain}`);
  const nasScript =
    `D=$(mktemp -d) && ` +
    `tar -xf ${shellQuote(tarPath)} -C "$D" --wildcards ${wildcard} ${excludeFlags} && ` +
    `tar -cf - -C "$D/home/${opts.site}/htdocs/${opts.domain}" . ; RC=$?; rm -rf "$D"; exit $RC`;

  const { client: nasClient, channel: nasChannel } = await openPrivilegedExec(opts.nasHostId, nasScript);
  const { client: targetClient, channel: targetChannel } = await openPrivilegedExec(
    opts.targetHostId,
    incusWrap(opts.targetContainerId, `tar -xf - -C ${shellQuote(targetPath)}`)
  );

  try {
    await relayChannels(nasChannel, targetChannel);
  } finally {
    endClients(nasClient, targetClient);
  }

  if (owner) {
    await runSshCommand(
      opts.targetHostId,
      incusWrap(opts.targetContainerId, `chown -R ${shellQuote(owner)} ${shellQuote(targetPath)}`),
      { sudo: true, timeoutMs: 60_000 }
    );
  }
}

export type RestoreCloudPanelDatabaseOptions = {
  nasHostId: number;
  backupRoot: string;
  site: string;
  memberPath: string; // CloudPanelDatabaseDump.memberPath, the exact tar member to extract
  targetConn: DbConnection;
  targetDatabase: string;
};

/**
 * Restores one database dump from a CloudPanel backup.tar straight into an existing database on
 * the target connection (Docker or Incus, same as the regular DB Manager import) — again by
 * relaying bytes between two live SSH connections, decompressing on the target end via
 * `gunzip -c` so the gzip'd dump never touches this panel's own disk or memory as a whole blob.
 */
export async function restoreCloudPanelDatabase(opts: RestoreCloudPanelDatabaseOptions): Promise<void> {
  assertSafeName(opts.site, "Le nom du site");

  const tarPath = tarPathFor(opts.backupRoot, opts.site);
  const nasScript = `tar -xf ${shellQuote(tarPath)} -O ${shellQuote(opts.memberPath)}`;

  const password = vaultDecrypt(opts.targetConn.passwordEncrypted);
  const pipeline = `gunzip -c | ${restoreCommand(opts.targetConn, password, opts.targetDatabase)}`;
  const targetScript = `set -o pipefail; ${pipeline}`;

  const { client: nasClient, channel: nasChannel } = await openPrivilegedExec(opts.nasHostId, nasScript);
  const { client: targetClient, channel: targetChannel } = await openPrivilegedExec(opts.targetConn.hostId, targetScript);

  try {
    await relayChannels(nasChannel, targetChannel);
  } finally {
    endClients(nasClient, targetClient);
  }
}
