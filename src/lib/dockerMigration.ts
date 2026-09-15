import { runSshCommand, runSshCommandStreaming, shellQuote } from "./ssh";
import { rsyncTransfer } from "./backup/transfer";
import { inspectContainer, buildRunArgs } from "./docker";

/**
 * Moves a container to another host entirely: its image (via `docker save`/`docker load`, which
 * works for any image whether it's a public registry tag or a local-only build — a plain
 * `docker pull` on the destination would fail for the latter), and its actual data (bind-mounted
 * host directories and named volumes, copied byte-for-byte via the same rsync-over-SSH mechanism
 * the backup engine uses). The container is then recreated on the destination from the exact same
 * `docker inspect` configuration as the original — same ports, env, restart policy, network mode.
 */
export async function migrateContainer(
  sourceHostId: number,
  containerId: string,
  destHostId: number,
  removeSource: boolean,
  append: (text: string) => void
): Promise<void> {
  append("Inspection du conteneur source...\n");
  const info = await inspectContainer(sourceHostId, containerId);
  const image = info.Config.Image;
  const name = info.Name.replace(/^\//, "");

  const workDir = `/tmp/homelab-panel-migrate-${Date.now()}`;
  await runSshCommand(sourceHostId, `mkdir -p ${shellQuote(workDir)}`, { sudo: true });

  append(`Export de l'image ${image}...\n`);
  const imageFile = `${workDir}/image.tar.gz`;
  const saveCode = await runSshCommandStreaming(
    sourceHostId,
    `docker save ${shellQuote(image)} | gzip > ${shellQuote(imageFile)}`,
    append,
    { sudo: true }
  );
  if (saveCode !== 0) throw new Error("Échec de l'export de l'image — voir le journal ci-dessus.");

  append("Transfert de l'image vers la machine de destination...\n");
  await rsyncTransfer({ fromHostId: sourceHostId, toHostId: destHostId, sourcePath: imageFile, destDir: workDir, append });

  append("Chargement de l'image sur la destination...\n");
  const loadCode = await runSshCommandStreaming(
    destHostId,
    `gunzip -c ${shellQuote(`${workDir}/image.tar.gz`)} | docker load`,
    append,
    { sudo: true }
  );
  if (loadCode !== 0) throw new Error("Échec du chargement de l'image sur la destination.");

  for (const mount of info.Mounts ?? []) {
    if (mount.Type === "bind") {
      append(`Transfert du montage ${mount.Source}...\n`);
      const parent = mount.Source.replace(/\/[^/]*$/, "") || "/";
      await rsyncTransfer({ fromHostId: sourceHostId, toHostId: destHostId, sourcePath: mount.Source, destDir: parent, append });
    } else if (mount.Type === "volume" && mount.Name) {
      append(`Création et transfert du volume ${mount.Name}...\n`);
      await runSshCommand(destHostId, `docker volume create ${shellQuote(mount.Name)}`, { sudo: true });
      const destMountpointRes = await runSshCommand(
        destHostId,
        `docker volume inspect ${shellQuote(mount.Name)} --format '{{.Mountpoint}}'`,
        { sudo: true }
      );
      const destMountpoint = destMountpointRes.stdout.trim();
      if (!destMountpoint) throw new Error(`Impossible de localiser le volume ${mount.Name} sur la destination.`);
      // Trailing slash on the source: rsync copies the *contents* of the volume into the
      // already-created destination volume, rather than nesting it one level deeper.
      const sourceWithSlash = mount.Source.endsWith("/") ? mount.Source : `${mount.Source}/`;
      await rsyncTransfer({ fromHostId: sourceHostId, toHostId: destHostId, sourcePath: sourceWithSlash, destDir: destMountpoint, append });
    }
  }

  append("Démarrage du conteneur sur la destination...\n");
  const runCmd = `docker ${buildRunArgs(info, name, image).join(" ")}`;
  const runCode = await runSshCommandStreaming(destHostId, runCmd, append, { sudo: true });
  if (runCode !== 0) throw new Error("Échec du démarrage du conteneur sur la destination.");

  await runSshCommand(sourceHostId, `rm -rf ${shellQuote(workDir)}`, { sudo: true }).catch(() => {});
  await runSshCommand(destHostId, `rm -rf ${shellQuote(workDir)}`, { sudo: true }).catch(() => {});

  if (removeSource) {
    append("Suppression du conteneur source...\n");
    await runSshCommand(sourceHostId, `docker rm -f ${shellQuote(containerId)}`, { sudo: true });
  }

  append("\nMigration terminée avec succès.\n");
}
