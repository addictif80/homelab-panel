import { getSetting, setSetting } from "../db";

export type NotificationScheduleSettings = {
  checkIntervalMinutes: number;
  renotifyAfterHours: number;
  minSendGapMinutes: number;
};

export const DEFAULT_SCHEDULE_SETTINGS: NotificationScheduleSettings = {
  checkIntervalMinutes: 60,
  renotifyAfterHours: 24,
  minSendGapMinutes: 30,
};

const KEY = "notification_schedule_settings";

export function getScheduleSettings(): NotificationScheduleSettings {
  const raw = getSetting(KEY);
  if (!raw) return DEFAULT_SCHEDULE_SETTINGS;
  try {
    const parsed = JSON.parse(raw);
    return {
      checkIntervalMinutes: Number(parsed.checkIntervalMinutes) || DEFAULT_SCHEDULE_SETTINGS.checkIntervalMinutes,
      renotifyAfterHours: Number(parsed.renotifyAfterHours) || DEFAULT_SCHEDULE_SETTINGS.renotifyAfterHours,
      minSendGapMinutes: Number(parsed.minSendGapMinutes) || DEFAULT_SCHEDULE_SETTINGS.minSendGapMinutes,
    };
  } catch {
    return DEFAULT_SCHEDULE_SETTINGS;
  }
}

export function setScheduleSettings(settings: NotificationScheduleSettings): void {
  setSetting(KEY, JSON.stringify(settings));
}
