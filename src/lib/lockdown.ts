import { getDb, getSetting, setSetting, logAudit } from "./db";
import { listBlockedIps, blockIpEverywhere } from "./firewall";
import { notifyAll } from "./notifications/notify";
import { bumpSessionEpoch } from "./auth";

const ACTIVE_KEY = "lockdown_active";
const ACTIVATED_AT_KEY = "lockdown_activated_at";

export function isLockdownActive(): boolean {
  return getSetting(ACTIVE_KEY) === "true";
}

export function getLockdownActivatedAt(): string | null {
  return getSetting(ACTIVATED_AT_KEY);
}

export type LockdownResult = { blockedIps: number; revokedDevices: number };

/**
 * The "break glass" button: a single action that materializes "one control point can put the
 * whole infra in a safe state" without requiring the admin to touch every machine individually
 * mid-panic. Deliberately does NOT attempt a blanket deny-all-inbound on every host — that risks
 * locking out SSH access to the very machines the admin needs to keep investigating from, which
 * is worse than the compromise it's meant to contain. Scoped instead to what's safe to automate:
 * - Every other browser session is invalidated (session epoch bump — see auth.ts); the session
 *   that triggered this one keeps working, since proxy.ts re-signs its own cookie right after.
 * - Every "remember this device" 2FA bypass is cleared, so a stolen trusted-device cookie stops
 *   working too.
 * - Every already-flagged suspicious IP gets its block re-applied to every host and router, in
 *   case any of them had drifted out of sync with the registry.
 * - The backup scheduler stops starting new runs until lockdown is lifted (isLockdownActive() is
 *   checked in backup/scheduler.ts) — notifications stay on, since silencing alerts during an
 *   actual incident would defeat the point.
 */
export async function activateLockdown(): Promise<LockdownResult> {
  setSetting(ACTIVE_KEY, "true");
  setSetting(ACTIVATED_AT_KEY, new Date().toISOString());

  bumpSessionEpoch();
  const revokedDevices = getDb().prepare(`DELETE FROM trusted_devices`).run().changes;

  const ips = listBlockedIps();
  for (const { ip } of ips) {
    await blockIpEverywhere(ip).catch(() => {});
  }

  logAudit("security.lockdown_activated", undefined, `${ips.length} IP renforcée(s), ${revokedDevices} appareil(s) révoqué(s)`);
  await notifyAll(
    "🔒 Lockdown activé",
    `Le lockdown du panel vient d'être activé : toutes les autres sessions et appareils de confiance ont été révoqués, ${ips.length} IP suspecte(s) reforcée(s) sur toute l'infra, sauvegardes automatiques en pause.`
  );

  return { blockedIps: ips.length, revokedDevices };
}

export async function deactivateLockdown(): Promise<void> {
  setSetting(ACTIVE_KEY, "false");
  logAudit("security.lockdown_deactivated");
  await notifyAll("Lockdown levé", "Le lockdown du panel a été désactivé — fonctionnement normal repris.");
}
