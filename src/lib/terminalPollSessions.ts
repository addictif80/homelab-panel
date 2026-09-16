import { randomUUID } from "crypto";
import { openSshChannel, type ExecTarget, type SshChannelHandle } from "./sshChannel";
import { logAudit } from "./db";

/**
 * HTTP-polling fallback transport for the SSH terminal, for networks that block the WebSocket
 * upgrade outright (some hotel/rental/corporate networks do this deliberately) rather than just a
 * specific port — plain HTTPS requests still go through fine there, so the terminal falls back to
 * this when the WS connection never opens (see Terminal.tsx). Sessions live in this module's
 * memory (the custom server.ts process is long-running, same assumption the WS server already
 * makes), keyed by an unguessable session id and additionally scoped to the username that created
 * it so one logged-in user can't poll another's session even by guessing/leaking the id.
 */

type Session = {
  username: string;
  handle: SshChannelHandle;
  buffer: string;
  cursor: number;
  closed: boolean;
  lastActivity: number;
  waiters: (() => void)[];
};

const sessions = new Map<string, Session>();
const MAX_BUFFER_CHARS = 200_000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60_000;

function touch(session: Session) {
  session.lastActivity = Date.now();
}

function appendData(session: Session, chunk: string) {
  session.buffer += chunk;
  session.cursor += chunk.length;
  if (session.buffer.length > MAX_BUFFER_CHARS) {
    session.buffer = session.buffer.slice(session.buffer.length - MAX_BUFFER_CHARS);
  }
  const waiters = session.waiters.splice(0);
  for (const resolve of waiters) resolve();
}

let sweepStarted = false;
function ensureSweep() {
  if (sweepStarted) return;
  sweepStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > IDLE_TIMEOUT_MS) {
        session.handle.close();
        sessions.delete(id);
      }
    }
  }, SWEEP_INTERVAL_MS);
}

export function createPollSession(hostId: number, execTarget: ExecTarget | null, username: string): string {
  ensureSweep();
  const id = randomUUID();
  const logTarget = execTarget ? `${hostId}/${execTarget.kind}:${execTarget.id}` : String(hostId);

  const session: Session = {
    username,
    handle: null as unknown as SshChannelHandle,
    buffer: "",
    cursor: 0,
    closed: false,
    lastActivity: Date.now(),
    waiters: [],
  };

  session.handle = openSshChannel(hostId, execTarget, { cols: 80, rows: 24 }, {
    onData: (chunk) => appendData(session, chunk),
    onError: (message) => {
      appendData(session, `\r\n\x1b[31m${message}\x1b[0m\r\n`);
      session.closed = true;
      logAudit("ssh.disconnected", logTarget, username);
    },
    onClose: () => {
      session.closed = true;
      appendData(session, "");
      logAudit("ssh.disconnected", logTarget, username);
    },
  });

  sessions.set(id, session);
  logAudit("ssh.connected", logTarget, username);
  return id;
}

function getOwnedSession(id: string, username: string): Session | null {
  const session = sessions.get(id);
  if (!session || session.username !== username) return null;
  return session;
}

export function writeToSession(id: string, username: string, data: string): boolean {
  const session = getOwnedSession(id, username);
  if (!session || session.closed) return false;
  touch(session);
  session.handle.write(data);
  return true;
}

export function resizeSession(id: string, username: string, cols: number, rows: number): boolean {
  const session = getOwnedSession(id, username);
  if (!session || session.closed) return false;
  touch(session);
  session.handle.resize(cols, rows);
  return true;
}

export function closeSession(id: string, username: string): void {
  const session = getOwnedSession(id, username);
  if (!session) return;
  session.handle.close();
  sessions.delete(id);
}

export type PollResult = { data: string; cursor: number; closed: boolean } | null;

function readSince(session: Session, sinceCursor: number): PollResult {
  const bufferStart = session.cursor - session.buffer.length;
  const from = Math.max(0, Math.max(sinceCursor, bufferStart) - bufferStart);
  return { data: session.buffer.slice(from), cursor: session.cursor, closed: session.closed };
}

/** Long-polls up to `timeoutMs` for new output — a plain, slow-resolving HTTP GET, which works
 * fine even on a network that specifically blocks the WebSocket upgrade handshake, since this
 * never attempts one. */
export async function waitForOutput(id: string, username: string, sinceCursor: number, timeoutMs: number): Promise<PollResult> {
  const session = getOwnedSession(id, username);
  if (!session) return null;
  touch(session);

  if (session.cursor > sinceCursor || session.closed) {
    return readSince(session, sinceCursor);
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    session.waiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });

  const stillThere = getOwnedSession(id, username);
  if (!stillThere) return null;
  return readSince(stillThere, sinceCursor);
}
