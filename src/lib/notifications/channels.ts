import { randomUUID } from "crypto";
import { getSetting, setSetting } from "../db";
import { isLoopbackOrMetadataHost } from "../validators";

export type ChannelType = "webhook" | "ntfy" | "discord" | "slack";

export type NotificationChannel = {
  id: string;
  type: ChannelType;
  label: string;
  enabled: boolean;
  // webhook / discord / slack
  url?: string;
  // ntfy
  ntfyServer?: string;
  ntfyTopic?: string;
  ntfyToken?: string;
};

const KEY = "notification_channels";

export function listChannels(): NotificationChannel[] {
  const raw = getSetting(KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveChannels(channels: NotificationChannel[]) {
  setSetting(KEY, JSON.stringify(channels));
}

export function addChannel(channel: Omit<NotificationChannel, "id">): NotificationChannel {
  const channels = listChannels();
  const created: NotificationChannel = { ...channel, id: randomUUID() };
  channels.push(created);
  saveChannels(channels);
  return created;
}

export function updateChannel(id: string, patch: Partial<Omit<NotificationChannel, "id">>): void {
  saveChannels(listChannels().map((c) => (c.id === id ? { ...c, ...patch } : c)));
}

export function removeChannel(id: string): void {
  saveChannels(listChannels().filter((c) => c.id !== id));
}

/** Strips secrets before a channel list ever reaches the client — GET responses should only tell
 * the UI a channel is configured, never hand back the webhook URL or ntfy token itself (those are
 * bearer secrets: whoever holds a Discord/Slack webhook URL can post to it directly). */
export function redactChannel(channel: NotificationChannel): Omit<NotificationChannel, "url" | "ntfyToken"> & {
  configured: boolean;
} {
  const { url: _url, ntfyToken: _ntfyToken, ...rest } = channel;
  return { ...rest, configured: !!(channel.url || channel.ntfyTopic) };
}

function assertFetchable(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL invalide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Seuls les URL http/https sont autorisées.");
  }
  if (isLoopbackOrMetadataHost(url.hostname)) {
    throw new Error("Cette adresse n'est pas autorisée comme destination de notification.");
  }
  return url;
}

async function sendToChannel(channel: NotificationChannel, subject: string, text: string): Promise<void> {
  switch (channel.type) {
    case "webhook": {
      if (!channel.url) throw new Error("URL manquante.");
      const res = await fetch(assertFetchable(channel.url), {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: subject, message: text, timestamp: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`Le webhook a répondu ${res.status}.`);
      return;
    }
    case "ntfy": {
      if (!channel.ntfyTopic) throw new Error("Sujet (topic) ntfy manquant.");
      const base = (channel.ntfyServer || "https://ntfy.sh").replace(/\/$/, "");
      const res = await fetch(assertFetchable(`${base}/${channel.ntfyTopic}`), {
        method: "POST",
        redirect: "manual",
        headers: {
          Title: subject,
          ...(channel.ntfyToken ? { Authorization: `Bearer ${channel.ntfyToken}` } : {}),
        },
        body: text,
      });
      if (!res.ok) throw new Error(`ntfy a répondu ${res.status}.`);
      return;
    }
    case "discord": {
      if (!channel.url) throw new Error("URL du webhook Discord manquante.");
      const res = await fetch(assertFetchable(channel.url), {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `**${subject}**\n${text}`.slice(0, 1900) }),
      });
      if (!res.ok) throw new Error(`Discord a répondu ${res.status}.`);
      return;
    }
    case "slack": {
      if (!channel.url) throw new Error("URL du webhook Slack manquante.");
      const res = await fetch(assertFetchable(channel.url), {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${subject}*\n${text}` }),
      });
      if (!res.ok) throw new Error(`Slack a répondu ${res.status}.`);
      return;
    }
  }
}

export async function testChannel(id: string): Promise<void> {
  const channel = listChannels().find((c) => c.id === id);
  if (!channel) throw new Error("Canal introuvable.");
  await sendToChannel(channel, "[Homelab Panel] Test", "Ceci est une notification de test envoyée depuis le Centre de sécurité.");
}

/** Best-effort fan-out: one channel failing never blocks the others. */
export async function dispatchToChannels(subject: string, text: string): Promise<void> {
  const channels = listChannels().filter((c) => c.enabled);
  await Promise.allSettled(channels.map((c) => sendToChannel(c, subject, text)));
}

export function hasEnabledChannel(): boolean {
  return listChannels().some((c) => c.enabled);
}
