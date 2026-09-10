import { getSetting, setSetting } from "../db";

const KEY = "trial_days";
const DEFAULT_TRIAL_DAYS = 14;

export function getTrialDays(): number {
  const raw = getSetting(KEY);
  return raw ? Number(raw) || DEFAULT_TRIAL_DAYS : DEFAULT_TRIAL_DAYS;
}

export function setTrialDays(days: number): void {
  setSetting(KEY, String(Math.max(1, Math.round(days))));
}
