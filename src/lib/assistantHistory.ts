import { randomUUID } from "crypto";
import { getDb } from "./db";

export type ConversationKind = "chat" | "agent";

export type ConversationSummary = {
  id: string;
  kind: ConversationKind;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Conversation<T> = ConversationSummary & { messages: T[] };

type ConversationRow = {
  id: string;
  kind: ConversationKind;
  title: string;
  messages_json: string;
  created_at: string;
  updated_at: string;
};

function rowToSummary(row: ConversationRow): ConversationSummary {
  return { id: row.id, kind: row.kind, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

/** First user turn, trimmed to a short label — same convention as every other auto-titled list in
 * this panel (backup run names, etc.): good enough to recognize a conversation in a list, never
 * edited automatically again once set. */
function deriveTitle<T extends { role: string; content: string }>(messages: T[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser?.content.trim()) return "Nouvelle conversation";
  const text = firstUser.content.trim().replace(/\s+/g, " ");
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function listConversations(kind: ConversationKind): ConversationSummary[] {
  return (
    getDb()
      .prepare(`SELECT id, kind, title, created_at, updated_at FROM assistant_conversations WHERE kind = ? ORDER BY updated_at DESC`)
      .all(kind) as Omit<ConversationRow, "messages_json">[]
  ).map((row) => rowToSummary({ ...row, messages_json: "[]" }));
}

export function getConversation<T>(id: string): Conversation<T> | null {
  const row = getDb().prepare(`SELECT * FROM assistant_conversations WHERE id = ?`).get(id) as ConversationRow | undefined;
  if (!row) return null;
  let messages: T[] = [];
  try {
    messages = JSON.parse(row.messages_json) as T[];
  } catch {
    messages = [];
  }
  return { ...rowToSummary(row), messages };
}

export function createConversation<T extends { role: string; content: string }>(
  kind: ConversationKind,
  messages: T[]
): Conversation<T> {
  const id = randomUUID();
  const title = deriveTitle(messages);
  getDb()
    .prepare(`INSERT INTO assistant_conversations (id, kind, title, messages_json) VALUES (?, ?, ?, ?)`)
    .run(id, kind, title, JSON.stringify(messages));
  return getConversation<T>(id)!;
}

/** `undefined` title keeps whatever's already stored — only an explicit rename (or the initial
 * creation above) ever changes it, never a routine save of new messages. */
export function updateConversationMessages<T>(id: string, messages: T[]): void {
  getDb()
    .prepare(`UPDATE assistant_conversations SET messages_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(messages), id);
}

export function renameConversation(id: string, title: string): void {
  getDb().prepare(`UPDATE assistant_conversations SET title = ? WHERE id = ?`).run(title.trim() || "Nouvelle conversation", id);
}

export function deleteConversation(id: string): void {
  getDb().prepare(`DELETE FROM assistant_conversations WHERE id = ?`).run(id);
}
