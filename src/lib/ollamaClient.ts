export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * Reads the NDJSON stream from /api/ai/chat (itself a pass-through of Ollama's own streaming
 * format) and calls onToken for each content fragment as it arrives — shared by the resolution
 * guide's "Demander à l'IA" step and the standalone Assistant IA chat page.
 */
export async function streamOllamaChat(
  messages: ChatTurn[],
  context: string | undefined,
  onToken: (token: string) => void
): Promise<void> {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context }),
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(data.error || `Erreur (HTTP ${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function consumeLine(line: string) {
    if (!line.trim()) return;
    try {
      const obj = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (obj.error) throw new Error(obj.error);
      if (obj.message?.content) onToken(obj.message.content);
    } catch (err) {
      if (err instanceof SyntaxError) return; // an incomplete/malformed line — ignore rather than abort the stream
      throw err;
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
  }
  if (buffer.trim()) consumeLine(buffer);
}
