import Database from "better-sqlite3";
import { randomBytes } from "crypto";
import { migrate } from "../db";
import { seedDemo } from "./seedDemo";

type DemoEntry = { db: Database.Database; createdAt: number };

declare global {
  // eslint-disable-next-line no-var
  var __homelabDemoRegistry: Map<string, DemoEntry> | undefined;
}

// Stashed on `globalThis` rather than a plain module-scoped variable — same reasoning as
// `global.__homelabDb` (db.ts) and `global.__homelabDemoAls` (demo/context.ts): server.ts imports
// this module directly under tsx's plain Node resolution (for startDemoSweeper()), while the
// Next-bundled app code (the /demo route, db.ts) loads its own separate bundled copy — without
// globalThis, a session created via one copy's registry would be invisible to lookups against the
// other, surfacing as a false "session démo expirée" on every request.
const registry = global.__homelabDemoRegistry ?? (global.__homelabDemoRegistry = new Map<string, DemoEntry>());

const SESSION_TTL_MS = 60 * 60 * 1000; // 1h — "réinitialisation auto toutes les heures"
// A public, unauthenticated route that allocates an in-memory SQLite database per visit is a real
// resource-exhaustion vector — this bounds it to a sane number of concurrent sandboxes regardless
// of how many times /demo is hit, evicting the oldest rather than refusing new visitors outright.
const MAX_CONCURRENT_SESSIONS = 200;

function evictOldestIfFull() {
  if (registry.size < MAX_CONCURRENT_SESSIONS) return;
  let oldestId: string | null = null;
  let oldestAt = Infinity;
  for (const [id, entry] of registry) {
    if (entry.createdAt < oldestAt) {
      oldestAt = entry.createdAt;
      oldestId = id;
    }
  }
  if (oldestId) destroySession(oldestId);
}

function destroySession(demoId: string) {
  const entry = registry.get(demoId);
  if (!entry) return;
  try {
    entry.db.close();
  } catch {
    // already closed
  }
  registry.delete(demoId);
}

export function createDemoSession(): string {
  evictOldestIfFull();
  const demoId = randomBytes(16).toString("hex");
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedDemo(db);
  registry.set(demoId, { db, createdAt: Date.now() });
  return demoId;
}

export function getDemoDb(demoId: string): Database.Database | null {
  return registry.get(demoId)?.db ?? null;
}

let sweepStarted = false;
export function startDemoSweeper() {
  if (sweepStarted) return;
  sweepStarted = true;
  setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, entry] of registry) {
      if (entry.createdAt < cutoff) destroySession(id);
    }
  }, 5 * 60 * 1000).unref();
}
