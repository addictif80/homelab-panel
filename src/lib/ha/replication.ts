import { randomUUID, randomBytes } from "crypto";
import { getDb } from "../db";
import { vaultEncrypt, vaultDecrypt } from "../crypto";

export type ReplicationKind = "folder" | "mysql" | "postgres" | "sqlite";
export type ReplicationStatus = "unknown" | "setting_up" | "in_sync" | "lagging" | "error" | "stopped";
/** 'folder' only — see provisioning.ts for what each preset actually runs. */
export type ProvisionPreset = "docker_lemp" | "apache_native" | "nginx_native" | "custom";

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
  /** 'folder' only — when true, the target-side rsync process runs through `sudo rsync` instead of
   * directly, needed on hosting-panel-managed targets (CyberPanel, cPanel...) where each site is
   * isolated under its own dedicated system account and the shared replication account has no
   * direct access — and often no root SSH login either. Requires a passwordless sudoers rule for
   * rsync on the target for that account, set up manually (this panel won't touch sudoers itself). */
  targetNeedsSudo: boolean;
  /** 'folder' only — a fixed daily time ("HH:MM", 24h) for a scheduled rsync pass instead of
   * continuous lsyncd. Null (the default) keeps the original continuous behavior. */
  syncScheduleTime: string | null;
  appDbUser: string | null;
  hasAppDbPassword: boolean;
  /** 'mysql' only — when set, every admin SQL command on the target host routes through
   * `docker exec -i <container>` instead of a direct network connection to a native client. For a
   * target whose MariaDB only exists inside a Docker container (no mysql/mariadb client on the
   * host OS itself). Null keeps the original native-client behavior. */
  targetDbContainer: string | null;
  /** 'mysql' only — same as targetDbContainer, but for the source host: when set, the binlog
   * config, replication role and initial dump are all issued through `docker exec` into this
   * container instead of a native client/service on the source host itself. */
  sourceDbContainer: string | null;
  /** 'folder' only — see provisioning.ts. Null (the default) skips web-server provisioning on the
   * target entirely, unchanged behavior for every replication created before this existed. */
  provisionPreset: ProvisionPreset | null;
  provisionDomain: string | null;
  provisionPhpVersion: string | null;
  /** Only meaningful for provisionPreset === "custom" — the raw command template for every other
   * preset is built in provisioning.ts, not stored here. */
  provisionCommand: string | null;
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
  target_needs_sudo: number;
  sync_schedule_time: string | null;
  app_db_user: string | null;
  app_db_password_encrypted: string | null;
  target_db_container: string | null;
  source_db_container: string | null;
  provision_preset: ProvisionPreset | null;
  provision_domain: string | null;
  provision_php_version: string | null;
  provision_command: string | null;
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
    targetNeedsSudo: row.target_needs_sudo === 1,
    syncScheduleTime: row.sync_schedule_time,
    appDbUser: row.app_db_user,
    hasAppDbPassword: !!row.app_db_password_encrypted,
    targetDbContainer: row.target_db_container,
    sourceDbContainer: row.source_db_container,
    provisionPreset: row.provision_preset,
    provisionDomain: row.provision_domain,
    provisionPhpVersion: row.provision_php_version,
    provisionCommand: row.provision_command,
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
  /** 'folder' only — run the target-side rsync through sudo (see Replication.targetNeedsSudo). */
  targetNeedsSudo?: boolean;
  /** 'folder' only — see Replication.syncScheduleTime. Unset/empty keeps continuous lsyncd. */
  syncScheduleTime?: string;
  /** 'mysql' only — the application's own database login, created/updated on the target with the
   * same password so it can connect there after a failover (separate from dbUser/dbPassword, the
   * admin credential used only during setup). PostgreSQL needs no equivalent: pg_basebackup
   * clones roles along with everything else. */
  appDbUser?: string;
  appDbPassword?: string;
  /** 'mysql' only — Docker container name on the target host to run admin SQL through
   * (`docker exec`) instead of a native client. Left unset for a target with a native install. */
  targetDbContainer?: string;
  /** 'mysql' only — same as targetDbContainer, but for the source host. */
  sourceDbContainer?: string;
  /** 'folder' only — see Replication.provisionPreset. */
  provisionPreset?: ProvisionPreset;
  provisionDomain?: string;
  provisionPhpVersion?: string;
  provisionCommand?: string;
};

