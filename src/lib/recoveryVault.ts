import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { getDb } from "./db";

/**
 * Everything needed to reconstruct the panel's working configuration on a fresh install:
 * inventory, credentials (still vault-encrypted under VAULT_MASTER_KEY inside their own fields —
 * this snapshot doesn't decrypt them individually, see below), topology, backup plans, and every
 * integration setting (SMTP, notification channels, DNS/NPM/Tailscale/Proxmox tokens, seller
 * config...), since all of those live in the generic `settings` table. Deliberately excludes
 * accounts/sessions (restoring someone else's password hash would lock the admin out of their own
 * fresh install) and purely operational/audit history (job logs, pulse history, dismissed
 * findings, license/sales records) that isn't "configuration" to rebuild from.
 *
 * Because `credentials` rows and several `settings` values are still encrypted with this
 * install's VAULT_MASTER_KEY + vault_kdf_salt (also included, in `settings`) rather than
 * decrypted here, restoring this snapshot onto a machine that also has the *original*
 * VAULT_MASTER_KEY (a .env secret, deliberately never bundled into this export) recovers
 * everything; restoring without it recovers the inventory and topology, but individual secrets
 * stay undecryptable — an intentional trade-off, not a bug: a disaster-recovery file is never a
 * safer place for the master key than wherever the user already keeps it.
 */
const EXCLUDED_TABLES = new Set([
  "users",
  "trusted_devices",
  "login_attempts",
  "update_jobs",
  "copy_jobs",
  "backup_runs",
  "maintenance_runs",
  "self_update_jobs",
  "audit_log",
  "pulse_history",
  "security_ignored",
  "blocked_ips",
  "notified_findings",
  "download_tokens",
  "license",
  "license_signing_key",
  "license_keys",
  "sales",
  "key_recovery_orders",
  "trial_fingerprints",
  "support_tickets",
  "support_ticket_messages",
  "releases",
  "sqlite_sequence",
]);

function listIncludedTables(): string[] {
  const rows = getDb().prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[];
  return rows.map((r) => r.name).filter((name) => !EXCLUDED_TABLES.has(name));
}

export type ConfigSnapshot = Record<string, Record<string, unknown>[]>;

export function buildConfigSnapshot(): ConfigSnapshot {
  const db = getDb();
  const snapshot: ConfigSnapshot = {};
  for (const table of listIncludedTables()) {
    snapshot[table] = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  }
  return snapshot;
}

export type RestoreSummary = { table: string; rows: number }[];

/**
 * Table names are checked against the live schema (never trusted from the uploaded snapshot
 * alone), and column names are filtered against each table's actual columns via PRAGMA
 * table_info — both closes off SQL injection through a crafted snapshot file, since every
 * identifier interpolated into a query is drawn from the database's own metadata, never directly
 * from parsed JSON.
 */
export function restoreConfigSnapshot(snapshot: ConfigSnapshot): RestoreSummary {
  const db = getDb();
  const validTables = new Set(listIncludedTables());
  const summary: RestoreSummary = [];

  const apply = db.transaction(() => {
    for (const [table, rows] of Object.entries(snapshot)) {
      if (!validTables.has(table)) continue;
      if (!Array.isArray(rows) || rows.length === 0) {
        summary.push({ table, rows: 0 });
        continue;
      }
      const validColumns = new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
      );
      const columns = Object.keys(rows[0]).filter((c) => validColumns.has(c));
      if (columns.length === 0) {
        summary.push({ table, rows: 0 });
        continue;
      }
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
      );
      for (const row of rows) {
        stmt.run(...columns.map((c) => (row as Record<string, unknown>)[c] ?? null));
      }
      summary.push({ table, rows: rows.length });
    }
  });
  apply();

  return summary;
}

export type VaultEnvelope = {
  version: 1;
  createdAt: string;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
};

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32);
}

/** AES-256-GCM: the auth tag makes tampering detectable on decrypt (an attacker can't hand-edit
 * an exported vault file and have it accepted), which is the practical guarantee "signed" was
 * getting at in the original request — a real digital signature would add nothing here since
 * there's no separate signer/verifier key pair, only the one passphrase. */
export function encryptSnapshot(passphrase: string, snapshot: ConfigSnapshot): VaultEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(snapshot), "utf8")), cipher.final()]);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptSnapshot(passphrase: string, envelope: VaultEnvelope): ConfigSnapshot {
  const key = deriveKey(passphrase, Buffer.from(envelope.salt, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as ConfigSnapshot;
}
