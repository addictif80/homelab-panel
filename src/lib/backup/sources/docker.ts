import { runSshCommand, shellQuote } from "../../ssh";

export type DockerBackupConfig = { containerIds: string[] };

type Mount = { Type: string; Name?: string; Source: string; Destination: string };
type Inspect = { Name: string; Mounts: Mount[] };

/**
 * Resolves each selected container down to plain filesystem paths: the host-side directory of
 * every named volume it uses, plus a `docker inspect` dump saved alongside it (so a restore has
 * enough to reconstruct how the container was run, even without a docker-compose.yml on disk).
 * These paths then flow through the same rsync engine as a plain "paths" backup.
 */
export async function resolveDockerPaths(
  hostId: number,
  config: DockerBackupConfig,
  append: (text: string) => void
): Promise<{ paths: string[]; cleanup: string }> {
  const paths: string[] = [];
  const cleanupFiles: string[] = [];

  for (const id of config.containerIds) {
    const inspectRes = await runSshCommand(hostId, `docker inspect ${shellQuote(id)}`, { sudo: true });
    if (inspectRes.code !== 0) {
      append(`Conteneur ${id} introuvable, ignoré.\n`);
      continue;
    }
    const [info] = JSON.parse(inspectRes.stdout) as Inspect[];
    const volumeMounts = (info.Mounts ?? []).filter((m) => m.Type === "volume");
    for (const m of volumeMounts) {
      paths.push(m.Source);
      append(`Volume ${m.Name} (${m.Source}) inclus pour ${info.Name}.\n`);
    }
    if (volumeMounts.length === 0) {
      append(`${info.Name} n'utilise aucun volume nommé (bind mounts hors périmètre, à sauvegarder via "Dossiers/fichiers").\n`);
    }

    const dumpPath = `/tmp/homelab-panel-inspect-${id}.json`;
    const dumpRes = await runSshCommand(hostId, `docker inspect ${shellQuote(id)} > ${shellQuote(dumpPath)}`, {
      sudo: true,
    });
    if (dumpRes.code === 0) {
      paths.push(dumpPath);
      cleanupFiles.push(dumpPath);
    }
  }

  return { paths, cleanup: cleanupFiles.map((f) => `rm -f ${shellQuote(f)}`).join(" ; ") };
}
