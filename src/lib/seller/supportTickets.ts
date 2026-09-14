import { randomUUID, randomBytes } from "crypto";
import { getDb } from "../db";

export type TicketStatus = "open" | "closed";
export type SupportTicket = {
  id: string;
  accessToken: string;
  email: string;
  subject: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
};
export type TicketMessage = { id: string; ticketId: string; sender: "customer" | "seller"; body: string; createdAt: string };

type TicketRow = {
  id: string;
  access_token: string;
  email: string;
  subject: string;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
};
type MessageRow = { id: string; ticket_id: string; sender: "customer" | "seller"; body: string; created_at: string };

function rowToTicket(row: TicketRow): SupportTicket {
  return {
    id: row.id,
    accessToken: row.access_token,
    email: row.email,
    subject: row.subject,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: MessageRow): TicketMessage {
  return { id: row.id, ticketId: row.ticket_id, sender: row.sender, body: row.body, createdAt: row.created_at };
}

/** Creates a ticket and its first (customer) message in one call — a ticket with no messages
 * never legitimately exists. */
export function createTicket(email: string, subject: string, firstMessage: string): SupportTicket {
  const id = randomUUID();
  const token = randomBytes(24).toString("hex");
  getDb()
    .prepare(`INSERT INTO support_tickets (id, access_token, email, subject) VALUES (?, ?, ?, ?)`)
    .run(id, token, email, subject);
  addMessage(id, "customer", firstMessage);
  return getTicket(id)!;
}

export function getTicket(id: string): SupportTicket | null {
  const row = getDb().prepare(`SELECT * FROM support_tickets WHERE id = ?`).get(id) as TicketRow | undefined;
  return row ? rowToTicket(row) : null;
}

/** The only public-facing lookup — requires the token issued at creation, not just the ticket id. */
export function getTicketByToken(id: string, token: string): SupportTicket | null {
  const row = getDb().prepare(`SELECT * FROM support_tickets WHERE id = ? AND access_token = ?`).get(id, token) as
    | TicketRow
    | undefined;
  return row ? rowToTicket(row) : null;
}

export function listTickets(): SupportTicket[] {
  return (getDb().prepare(`SELECT * FROM support_tickets ORDER BY updated_at DESC`).all() as TicketRow[]).map(rowToTicket);
}

export function listMessages(ticketId: string): TicketMessage[] {
  return (
    getDb().prepare(`SELECT * FROM support_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC`).all(ticketId) as MessageRow[]
  ).map(rowToMessage);
}

export function addMessage(ticketId: string, sender: "customer" | "seller", body: string): TicketMessage {
  const id = randomUUID();
  const db = getDb();
  db.prepare(`INSERT INTO support_ticket_messages (id, ticket_id, sender, body) VALUES (?, ?, ?, ?)`).run(id, ticketId, sender, body);
  // A customer reply reopens a ticket the seller had closed; a seller reply just bumps updated_at
  // so the thread sorts to the top of the seller's list without changing its status on its own.
  if (sender === "customer") {
    db.prepare(`UPDATE support_tickets SET status = 'open', updated_at = datetime('now') WHERE id = ?`).run(ticketId);
  } else {
    db.prepare(`UPDATE support_tickets SET updated_at = datetime('now') WHERE id = ?`).run(ticketId);
  }
  return rowToMessage(db.prepare(`SELECT * FROM support_ticket_messages WHERE id = ?`).get(id) as MessageRow);
}

export function setTicketStatus(ticketId: string, status: TicketStatus): void {
  getDb().prepare(`UPDATE support_tickets SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, ticketId);
}
