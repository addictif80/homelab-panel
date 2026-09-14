import { getSetting, setSetting } from "../db";

const KEY = "subscription_grace_days";
const DEFAULT_GRACE_DAYS = 7;

/** How many days a subscription instance keeps working after its paid-through date passes
 * before the panel locks down — covers a failed card retry cycle or a slow re-check without
 * punishing a customer instantly the moment a renewal hiccups. */
export function getSubscriptionGraceDays(): number {
  const raw = getSetting(KEY);
  return raw ? Number(raw) || DEFAULT_GRACE_DAYS : DEFAULT_GRACE_DAYS;
}

export function setSubscriptionGraceDays(days: number): void {
  setSetting(KEY, String(Math.max(0, Math.round(days))));
}