export function createReplication(input: CreateReplicationInput): Replication {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO ha_replications (id, name, kind, source_host_id, target_host_id, source_path, target_path, db_port, db_user, db_password_encrypted, target_db_user, target_db_password_encrypted, proxy_host_id, target_port, target_owner, target_mode, target_needs_sudo, sync_schedule_time, app_db_user, app_db_password_encrypted, target_db_container, source_db_container, provision_preset, provision_domain, provision_php_version, provision_command)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      input.targetNeedsSudo ? 1 : 0,
      input.syncScheduleTime?.trim() || null,
      input.appDbUser?.trim() || null,
      input.appDbPassword ? vaultEncrypt(input.appDbPassword) : null,
      input.targetDbContainer?.trim() || null,
      input.sourceDbContainer?.trim() || null,
      input.provisionPreset || null,
      input.provisionDomain?.trim() || null,
      input.provisionPhpVersion?.trim() || null,
      input.provisionCommand?.trim() || null
    );
  return getReplication(id)!;
}

export function deleteReplication(id: string): void {
  getDb().prepare(`DELETE FROM ha_replications WHERE id = ?`).run(id);
}

/** Creates a second, independent replication with the same settings as an existing one — the
 * common case being "same target/credentials, different source path or database" for a new
 * site/database that needs the same kind of protection. Copies every setting *except* the
 * failover wiring (proxyHostId/targetPort): that's tied to one specific NPM redirection's backup
 * slot, and blindly duplicating it would point two unrelated replications at the same slot, which
 * makes no sense — the user wires failover deliberately for the new one if it applies. The copy
 * starts fully unconfigured (status "unknown", no replication-role credential yet) since it's a
 * brand new replication as far as its target machine is concerned, even though its *admin*
 * credentials are pre-filled from the original. */
export function duplicateReplication(id: string): Replication | null {
  const original = getReplication(id);
  if (!original) return null;
  const secrets = getReplicationSecrets(id);
  return createReplication({
    name: `${original.name} (copie)`,
    kind: original.kind,
    sourceHostId: original.sourceHostId,
    targetHostId: original.targetHostId,
    sourcePath: original.sourcePath,
    targetPath: original.targetPath,
    dbPort: original.dbPort ?? undefined,
    dbUser: original.dbUser ?? undefined,
    dbPassword: secrets.dbPassword ?? undefined,
    targetDbUser: original.targetDbUser ?? undefined,
    targetDbPassword: secrets.targetDbPassword ?? undefined,
    targetOwner: original.targetOwner ?? undefined,
    targetMode: original.targetMode ?? undefined,
    targetNeedsSudo: original.targetNeedsSudo,
    syncScheduleTime: original.syncScheduleTime ?? undefined,
    appDbUser: original.appDbUser ?? undefined,
    appDbPassword: secrets.appDbPassword ?? undefined,
    targetDbContainer: original.targetDbContainer ?? undefined,
    sourceDbContainer: original.sourceDbContainer ?? undefined,
    provisionPreset: original.provisionPreset ?? undefined,
    provisionDomain: original.provisionDomain ?? undefined,
    provisionPhpVersion: original.provisionPhpVersion ?? undefined,
    provisionCommand: original.provisionCommand ?? undefined,
  });
}

