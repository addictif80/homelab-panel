import { runSql, quoteIdentifier, quoteLiteral, type DbConnection } from "./sqlRunner";
import { describeTable, type ColumnInfo } from "./schema";

export type BrowseResult = { columns: ColumnInfo[]; rows: (string | null)[][]; total: number };

const PAGE_SIZE = 100;

export async function browseTable(
  conn: DbConnection,
  database: string,
  table: string,
  page = 0
): Promise<BrowseResult> {
  const columns = await describeTable(conn, database, table);
  const ident = quoteIdentifier(conn.engine, table);

  const countResult = await runSql(conn, `SELECT COUNT(*) FROM ${ident};`, database);
  const total = parseInt((countResult.rows[0]?.[0] as string) ?? "0", 10);

  const dataResult = await runSql(
    conn,
    `SELECT * FROM ${ident} LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE};`,
    database
  );
  return { columns, rows: dataResult.rows, total };
}

function valueSql(conn: DbConnection, value: string | null): string {
  return value === null ? "NULL" : quoteLiteral(conn.engine, value);
}

function whereFromPrimaryKey(conn: DbConnection, pk: Record<string, string | null>): string {
  const clauses = Object.entries(pk).map(([col, val]) => {
    const ident = quoteIdentifier(conn.engine, col);
    return val === null ? `${ident} IS NULL` : `${ident} = ${quoteLiteral(conn.engine, val)}`;
  });
  if (clauses.length === 0) throw new Error("Impossible d'identifier la ligne (aucune clé primaire).");
  return clauses.join(" AND ");
}

export async function insertRow(
  conn: DbConnection,
  database: string,
  table: string,
  values: Record<string, string | null>
): Promise<void> {
  const columns = Object.keys(values);
  if (columns.length === 0) throw new Error("Aucune valeur à insérer.");
  const sql = `INSERT INTO ${quoteIdentifier(conn.engine, table)} (${columns
    .map((c) => quoteIdentifier(conn.engine, c))
    .join(", ")}) VALUES (${columns.map((c) => valueSql(conn, values[c])).join(", ")});`;
  await runSql(conn, sql, database);
}

/** `primaryKey` is the row's key column(s)/value(s) as read back from browseTable — required, so
 * an edit always targets exactly the row it was opened from rather than a WHERE built from
 * possibly-changed values. A table with no primary key can be browsed but not edited from here. */
export async function updateRow(
  conn: DbConnection,
  database: string,
  table: string,
  primaryKey: Record<string, string | null>,
  values: Record<string, string | null>
): Promise<void> {
  const columns = Object.keys(values);
  if (columns.length === 0) return;
  const setClause = columns.map((c) => `${quoteIdentifier(conn.engine, c)} = ${valueSql(conn, values[c])}`).join(", ");
  const sql = `UPDATE ${quoteIdentifier(conn.engine, table)} SET ${setClause} WHERE ${whereFromPrimaryKey(conn, primaryKey)};`;
  await runSql(conn, sql, database);
}

export async function deleteRow(
  conn: DbConnection,
  database: string,
  table: string,
  primaryKey: Record<string, string | null>
): Promise<void> {
  const sql = `DELETE FROM ${quoteIdentifier(conn.engine, table)} WHERE ${whereFromPrimaryKey(conn, primaryKey)};`;
  await runSql(conn, sql, database);
}
