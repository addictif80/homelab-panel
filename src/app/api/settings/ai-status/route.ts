import { NextResponse } from "next/server";
import { getAiProvider, isAiConfigured } from "@/lib/aiProvider";
import { getOllamaConfig } from "@/lib/ollama";
import { getOneMinConfig } from "@/lib/oneMinAi";

/**
 * Provider-agnostic status for the assistant UI (chat page, resolution guide) — these only need
 * to know "is *something* configured, and what's a human-readable label for it", never which
 * provider's own settings shape that came from. Keeps every client in sync with whichever
 * provider /api/settings/ai-provider currently points at, instead of each one re-deriving
 * "configured" from Ollama's settings specifically (see lib/aiProvider.ts for the same
 * provider-agnostic dispatch used server-side for the actual chat/agent calls).
 */
export async function GET() {
  const provider = getAiProvider();
  const configured = isAiConfigured();
  const label =
    provider === "1min"
      ? `1min.ai — ${getOneMinConfig().model}`
      : `Ollama — ${getOllamaConfig().model} sur ${getOllamaConfig().baseUrl}`;
  return NextResponse.json({ provider, configured, label: configured ? label : null });
}
