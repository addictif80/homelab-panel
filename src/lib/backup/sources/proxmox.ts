import { runSshCommand, runSshCommandStreaming, shellQuote } from "../../ssh";

export type ProxmoxVmBackupConfig = { vmid: number; vmType: "qemu" | "lxc" };

/**
 * Runs vzdump on the Proxmox node itself (must be executed there — it isn't reachable through
 * the API for arbitrary transfer) and hands back the resulting archive as a plain path, which
 * then flows through the same rsync engine as any other backup source.
 *
 * Needs enough free space on the node's local disk for the dump before it gets shipped out.
 */
export async function dumpProxmoxVm(
  hostId: number,
  config: ProxmoxVmBackupConfig,
  append: (text: string) => void
): Promise<{ paths: string[]; cleanup: string }> {
  const vmid = Math.trunc(Number(config.vmid));
  if (!Number.isFinite(vmid) || vmid <= 0) throw new Error("Identifiant de VM/CT invalide.");

  const dumpDir = `/tmp/homelab-panel-vzdump-${vmid}-${Date.now()}`;
  await runSshCommand(hostId, `mkdir -p ${shellQuote(dumpDir)}`, { sudo: true });

  append(`Export vzdump de ${config.vmType === "lxc" ? "CT" : "VM"} ${vmid} (mode snapshot, compression zstd)...\n`);
  const cmd = `vzdump ${vmid} --mode snapshot --compress zstd --dumpdir ${shellQuote(dumpDir)}`;
  const code = await runSshCommandStreaming(hostId, cmd, append, { sudo: true });
  if (code !== 0) throw new Error("Échec de vzdump — voir le journal ci-dessus.");

  const listRes = await runSshCommand(hostId, `find ${shellQuote(dumpDir)} -maxdepth 1 -type f`, { sudo: true });
  const files = listRes.stdout.split("\n").filter(Boolean);
  if (files.length === 0) throw new Error("vzdump n'a produit aucun fichier exploitable.");

  return { paths: files, cleanup: `rm -rf ${shellQuote(dumpDir)}` };
}
