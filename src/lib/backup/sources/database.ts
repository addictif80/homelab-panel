import { randomUUID } from "crypto";
import { runSshCommand, runSshCommandStreaming, shellQuote } from "../../ssh";
import { vaultDecrypt } from "../../crypto";

export type DatabaseBackupConfig = {
  /** "docker" (default, for plans saved before this field existed) runs the dump tool via
   * `docker exec` inside containerId; "native" runs it directly on the host's own shell, for a
   * database server installed straight on the OS (a common web-server setup: MySQL/Postgres from
   * the distro's package manager, no container involved). */
  deployment?: "docker" | "native";
  containerId?: string;
  engine: "mysql" | "postgres";
  user: string;
  /** Vault-encrypted at rest — this isn't a login credential shared with anything else. */
  passwordEncrypted: string;
  databases: "all" | string[];
};

/** Wraps a dump tool invocation for wherever the database server actually lives: inside a named
 * container (`docker exec`) or directly on the host's own shell — same command either way, just
 * without the docker indirection for a natively installed server. */
function wrapDbCommand(
  config: Pick<DatabaseBackupConfig, "deployment" | "containerId">,
  envAssignment: string,
  innerCommand: string
): string {
  if (config.deployment === "native") {
    return `${envAssignment} ${innerCommand}`;
  }
  if (!config.containerId) throw new Error("Conteneur de la base de données manquant pour ce plan.");
  return `docker exec -e ${envAssignment} ${shellQuote(config.containerId)} ${innerCommand}`;
}

export type DbConnectionParams = {
  deployment?: "docker" | "native";
  containerId?: string;
  engine: "mysql" | "postgres";
  user: string;
  password: string;
};

/** Connects with the given credentials and lists every database the server knows about, for the
 * "Tester la connexion" button in the plan editor — lets someone pick databases to back up by
 * name from a real list instead of typing them blind and finding out about a typo only when a
 * scheduled run fails at 3am. Throws with the raw tool error on a bad password/host/engine
 * mismatch, same as the real dump would. */
export async function listDatabases(hostId: number, params: DbConnectionParams): Promise<string[]> {
  const { engine, user, password, deployment, containerId } = params;

  if (engine === "mysql") {
    const cmd = wrapDbCommand(
      { deployment, containerId },
      `MYSQL_PWD=${shellQuote(password)}`,
      `mysql -u ${shellQuote(user)} -N -e ${shellQuote("SHOW DATABASES;")}`
    );
    const { stdout, stderr, code } = await runSshCommand(hostId, cmd, { sudo: true });
    if (code !== 0) throw new Error(stderr.trim() || "Connexion MySQL/MariaDB impossible.");
    return stdout.split("\n").map((l) => l.trim()).filter(Boolean).sort();
  }

  const cmd = wrapDbCommand(
    { deployment, containerId },
    `PGPASSWORD=${shellQuote(password)}`,
    `psql -U ${shellQuote(user)} -Atc ${shellQuote("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;")}`
  );
  const { stdout, stderr, code } = await runSshCommand(hostId, cmd, { sudo: true });
  if (code !== 0) throw new Error(stderr.trim() || "Connexion PostgreSQL impossible.");
  return stdout.split("\n").map((l) => l.trim()).filter(Boolean).sort();
}

export async function dumpDatabase(
  hostId: number,
  config: DatabaseBackupConfig,
  append: (text: string) => void
): Promise<{ paths: string[]; cleanup: string }> {
  const password = vaultDecrypt(config.passwordEncrypted);
  const dumpDir = `/tmp/homelab-panel-dbdump-${randomUUID()}`;
  await runSshCommand(hostId, `mkdir -p ${shellQuote(dumpDir)}`, { sudo: true });

  const dumps: string[] = [];
  const location = config.deployment === "native" ? "installée directement sur la machine" : "dans son conteneur Docker";

  if (config.engine === "mysql") {
    const file = `${dumpDir}/mysql-dump.sql.gz`;
    const targetArgs = config.databases === "all" ? "--all-databases" : config.databases.map(shellQuote).join(" ");
    const dumpCmd = wrapDbCommand(config, `MYSQL_PWD=${shellQuote(password)}`, `mysqldump -u ${shellQuote(config.user)} ${targetArgs}`);
    const cmd = `set -o pipefail; ${dumpCmd} | gzip > ${shellQuote(file)}`;
    append(`Export MySQL/MariaDB (${config.databases === "all" ? "toutes les bases" : config.databases.join(", ")}, ${location})...\n`);
    const code = await runSshCommandStreaming(hostId, cmd, append, { sudo: true });
    if (code !== 0) throw new Error("Échec du mysqldump — voir le journal ci-dessus.");
    dumps.push(file);
  } else if (config.databases === "all") {
    const file = `${dumpDir}/postgres-all.sql.gz`;
    const dumpCmd = wrapDbCommand(config, `PGPASSWORD=${shellQuote(password)}`, `pg_dumpall -U ${shellQuote(config.user)}`);
    const cmd = `set -o pipefail; ${dumpCmd} | gzip > ${shellQuote(file)}`;
    append(`Export PostgreSQL (toutes les bases, ${location})...\n`);
    const code = await runSshCommandStreaming(hostId, cmd, append, { sudo: true });
    if (code !== 0) throw new Error("Échec du pg_dumpall — voir le journal ci-dessus.");
    dumps.push(file);
  } else {
    for (const db of config.databases) {
      const file = `${dumpDir}/postgres-${db}.sql.gz`;
      const dumpCmd = wrapDbCommand(config, `PGPASSWORD=${shellQuote(password)}`, `pg_dump -U ${shellQuote(config.user)} ${shellQuote(db)}`);
      const cmd = `set -o pipefail; ${dumpCmd} | gzip > ${shellQuote(file)}`;
      append(`Export PostgreSQL (${db}, ${location})...\n`);
      const code = await runSshCommandStreaming(hostId, cmd, append, { sudo: true });
      if (code !== 0) throw new Error(`Échec du pg_dump pour ${db} — voir le journal ci-dessus.`);
      dumps.push(file);
    }
  }

  return { paths: dumps, cleanup: `rm -rf ${shellQuote(dumpDir)}` };
}
