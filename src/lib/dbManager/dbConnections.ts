import { randomUUID } from "crypto";
import { getDb } from "../db";
import { vaultEncrypt } from "../crypto";
import { getDbConnection, type DbConnection, type Engine } from "./sqlRunner";

export type { DbConnection };

export function listDbConnections(): Omit<DbConnection, "passwordEncrypted">[] {
  const rows = getDb()
    .prepare(`SELECT id, host_id, label, engine, container_id, db_host, db_port, username FROM db_connections ORDER BY label`)
    .all() as {
    id: string;
    host_id: number;
    label: string;
    engine: Engine;
    container_id: string | null;
    db_host: string;
    db_port: number;
    username: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    hostId: r.host_id,
    label: r.label,
    engine: r.engine,
    containerId: r.container_id,
    dbHost: r.db_host,
    dbPort: r.db_port,
    username: r.username,
  }));
}

export function addDbConnection(input: {
  hostId: number;
  label: string;
  engine: Engine;
  containerId: string | null;
  dbHost: string;
  dbPort: number;
  username: string;
  password: string;
}): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO db_connections (id, host_id, label, engine, container_id, db_host, db_port, username, password_encrypted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.hostId,
      input.label.trim(),
      input.engine,
      input.containerId?.trim() || null,
      input.dbHost.trim() || "127.0.0.1",
      input.dbPort,
      input.username.trim(),
      vaultEncrypt(input.password)
    );
  return id;
}

export function deleteDbConnection(id: string): void {
  getDb().prepare(`DELETE FROM db_connections WHERE id = ?`).run(id);
}

export { getDbConnection };
