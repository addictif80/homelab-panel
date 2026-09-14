import { runSshCommand, shellQuote } from "../../ssh";
import { buildConfigSnapshot } from "../../recoveryVault";

export type PanelConfigBackupConfig = Record<string, never>;

/**
 * Unlike the other source types, there's nothing to read off the source host's filesystem —
 * the data lives in the panel's own live database. This writes a fresh JSON snapshot straight to
 * the chosen host over the same SSH connection everything else in this backup uses (inline
 * base64, since there's no existing "write file content" SSH helper to reuse), then hands the
 * resulting path to the normal rsync-snapshot pipeline like any other source.
 */
export async function dumpPanelConfig(
  sourceHostId: number,
  _config: PanelConfigBackupConfig,
  append: (text: string) => void
): Promise<{ paths: string[]; cleanup: string }> {
  append("Génération de l'instantané de configuration du panel...\n");
  const snapshot = buildConfigSnapshot();
  const json = JSON.stringify(snapshot);
  const remotePath = `/tmp/homelab-panel-config-${Date.now()}.json`;
  const b64 = Buffer.from(json, "utf8").toString("base64");

  const { code, stderr } = await runSshCommand(
    sourceHostId,
    `printf '%s' ${shellQuote(b64)} | base64 -d > ${shellQuote(remotePath)}`
  );
  if (code !== 0) throw new Error(stderr.trim() || "Échec de l'écriture de l'instantané de configuration.");

  return { paths: [remotePath], cleanup: `rm -f ${shellQuote(remotePath)}` };
}
