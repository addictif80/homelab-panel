import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
if (!fs.existsSync(/* turbopackIgnore: true */ DATA_DIR)) {
  fs.mkdirSync(/* turbopackIgnore: true */ DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "panel.db");

declare global {
  // eslint-disable-next-line no-var
  var __homelabDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (!global.__homelabDb) {
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
    global.__homelabDb = db;
    // Lazy import avoids a circular dependency (seed.ts calls back into getDb()).
    require("./seed").seedIfEmpty();
  }
  return global.__homelabDb;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      totp_secret_encrypted TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      username TEXT,
      success INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('physical','vm','lxc','vps','nas','router')),
      role TEXT,
      os TEXT,
      cluster TEXT,
      parent_host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
      lan_ip TEXT,
      tailscale_ip TEXT,
      public_ip TEXT,
      ssh_port INTEGER DEFAULT 22,
      ssh_user TEXT,
      docker_enabled INTEGER NOT NULL DEFAULT 0,
      update_method TEXT,
      needs_sudo INTEGER NOT NULL DEFAULT 1,
      proxmox_node TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('ssh_key','ssh_password','sudo_password','api_token')),
      label TEXT,
      encrypted_data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS network_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_a_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      host_b_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL DEFAULT 'network'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS update_jobs (
      id TEXT PRIMARY KEY,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK (mode IN ('dry-run','apply')),
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      log TEXT NOT NULL DEFAULT '',
      exit_code INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_update_jobs_host ON update_jobs(host_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS notified_findings (
      finding_key TEXT PRIMARY KEY,
      last_notified_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS copy_jobs (
      id TEXT PRIMARY KEY,
      source_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL,
      dest_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      dest_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      log TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS backup_ssh_key (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      public_key TEXT NOT NULL,
      private_key_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS backup_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('paths','docker','database','proxmox_vm')),
      source_config TEXT NOT NULL,
      dest_host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      dest_path TEXT NOT NULL,
      schedule TEXT NOT NULL DEFAULT 'manual' CHECK (schedule IN ('manual','hourly','daily','weekly')),
      retention_count INTEGER NOT NULL DEFAULT 7,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS backup_runs (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES backup_plans(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      log TEXT NOT NULL DEFAULT '',
      snapshot_path TEXT,
      paths_json TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_backup_runs_plan ON backup_runs(plan_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS security_ignored (
      finding_key TEXT PRIMARY KEY,
      host_id INTEGER NOT NULL,
      finding_id TEXT NOT NULL,
      ignored_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const hostColumns = db.prepare(`PRAGMA table_info(hosts)`).all() as { name: string }[];
  if (!hostColumns.some((c) => c.name === "needs_sudo")) {
    db.exec(`ALTER TABLE hosts ADD COLUMN needs_sudo INTEGER NOT NULL DEFAULT 1`);
  }
  if (!hostColumns.some((c) => c.name === "proxmox_node")) {
    db.exec(`ALTER TABLE hosts ADD COLUMN proxmox_node TEXT`);
  }
}

export function logAudit(action: string, target?: string, detail?: string) {
  getDb()
    .prepare(`INSERT INTO audit_log (action, target, detail) VALUES (?, ?, ?)`)
    .run(action, target ?? null, detail ?? null);
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .run(key, value);
}
