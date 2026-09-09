import nodemailer from "nodemailer";
import { getSetting, setSetting } from "./db";
import { vaultEncrypt, vaultDecrypt } from "./crypto";
import { simpleEmailHtml } from "./emailTemplates";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  to: string;
  enabled: boolean;
};

const CONFIG_KEY = "smtp_config";
const PASSWORD_KEY = "smtp_password_encrypted";

export function getSmtpConfig(): SmtpConfig | null {
  const raw = getSetting(CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function hasSmtpPassword(): boolean {
  return !!getSetting(PASSWORD_KEY);
}

function getSmtpConfigWithPassword(): (SmtpConfig & { password: string }) | null {
  const config = getSmtpConfig();
  if (!config) return null;
  const encrypted = getSetting(PASSWORD_KEY);
  return { ...config, password: encrypted ? vaultDecrypt(encrypted) : "" };
}

/** Password is only rewritten when a non-empty value is passed (leaves it untouched otherwise). */
export function setSmtpConfig(config: SmtpConfig, password?: string): void {
  setSetting(CONFIG_KEY, JSON.stringify(config));
  if (password) setSetting(PASSWORD_KEY, vaultEncrypt(password));
}

/** Sends to the configured admin recipient by default (alerts, digests). Pass `to` to send
 * somewhere else instead — e.g. a customer's own address for a transactional email. Pass `html`
 * for a purpose-built layout (a button, etc.); otherwise `text` is wrapped in the standard
 * branded template automatically. */
export async function sendMail(subject: string, text: string, to?: string, html?: string): Promise<void> {
  const config = getSmtpConfigWithPassword();
  if (!config) throw new Error("Aucun serveur SMTP configuré.");
  if (!config.enabled) throw new Error("Les notifications par email sont désactivées.");

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
  });

  await transporter.sendMail({
    from: config.from || config.user,
    to: to || config.to,
    subject,
    text,
    html: html || simpleEmailHtml(text),
  });
}
