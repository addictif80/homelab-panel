import { runSshCommand, runSshCommandStreaming, shellQuote } from "./ssh";
import { rsyncTransfer } from "./backup/transfer";
import { dumpProxmoxVm } from "./backup/sources/proxmox";
import { migrateVm as migrateVmOnCluster } from "./proxmox";

export type VmMigrationResult = { method: "cluster"; upid: string } | { method: "dump-restore" };

/**
 * Tries Proxmox's own cluster migration first — it moves everything (disks, config) on Proxmox's
 * own side, live if requested, and is simply the right tool when both nodes belong to the same
 * cluster. Any error from that call (Proxmox rejects it outright when the nodes aren't clustered)
 * falls back to an export/import path built from the same vzdump + rsync-over-SSH pieces the
 * backup engine already uses: dump the VM/CT on the source, ship the archive to the destination,
 * restore it there under a (possibly new) VMID. That path is inherently offline — the source is
 * stopped for the vzdump snapshot — since there's no live-migration mechanism between two
 * unrelated Proxmox instances.
 */
export async function migrateVm(
  sourceHostId: number,
  sourceNode: string,
  type: "qemu" | "lxc",
  vmid: number,
  destHostId: number,
  destNode: string,
  opts: { newVmid?: number; storage?: string; online?: boolean },
  append: (text: string) => void
): Promise<VmMigrationResult> {
  try {
    append(`Tentative de migration native Proxmox (nœuds du même cluster) vers ${destNode}...\n`);
    const upid = await migrateVmOnCluster(sourceHostId, sourceNode, type, vmid, destNode, {
      online: opts.online,
      withLocalDisks: true,
    });
    append(`Migration lancée côté Proxmox (tâche ${upid}).\n`);
    return { method: "cluster", upid };
  } catch (err) {
    append(
      `Migration native impossible (${err instanceof Error ? err.message : "erreur"}) — nœuds probablement non clusterisés.\n`
    );
    append("Repli sur export/import (vzdump + restauration)...\n");
  }

  const newVmid = opts.newVmid ?? vmid;
  const { paths, cleanup } = await dumpProxmoxVm(sourceHostId, { vmid, vmType: type }, append);
  const dumpFile = paths[0];
  const destDir = `/tmp/homelab-panel-vmrestore-${Date.now()}`;
  await rsyncTransfer({ fromHostId: sourceHostId, toHostId: destHostId, sourcePath: dumpFile, destDir, append });
  const remoteFile = `${destDir}/${dumpFile.split("/").pop()}`;

  append(`Restauration sur la destination (VMID ${newVmid})...\n`);
  const storageArg = opts.storage ? ` --storage ${shellQuote(opts.storage)}` : "";
  const restoreCmd =
    type === "qemu"
      ? `qmrestore ${shellQuote(remoteFile)} ${newVmid} --force 1${storageArg}`
      : `pct restore ${newVmid} ${shellQuote(remoteFile)} --force${storageArg}`;
  const code = await runSshCommandStreaming(destHostId, restoreCmd, append, { sudo: true });
  if (code !== 0) throw new Error("Échec de la restauration sur la destination — voir le journal ci-dessus.");

  await runSshCommand(sourceHostId, cleanup, { sudo: true }).catch(() => {});
  await runSshCommand(destHostId, `rm -rf ${shellQuote(destDir)}`, { sudo: true }).catch(() => {});

  append("\nMigration (export/import) terminée avec succès.\n");
  return { method: "dump-restore" };
}
