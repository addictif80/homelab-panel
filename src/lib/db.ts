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
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','viewer')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trusted_devices (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trusted_devices_username ON trusted_devices(username);

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
      router_provider TEXT,
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

    CREATE TABLE IF NOT EXISTS license (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','activated')),
      trial_started_at TEXT NOT NULL DEFAULT (datetime('now')),
      activation_key TEXT,
      activated_at TEXT,
      certificate_json TEXT
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      stripe_session_id TEXT UNIQUE NOT NULL,
      customer_email TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS download_tokens (
      token TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS license_signing_key (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      public_key_pem TEXT NOT NULL,
      private_key_pem_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS license_keys (
      key TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      used_at TEXT,
      used_by_info TEXT
    );

    CREATE TABLE IF NOT EXISTS security_ignored (
      finding_key TEXT PRIMARY KEY,
      host_id INTEGER NOT NULL,
      finding_id TEXT NOT NULL,
      ignored_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS maintenance_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host_ids_json TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'apply' CHECK (mode IN ('dry-run','apply')),
      allow_auto_reboot INTEGER NOT NULL DEFAULT 0,
      delay_seconds INTEGER NOT NULL DEFAULT 60,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS maintenance_runs (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES maintenance_plans(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      current_index INTEGER NOT NULL DEFAULT 0,
      job_ids_json TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_maintenance_runs_plan ON maintenance_runs(plan_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS releases (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      changelog TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS self_update_jobs (
      id TEXT PRIMARY KEY,
      from_version TEXT NOT NULL,
      to_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      log TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Trial clock starts the instant the database is first created — not on some later "first
  // visit", which would let someone stall the countdown by just not opening the app.
  db.exec(`INSERT OR IGNORE INTO license (id, status) VALUES (1, 'trial')`);

  const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  if (!userColumns.some((c) => c.name === "role")) {
    // Existing installs only ever had one account — the person who set the panel up — so it
    // keeps full access on upgrade rather than being silently downgraded to viewer.
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'`);
  }

  const hostColumns = db.prepare(`PRAGMA table_info(hosts)`).all() as { name: string }[];
  if (!hostColumns.some((c) => c.name === "needs_sudo")) {
    db.exec(`ALTER TABLE hosts ADD COLUMN needs_sudo INTEGER NOT NULL DEFAULT 1`);
  }
  if (!hostColumns.some((c) => c.name === "proxmox_node")) {
    db.exec(`ALTER TABLE hosts ADD COLUMN proxmox_node TEXT`);
  }
  if (!hostColumns.some((c) => c.name === "router_provider")) {
    db.exec(`ALTER TABLE hosts ADD COLUMN router_provider TEXT`);
  }

  const licenseColumns = db.prepare(`PRAGMA table_info(license)`).all() as { name: string }[];
  if (!licenseColumns.some((c) => c.name === "certificate_json")) {
    db.exec(`ALTER TABLE license ADD COLUMN certificate_json TEXT`);
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
