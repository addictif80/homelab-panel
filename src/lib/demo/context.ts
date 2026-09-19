import { AsyncLocalStorage } from "async_hooks";

declare global {
  // eslint-disable-next-line no-var
  var __homelabDemoAls: AsyncLocalStorage<string> | undefined;
}

/**
 * Which demo sandbox (if any) the current request belongs to. Set once, in server.ts, from the
 * `homelab_demo_id` cookie on the raw incoming request — before Next's own routing/middleware/RSC
 * pipeline runs — so every downstream getDb() call, SSH helper, etc. sees the same value for the
 * whole lifetime of that one request without threading a parameter through every function.
 *
 * Stashed on `globalThis` rather than a plain module-scoped variable — same reasoning as
 * `global.__homelabDb` in db.ts: server.ts runs directly under tsx (plain Node module
 * resolution), while everything under src/app and src/lib that Next itself imports is loaded
 * through Next's own bundler as a *separate* module instance. A `new AsyncLocalStorage()` at
 * module scope would silently create two unrelated instances — one server.ts calls `.run()` on,
 * a different one db.ts calls `.getStore()` on — so `.run()` in one is invisible to the other's
 * `.getStore()`. `globalThis` is the one thing both loading paths genuinely share.
 */
const demoAls = global.__homelabDemoAls ?? (global.__homelabDemoAls = new AsyncLocalStorage<string>());

export function runWithDemoId<T>(demoId: string | null, fn: () => T): T {
  if (!demoId) return fn();
  return demoAls.run(demoId, fn);
}

export function getCurrentDemoId(): string | null {
  return demoAls.getStore() ?? null;
}

export function isDemoContext(): boolean {
  return demoAls.getStore() !== undefined;
}

export const DEMO_COOKIE_NAME = "homelab_demo_id";
export const DEMO_SESSION_MAX_AGE_SECONDS = 60 * 60; // 1h — matches the hourly sweep in store.ts
