import { randomUUID } from "crypto";
import { runSshCommand, runSshCommandStreaming, shellQuote } from "../../ssh";
import { vaultDecrypt } from "../../crypto";

export type DatabaseBackupConfig = {
  containerId: string;
  engine: "mysql" | "postgres";
  user: string;
  /** Vault-encrypted at rest — this isn't a login credential shared with anything else. */
  passwordEncrypted: string;
  databases: "all" | string[];
};

export async function dumpDatabase(
  hostId: number,
  config: DatabaseBackupConfig,
  append: (text: string) => void
): Promise<{ paths: string[]; cleanup: string }> {
  const password = vaultDecrypt(config.passwordEncrypted);
  const dumpDir = `/tmp/homelab-panel-dbdump-${randomUUID()}`;
  await runSshCommand(hostId, `mkdir -p ${shellQuote(dumpDir)}`, { sudo: true });

  const dumps: string[] = [];

  if (config.engine === "mysql") {
    const file = `${dumpDir}/mysql-dump.sql.gz`;
    const targetArgs = config.databases === "all" ? "--all-databases" : config.databases.map(shellQuote).join(" ");
    const cmd = `set -o pipefail; docker exec -e MYSQL_PWD=${shellQuote(password)} ${shellQuote(config.containerId)} mysqldump -u ${shellQuote(config.user)} ${targetArgs} | gzip > ${shellQuote(file)}`;
    append(`Export MySQL/MariaDB (${config.databases === "all" ? "toutes les bases" : config.databases.join(", ")})...\n`);
    const code = await runSshCommandStreaming(hostId, cmd, append, { sudo: true });
    if (code !== 0) throw new Error("Échec du mysqldump — voir le journal ci-dessus.");
    dumps.push(file);
  } else if (config.databases === "all") {
    const file = `${dumpDir}/postgres-all.sql.gz`;
    const cmd = `set -o pipefail; docker exec -e PGPASSWORD=${shellQuote(password)} ${shellQuote(config.containerId)} pg_dumpall -U ${shellQuote(config.user)} | gzip > ${shellQuote(file)}`;
    append(`Export PostgreSQL (toutes les bases)...\n`);
    const code = await runSshCommandStreaming(hostId, cmd, append, { sudo: true });
    if (code !== 0) throw new Error("Échec du pg_dumpall — voir le journal ci-dessus.");
    dumps.push(file);
  } else {
    for (const db of config.databases) {
      const file = `${dumpDir}/postgres-${db}.sql.gz`;
      const cmd = `set -o pipefail; docker exec -e PGPASSWORD=${shellQuote(password)} ${shellQuote(config.containerId)} pg_dump -U ${shellQuote(config.user)} ${shellQuote(db)} | gzip > ${shellQuote(file)}`;
      append(`Export PostgreSQL (${db})...\n`);
      const code = await runSshCommandStreaming(hostId, cmd, append, { sudo: true });
      if (code !== 0) throw new Error(`Échec du pg_dump pour ${db} — voir le journal ci-dessus.`);
      dumps.push(file);
    }
  }

  return { paths: dumps, cleanup: `rm -rf ${shellQuote(dumpDir)}` };
}
