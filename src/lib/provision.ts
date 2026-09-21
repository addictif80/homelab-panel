import { getDb } from "./db";
import { getOllamaConfig, askOllama } from "./ollama";
import { listAppTemplates } from "./appTemplates";

export type ProvisionSuggestion = {
  hostId: number | null;
  hostName: string | null;
  templateId: string | null;
  image: string;
  name: string;
  ports: string[];
  volumes: string[];
  env: string[];
  restartPolicy: string;
  explanation: string;
};

type HostRow = { id: number; name: string };

function getDockerHosts(): HostRow[] {
  return getDb().prepare(`SELECT id, name FROM hosts WHERE docker_enabled = 1 ORDER BY name`).all() as HostRow[];
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

/**
 * Turns one sentence ("installe un Nextcloud sur mon NAS") into a prefilled "Lancer un
 * conteneur" form — never into an actual deploy. The model only picks among real templates and
 * real hosts (never invents an id) and proposes a plausible image/ports/volumes when nothing
 * matches; the human still reviews and clicks "Lancer" on the existing form themselves, exactly
 * as if they'd filled it in by hand — one sentence replaces the typing, not the confirmation.
 */
export async function interpretProvisionSentence(sentence: string): Promise<ProvisionSuggestion> {
  const config = getOllamaConfig();
  if (!config.baseUrl || !config.model) {
    throw new Error("L'assistant IA n'est pas configuré (Réglages > Assistant IA (Ollama)).");
  }

  const hosts = getDockerHosts();
  if (hosts.length === 0) {
    throw new Error("Aucune machine avec Docker activé dans l'inventaire — active Docker sur une machine d'abord.");
  }
  const templates = listAppTemplates();

  const hostsList = hosts.map((h) => `- id=${h.id} nom="${h.name}"`).join("\n");
  const templatesList =
    templates.map((t) => `- id="${t.id}" nom="${t.name}" image="${t.image}" description="${t.description}"`).join("\n") ||
    "(aucun modèle enregistré pour l'instant)";

  const prompt = `Demande en langage naturel pour déployer une application sur un homelab :
"${sentence}"

Machines avec Docker disponibles :
${hostsList}

Modèles d'applications déjà enregistrés dans le panel (préfère-les si l'un correspond) :
${templatesList}

Réponds UNIQUEMENT avec un objet JSON, sans aucun texte avant ni après, au format exact :
{"hostId": <id de machine ci-dessus, ou null si aucune ne correspond clairement>, "templateId": <id de modèle ci-dessus si un correspond, sinon null>, "image": "<image docker à utiliser, ex: nextcloud:latest — une image Docker Hub officielle plausible si aucun modèle ne correspond>", "name": "<nom de conteneur court, minuscules, tirets>", "ports": ["<portHôte>:<portConteneur>", ...], "volumes": ["<cheminHôte>:<cheminConteneur>", ...], "env": ["CLE=valeur", ...], "restartPolicy": "unless-stopped", "explanation": "<une phrase en français expliquant ton choix>"}

Si une seule machine est listée, choisis-la même si la demande ne la nomme pas. N'invente jamais d'id de machine ou de modèle qui n'est pas dans les listes ci-dessus.`;

  const raw = await askOllama(prompt);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("L'IA n'a pas renvoyé de réponse exploitable — reformule ta demande.");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("L'IA a renvoyé un format invalide — reformule ta demande.");
  }

  const host = hosts.find((h) => h.id === Number(parsed.hostId)) ?? (hosts.length === 1 ? hosts[0] : null);
  const template = templates.find((t) => t.id === parsed.templateId) ?? null;

  return {
    hostId: host?.id ?? null,
    hostName: host?.name ?? null,
    templateId: template?.id ?? null,
    image: typeof parsed.image === "string" && parsed.image.trim() ? parsed.image.trim() : (template?.image ?? ""),
    name:
      typeof parsed.name === "string"
        ? parsed.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")
        : "",
    ports: toStringArray(parsed.ports).length > 0 ? toStringArray(parsed.ports) : (template?.ports ?? []),
    volumes: toStringArray(parsed.volumes).length > 0 ? toStringArray(parsed.volumes) : (template?.volumes ?? []),
    env: toStringArray(parsed.env).length > 0 ? toStringArray(parsed.env) : (template?.env ?? []),
    restartPolicy: typeof parsed.restartPolicy === "string" && parsed.restartPolicy ? parsed.restartPolicy : "unless-stopped",
    explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
  };
}
