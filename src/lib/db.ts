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
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('ssh_key','ssh_password','api_token')),
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

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function logAudit(action: string, target?: string, detail?: string) {
  getDb()
    .prepare(`INSERT INTO audit_log (action, target, detail) VALUES (?, ?, ?)`)
    .run(action, target ?? null, detail ?? null);
}