export function setReplicationEnabled(id: string, enabled: boolean): void {
  getDb().prepare(`UPDATE ha_replications SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
}

/** Everything about a replication *except* kind/sourceHostId/targetHostId can be edited after
 * creation — those three drive which SSH keys/dirs were provisioned and on which machines, so
 * changing them means a genuinely different replication, not an edit of this one (delete and
 * recreate instead). A password field left unset keeps whatever's already stored — same convention
 * as every other credential-edit form in this panel, so leaving a password blank while fixing an
 * unrelated typo doesn't wipe it out. */
export type UpdateReplicationInput = {
  name?: string;
  sourcePath?: string;
  targetPath?: string;
  dbPort?: number | null;
  dbUser?: string | null;
  dbPassword?: string;
  targetDbUser?: string | null;
  targetDbPassword?: string;
  targetOwner?: string | null;
  targetMode?: string | null;
  targetNeedsSudo?: boolean;
  /** 'folder' only — see Replication.syncScheduleTime. Empty string clears it back to continuous. */
  syncScheduleTime?: string | null;
  appDbUser?: string | null;
  appDbPassword?: string;
  targetDbContainer?: string | null;
  sourceDbContainer?: string | null;
  /** 'folder' only — see Replication.provisionPreset. Empty string clears it back to "no
   * provisioning". */
  provisionPreset?: ProvisionPreset | null;
  provisionDomain?: string | null;
  provisionPhpVersion?: string | null;
  provisionCommand?: string | null;
};

/** `undefined` on any field here means "leave as stored" — only fields the caller actually
 * included in the PATCH body are touched, everything else keeps its current row value. Reads the
 * row directly (rather than through getReplication/getReplicationSecrets) since it needs the raw
 * encrypted password columns to preserve them untouched. */
export function updateReplication(id: string, input: UpdateReplicationInput): void {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM ha_replications WHERE id = ?`).get(id) as ReplicationRow | undefined;
  if (!row) return;

  db.prepare(
    `UPDATE ha_replications SET
       name = ?, source_path = ?, target_path = ?, db_port = ?, db_user = ?, db_password_encrypted = ?,
       target_db_user = ?, target_db_password_encrypted = ?, target_owner = ?, target_mode = ?, target_needs_sudo = ?,
       sync_schedule_time = ?, app_db_user = ?, app_db_password_encrypted = ?, target_db_container = ?, source_db_container = ?,
       provision_preset = ?, provision_domain = ?, provision_php_version = ?, provision_command = ?
     WHERE id = ?`
  ).run(
    input.name !== undefined ? input.name.trim() : row.name,
    input.sourcePath !== undefined ? input.sourcePath.trim() : row.source_path,
    input.targetPath !== undefined ? input.targetPath.trim() : row.target_path,
    input.dbPort !== undefined ? input.dbPort : row.db_port,
    input.dbUser !== undefined ? input.dbUser?.trim() || null : row.db_user,
    input.dbPassword ? vaultEncrypt(input.dbPassword) : row.db_password_encrypted,
    input.targetDbUser !== undefined ? input.targetDbUser?.trim() || null : row.target_db_user,
    input.targetDbPassword ? vaultEncrypt(input.targetDbPassword) : row.target_db_password_encrypted,
    input.targetOwner !== undefined ? input.targetOwner?.trim() || null : row.target_owner,
    input.targetMode !== undefined ? input.targetMode?.trim() || null : row.target_mode,
    input.targetNeedsSudo !== undefined ? (input.targetNeedsSudo ? 1 : 0) : row.target_needs_sudo,
    input.syncScheduleTime !== undefined ? input.syncScheduleTime?.trim() || null : row.sync_schedule_time,
    input.appDbUser !== undefined ? input.appDbUser?.trim() || null : row.app_db_user,
    input.appDbPassword ? vaultEncrypt(input.appDbPassword) : row.app_db_password_encrypted,
    input.targetDbContainer !== undefined ? input.targetDbContainer?.trim() || null : row.target_db_container,
    input.sourceDbContainer !== undefined ? input.sourceDbContainer?.trim() || null : row.source_db_container,
    input.provisionPreset !== undefined ? input.provisionPreset || null : row.provision_preset,
    input.provisionDomain !== undefined ? input.provisionDomain?.trim() || null : row.provision_domain,
    input.provisionPhpVersion !== undefined ? input.provisionPhpVersion?.trim() || null : row.provision_php_version,
    input.provisionCommand !== undefined ? input.provisionCommand?.trim() || null : row.provision_command,
    id
  );
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
