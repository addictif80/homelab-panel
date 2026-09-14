import { getSetting, setSetting } from "./db";

export type OllamaConfig = {
  baseUrl: string;
  model: string;
  language: string;
};

const SETTING_KEY = "ollama_config";

const DEFAULT_CONFIG: OllamaConfig = { baseUrl: "", model: "", language: "fr" };

const LANGUAGE_NAMES: Record<string, string> = {
  fr: "français",
  en: "anglais",
};

export function getOllamaConfig(): OllamaConfig {
  const raw = getSetting(SETTING_KEY);
  if (!raw) return DEFAULT_CONFIG;
  return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<OllamaConfig>) };
}

export function setOllamaConfig(config: OllamaConfig): void {
  setSetting(SETTING_KEY, JSON.stringify(config));
}

export function isOllamaConfigured(): boolean {
  const config = getOllamaConfig();
  return Boolean(config.baseUrl && config.model);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Prepended to every conversation so the model answers in the configured language and stays
 * useful for a homelab admin audience, regardless of the model's own default behavior/language. */
export function buildSystemPrompt(config: OllamaConfig, extraContext?: string): string {
  const languageName = LANGUAGE_NAMES[config.language] ?? config.language;
  const base = `Tu es l'assistant intégré de Homelab Panel, un panneau d'administration pour un homelab self-hosted (serveurs physiques, machines virtuelles, Docker, réseau). Réponds toujours en ${languageName}, de façon claire, concise et actionnable. Quand c'est pertinent, donne des commandes shell prêtes à copier-coller. Précise les risques avant toute commande destructive.`;
  return extraContext ? `${base}\n\nContexte pour cette conversation :\n${extraContext}` : base;
}

export type OllamaTestResult = { ok: boolean; message: string; models: string[] };

/** Hits Ollama's own /api/tags — cheap, read-only, and doubles as both a connectivity check and
 * the source for the model picker in settings. */
export async function testOllamaConnection(config: OllamaConfig): Promise<OllamaTestResult> {
  if (!config.baseUrl) return { ok: false, message: "Adresse du serveur manquante.", models: [] };
  try {
    const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return { ok: false, message: `Le serveur a répondu avec une erreur (HTTP ${res.status}).`, models: [] };
    }
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name);
    return {
      ok: true,
      message:
        models.length > 0
          ? `Connexion réussie. ${models.length} modèle${models.length > 1 ? "s" : ""} disponible${models.length > 1 ? "s" : ""}.`
          : "Connexion réussie, mais aucun modèle n'est installé sur ce serveur Ollama (`ollama pull <modèle>`).",
      models,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Erreur inconnue.";
    return { ok: false, message: `Connexion impossible : ${reason}`, models: [] };
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** One-shot, non-streaming completion — used where a whole answer is needed at once (the
 * resolution guide's "Demander à l'IA" step) rather than rendered token by token. */
export async function askOllama(userMessage: string, extraContext?: string): Promise<string> {
  const config = getOllamaConfig();
  if (!config.baseUrl || !config.model) {
    throw new Error("L'assistant IA n'est pas configuré (Sécurité > Assistant IA (Ollama)).");
  }
  const res = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      messages: [
        { role: "system", content: buildSystemPrompt(config, extraContext) },
        { role: "user", content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Le serveur Ollama a répondu avec une erreur (HTTP ${res.status}).`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}
