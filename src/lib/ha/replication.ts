import { randomUUID, randomBytes } from "crypto";
import { getDb } from "../db";
import { vaultEncrypt, vaultDecrypt } from "../crypto";

export type ReplicationKind = "folder" | "mysql" | "postgres" | "sqlite";
export type ReplicationStatus = "unknown" | "setting_up" | "in_sync" | "lagging" | "error" | "stopped";

export type Replication = {
  id: string;
  name: string;
  kind: ReplicationKind;
  sourceHostId: number;
  targetHostId: number;
  sourcePath: string;
  targetPath: string;
  dbPort: number | null;
  dbUser: string | null;
  hasDbPassword: boolean;
  /** mysql/postgres only — admin credential for the target host, when different from the
   * source's. Null means "same as dbUser/dbPassword" (see resolveTargetCredential below). */
  targetDbUser: string | null;
  hasTargetDbPassword: boolean;
  replUser: string | null;
  proxyHostId: number | null;
  targetPort: number | null;
  targetOwner: string | null;
  targetMode: string | null;
  appDbUser: string | null;
  hasAppDbPassword: boolean;
  /** 'mysql' only — when set, every admin SQL command on the target host routes through
   * `docker exec -i <container>` instead of a direct network connection to a native client. For a
   * target whose MariaDB only exists inside a Docker container (no mysql/mariadb client on the
   * host OS itself). Null keeps the original native-client behavior. */
  targetDbContainer: string | null;
  enabled: boolean;
  status: ReplicationStatus;
  statusDetail: string | null;
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
};

/** Only used internally (setup/status scripts need the real secrets) — never returned from the
 * public listing/get functions above, same treatment as every other vault-encrypted credential in
 * this panel (SSH keys, SMTP passwords...). */
export type ReplicationSecrets = {
  dbPassword: string | null;
  targetDbPassword: string | null;
  replPassword: string | null;
  appDbPassword: string | null;
};

/** The credential to use for admin operations on the *target* host: the dedicated target
 * credential when one was set, otherwise the same source credential — preserves the original
 * "one admin login, valid on both machines" behavior for anyone who never needed to change it. */
export function resolveTargetCredential(
  r: Pick<Replication, "dbUser" | "targetDbUser">,
  secrets: Pick<ReplicationSecrets, "dbPassword" | "targetDbPassword">
): { user: string | null; password: string | null } {
  return {
    user: r.targetDbUser || r.dbUser,
    password: secrets.targetDbPassword || secrets.dbPassword,
  };
}

type ReplicationRow = {
  id: string;
  name: string;
  kind: ReplicationKind;
  source_host_id: number;
  target_host_id: number;
  source_path: string;
  target_path: string;
  db_port: number | null;
  db_user: string | null;
  db_password_encrypted: string | null;
  target_db_user: string | null;
  target_db_password_encrypted: string | null;
  repl_user: string | null;
  repl_password_encrypted: string | null;
  proxy_host_id: number | null;
  target_port: number | null;
  target_owner: string | null;
  target_mode: string | null;
  app_db_user: string | null;
  app_db_password_encrypted: string | null;
  target_db_container: string | null;
  enabled: number;
  status: ReplicationStatus;
  status_detail: string | null;
  last_checked_at: string | null;
  last_synced_at: string | null;
  created_at: string;
};

function rowToReplication(row: ReplicationRow): Replication {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    sourceHostId: row.source_host_id,
    targetHostId: row.target_host_id,
    sourcePath: row.source_path,
    targetPath: row.target_path,
    dbPort: row.db_port,
    dbUser: row.db_user,
    hasDbPassword: !!row.db_password_encrypted,
    targetDbUser: row.target_db_user,
    hasTargetDbPassword: !!row.target_db_password_encrypted,
    replUser: row.repl_user,
    proxyHostId: row.proxy_host_id,
    targetPort: row.target_port,
    targetOwner: row.target_owner,
    targetMode: row.target_mode,
    appDbUser: row.app_db_user,
    hasAppDbPassword: !!row.app_db_password_encrypted,
    targetDbContainer: row.target_db_container,
    enabled: row.enabled === 1,
    status: row.status,
    statusDetail: row.status_detail,
    lastCheckedAt: row.last_checked_at,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
  };
}

export function listReplications(): Replication[] {
  return (getDb().prepare(`SELECT * FROM ha_replications ORDER BY created_at`).all() as ReplicationRow[]).map(
    rowToReplication
  );
}

export function getReplication(id: string): Replication | null {
  const row = getDb().prepare(`SELECT * FROM ha_replications WHERE id = ?`).get(id) as ReplicationRow | undefined;
  return row ? rowToReplication(row) : null;
}

