import { getDb } from "./db";
import { runSshCommand } from "./ssh";
import { withTimeout } from "./timeout";
import { scanSingleHost } from "./security/scan";
import { applySecurityFix } from "./security/fixes";
import { blockIp, blockIpEverywhere } from "./firewall";

export type AiToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Sensitive tools change state on real infrastructure — the agent route never executes them
   * on its own; it returns them as pending confirmations for a human to approve or reject. */
  sensitive: boolean;
};

export const AI_TOOLS: AiToolDef[] = [
  {
    name: "list_hosts",
    description:
      "Liste toutes les machines de l'inventaire (id, nom, type, OS). À appeler en premier pour connaître les hostId avant d'utiliser les autres outils — n'invente jamais un hostId.",
    parameters: { type: "object", properties: {}, required: [] },
    sensitive: false,
  },
  {
    name: "get_security_findings",
    description:
      "Lance une analyse de sécurité en direct sur une machine (via SSH) et retourne la liste de ses problèmes actuels, avec pour chacun un éventuel fixId réutilisable par apply_security_fix.",
    parameters: {
      type: "object",
      properties: { hostId: { type: "number", description: "Identifiant de la machine (voir list_hosts)." } },
      required: ["hostId"],
    },
    sensitive: false,
  },
  {
    name: "run_ssh_command",
    description:
      "Exécute une commande shell sur une machine via SSH et retourne son code de sortie, sa sortie standard et son erreur standard. Action sensible : ne s'exécute qu'après confirmation humaine.",
    parameters: {
      type: "object",
      properties: {
        hostId: { type: "number", description: "Identifiant de la machine (voir list_hosts)." },
        command: { type: "string", description: "Commande shell à exécuter." },
        sudo: { type: "boolean", description: "Exécuter avec les privilèges root. Par défaut false." },
      },
      required: ["hostId", "command"],
    },
    sensitive: true,
  },
  {
    name: "apply_security_fix",
    description:
      "Applique un correctif de sécurité prédéfini du panel sur une machine (fixId obtenu via get_security_findings). Action sensible : ne s'exécute qu'après confirmation humaine.",
    parameters: {
      type: "object",
      properties: {
        hostId: { type: "number" },
        fixId: { type: "string", description: "Identifiant du correctif, ex: install-fail2ban, apply-updates, block-ip." },
        params: { type: "object", description: 'Paramètres additionnels si nécessaire, ex: {"ip": "1.2.3.4"} pour block-ip.' },
      },
      required: ["hostId", "fixId"],
    },
    sensitive: true,
  },
  {
    name: "block_ip",
    description:
      "Bloque une adresse IP au pare-feu, sur une seule machine ou sur toute l'infrastructure. Action sensible : ne s'exécute qu'après confirmation humaine.",
    parameters: {
      type: "object",
      properties: {
        ip: { type: "string" },
        scope: { type: "string", enum: ["host", "all"] },
        hostId: { type: "number", description: "Requis si scope = host." },
      },
      required: ["ip", "scope"],
    },
    sensitive: true,
  },
];

const SSH_COMMAND_TIMEOUT_MS = 30_000;

/** Runs one tool call for real and returns its result as a string handed back to the model.
 * Never throws — every failure mode (bad args, SSH error, unknown tool) becomes a result the
 * model can read and react to, since a thrown error here would otherwise break the chat loop. */
export async function executeAiTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "list_hosts": {
        const hosts = getDb().prepare(`SELECT id, name, kind, os FROM hosts ORDER BY kind, name`).all();
        return JSON.stringify(hosts);
      }
      case "get_security_findings": {
        const hostId = Number(args.hostId);
        if (!hostId) return "Erreur : hostId manquant ou invalide.";
        const result = await scanSingleHost(hostId);
        return JSON.stringify(result);
      }
      case "run_ssh_command": {
        const hostId = Number(args.hostId);
        const command = String(args.command ?? "");
        if (!hostId || !command) return "Erreur : hostId ou command manquant.";
        const { code, stdout, stderr } = await withTimeout(
          runSshCommand(hostId, command, { sudo: Boolean(args.sudo) }),
          SSH_COMMAND_TIMEOUT_MS,
          "Délai dépassé lors de l'exécution de la commande."
        );
        return JSON.stringify({ exitCode: code, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 2000) });
      }
      case "apply_security_fix": {
        const hostId = Number(args.hostId);
        const fixId = String(args.fixId ?? "");
        if (!hostId || !fixId) return "Erreur : hostId ou fixId manquant.";
        const result = await applySecurityFix(hostId, fixId, args.params as Record<string, string> | undefined);
        return JSON.stringify(result);
      }
      case "block_ip": {
        const ip = String(args.ip ?? "");
        if (!ip) return "Erreur : ip manquante.";
        if (args.scope === "all") {
          const results = await blockIpEverywhere(ip);
          return JSON.stringify(results);
        }
        const hostId = Number(args.hostId);
        if (!hostId) return "Erreur : hostId requis pour scope=host.";
        const result = await blockIp(hostId, ip);
        return JSON.stringify(result);
      }
      default:
        return `Erreur : outil inconnu "${name}".`;
    }
  } catch (err) {
    return `Erreur : ${err instanceof Error ? err.message : "erreur inconnue"}.`;
  }
}
