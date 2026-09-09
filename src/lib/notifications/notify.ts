import { getSmtpConfig, sendMail } from "../mail";
import { dispatchToChannels, hasEnabledChannel } from "./channels";

export function hasAnyNotificationChannel(): boolean {
  return !!getSmtpConfig()?.enabled || hasEnabledChannel();
}

/** Sends to every enabled channel (email + webhooks/ntfy/Discord/Slack), best-effort. */
export async function notifyAll(subject: string, text: string): Promise<void> {
  const smtp = getSmtpConfig();
  if (smtp?.enabled) {
    try {
      await sendMail(subject, text);
    } catch {
      // Best-effort: don't let a broken SMTP config block the other channels.
    }
  }
  await dispatchToChannels(subject, text);
}