/** The decrypted secrets for one replication — for internal use by the setup/status scripts only. */
export function getReplicationSecrets(id: string): ReplicationSecrets {
  const row = getDb()
    .prepare(
      `SELECT db_password_encrypted, target_db_password_encrypted, repl_password_encrypted, app_db_password_encrypted FROM ha_replications WHERE id = ?`
    )
    .get(id) as
    | {
        db_password_encrypted: string | null;
        target_db_password_encrypted: string | null;
        repl_password_encrypted: string | null;
        app_db_password_encrypted: string | null;
      }
    | undefined;
  return {
    dbPassword: row?.db_password_encrypted ? vaultDecrypt(row.db_password_encrypted) : null,
    targetDbPassword: row?.target_db_password_encrypted ? vaultDecrypt(row.target_db_password_encrypted) : null,
    replPassword: row?.repl_password_encrypted ? vaultDecrypt(row.repl_password_encrypted) : null,
    appDbPassword: row?.app_db_password_encrypted ? vaultDecrypt(row.app_db_password_encrypted) : null,
  };
}

export type CreateReplicationInput = {
  name: string;
  kind: ReplicationKind;
  sourceHostId: number;
  targetHostId: number;
  sourcePath: string;
  targetPath: string;
  dbPort?: number;
  dbUser?: string;
  dbPassword?: string;
  /** mysql/postgres only — admin credential for the target host, when it differs from the
   * source's. Left unset (or blank), the source credential is reused for the target too. */
  targetDbUser?: string;
  targetDbPassword?: string;
  /** NPM proxy host (lib/npm.ts) this replication backs — when set, a successful setup run wires
   * the target host straight into that proxy host's failover config automatically. */
  proxyHostId?: number;
  /** Port the app listens on at the target, if different from the proxy host's own forward port
   * (the common case — same app, same port — needs nothing here). */
  targetPort?: number;
  /** 'folder'/'sqlite' only — passed to rsync's --chown so files land on B already owned by
   * whatever account runs the web server there (e.g. "www-data:www-data"), not by the dedicated
   * SSH account that actually performs the transfer. */
  targetOwner?: string;
  /** 'folder'/'sqlite' only — passed to rsync's --chmod (e.g. "D755,F644"). */
  targetMode?: string;
  /** 'mysql' only — the application's own database login, created/updated on the target with the
   * same password so it can connect there after a failover (separate from dbUser/dbPassword, the
   * admin credential used only during setup). PostgreSQL needs no equivalent: pg_basebackup
   * clones roles along with everything else. */
  appDbUser?: string;
  appDbPassword?: string;
  /** 'mysql' only — Docker container name on the target host to run admin SQL through
   * (`docker exec`) instead of a native client. Left unset for a target with a native install. */
  targetDbContainer?: string;
};

export function createReplication(input: CreateReplicationInput): Replication {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO ha_replications (id, name, kind, source_host_id, target_host_id, source_path, target_path, db_port, db_user, db_password_encrypted, target_db_user, target_db_password_encrypted, proxy_host_id, target_port, target_owner, target_mode, app_db_user, app_db_password_encrypted, target_db_container)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name.trim(),
      input.kind,
      input.sourceHostId,
      input.targetHostId,
      input.sourcePath.trim(),
      input.targetPath.trim(),
      input.dbPort ?? null,
      input.dbUser?.trim() || null,
      input.dbPassword ? vaultEncrypt(input.dbPassword) : null,
      input.targetDbUser?.trim() || null,
      input.targetDbPassword ? vaultEncrypt(input.targetDbPassword) : null,
      input.proxyHostId ?? null,
      input.targetPort ?? null,
      input.targetOwner?.trim() || null,
      input.targetMode?.trim() || null,
      input.appDbUser?.trim() || null,
      input.appDbPassword ? vaultEncrypt(input.appDbPassword) : null,
      input.targetDbContainer?.trim() || null
    );
  return getReplication(id)!;
}

export function deleteReplication(id: string): void {
  getDb().prepare(`DELETE FROM ha_replications WHERE id = ?`).run(id);
}

export function setReplicationEnabled(id: string, enabled: boolean): void {
  getDb().prepare(`UPDATE ha_replications SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
}

export function setReplicationFailoverLink(id: string, proxyHostId: number | null, targetPort: number | null): void {
  getDb()
    .prepare(`UPDATE ha_replications SET proxy_host_id = ?, target_port = ? WHERE id = ?`)
    .run(proxyHostId, targetPort, id);
}

/** A short, random, narrowly-scoped credential this panel generates itself for the dedicated
 * replication role — never the same as the admin credential supplied for setup, so a leak of one
 * doesn't hand over the other. */
export function generateReplicationCredential(prefix: string): { user: string; password: string } {
  return {
    user: `${prefix}_${randomBytes(3).toString("hex")}`,
    password: randomBytes(24).toString("base64url"),
  };
}

export function setReplicationCredential(id: string, user: string, password: string): void {
  getDb()
    .prepare(`UPDATE ha_replications SET repl_user = ?, repl_password_encrypted = ? WHERE id = ?`)
    .run(user, vaultEncrypt(password), id);
}

export function updateReplicationStatus(
  id: string,
  status: ReplicationStatus,
  detail: string | null,
  markSynced = false
): void {
  getDb()
    .prepare(
      `UPDATE ha_replications SET status = ?, status_detail = ?, last_checked_at = datetime('now')${
        markSynced ? ", last_synced_at = datetime('now')" : ""
      } WHERE id = ?`
    )
    .run(status, detail, id);
}
