"use client";

import { useEffect, useState } from "react";

type ChannelType = "webhook" | "ntfy" | "discord" | "slack";

type Channel = {
  id: string;
  type: ChannelType;
  label: string;
  enabled: boolean;
  url?: string;
  ntfyServer?: string;
  ntfyTopic?: string;
  ntfyToken?: string;
};

const TYPE_LABELS: Record<ChannelType, string> = {
  webhook: "Webhook générique (JSON)",
  ntfy: "ntfy",
  discord: "Discord",
  slack: "Slack",
};

const INPUT_CLASS = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100";

const NEW_CHANNEL_DEFAULT = {
  type: "webhook" as ChannelType,
  label: "",
  url: "",
  ntfyServer: "https://ntfy.sh",
  ntfyTopic: "",
  ntfyToken: "",
};

export default function NotificationChannelsPanel() {
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState(NEW_CHANNEL_DEFAULT);
  const [creating, setCreating] = useState(false);

  function load() {
    fetch("/api/settings/notification-channels")
      .then((r) => r.json())
      .then((data) => setChannels(data.channels));
  }

  useEffect(() => {
    if (open && !channels) load();
  }, [open, channels]);

  async function createChannel() {
    setCreating(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/notification-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForm({ ...NEW_CHANNEL_DEFAULT, ntfyServer: form.ntfyServer });
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setCreating(false);
    }
  }

  async function toggle(channel: Channel) {
    setBusyId(channel.id);
    await fetch(`/api/settings/notification-channels/${channel.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !channel.enabled }),
    });
    setBusyId(null);
    load();
  }

  async function remove(id: string) {
    setBusyId(id);
    await fetch(`/api/settings/notification-channels/${id}`, { method: "DELETE" });
    setBusyId(null);
    load();
  }

  async function test(id: string) {
    setBusyId(id);
    setMessage("");
    try {
      const res = await fetch(`/api/settings/notification-channels/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage("Notification de test envoyée.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-neutral-300"
      >
        <span>Autres canaux de notification (webhook, ntfy, Discord, Slack)</span>
        <span className="text-neutral-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-neutral-800 p-4">
          {!channels ? (
            <p className="text-sm text-neutral-500">Chargement...</p>
          ) : (
            <>
              {channels.length === 0 && (
                <p className="text-xs text-neutral-500">Aucun canal configuré pour l&apos;instant.</p>
              )}
              <ul className="space-y-2">
                {channels.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded border border-neutral-800 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="text-neutral-200">{c.label || TYPE_LABELS[c.type]}</span>{" "}
                      <span className="text-xs text-neutral-500">
                        ({TYPE_LABELS[c.type]}
                        {c.type === "ntfy" ? ` · ${c.ntfyServer}/${c.ntfyTopic}` : ""})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-neutral-400">
                        <input type="checkbox" checked={c.enabled} onChange={() => toggle(c)} disabled={busyId === c.id} />
                        Actif
                      </label>
                      <button
                        onClick={() => test(c.id)}
                        disabled={busyId === c.id}
                        className="rounded border border-neutral-600 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                      >
                        Tester
                      </button>
                      <button
                        onClick={() => remove(c.id)}
                        disabled={busyId === c.id}
                        className="rounded border border-red-900 px-2 py-0.5 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                      >
                        Supprimer
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="space-y-2 rounded border border-neutral-800 p-3">
                <p className="text-xs font-medium text-neutral-300">Ajouter un canal</p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Type</span>
                    <select
                      value={form.type}
                      onChange={(e) => setForm({ ...form, type: e.target.value as ChannelType })}
                      className={INPUT_CLASS}
                    >
                      {Object.entries(TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Nom (optionnel)</span>
                    <input
                      value={form.label}
                      onChange={(e) => setForm({ ...form, label: e.target.value })}
                      placeholder="ex: Discord #alertes"
                      className={INPUT_CLASS}
                    />
                  </label>

                  {form.type === "ntfy" ? (
                    <>
                      <label className="block">
                        <span className="mb-1 block text-xs text-neutral-400">Serveur ntfy</span>
                        <input
                          value={form.ntfyServer}
                          onChange={(e) => setForm({ ...form, ntfyServer: e.target.value })}
                          placeholder="https://ntfy.sh"
                          className={INPUT_CLASS}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs text-neutral-400">Sujet (topic)</span>
                        <input
                          value={form.ntfyTopic}
                          onChange={(e) => setForm({ ...form, ntfyTopic: e.target.value })}
                          placeholder="homelab-alertes"
                          className={INPUT_CLASS}
                        />
                      </label>
                      <label className="col-span-2 block">
                        <span className="mb-1 block text-xs text-neutral-400">
                          Jeton d&apos;accès (optionnel, pour un serveur ntfy privé)
                        </span>
                        <input
                          value={form.ntfyToken}
                          onChange={(e) => setForm({ ...form, ntfyToken: e.target.value })}
                          className={INPUT_CLASS}
                        />
                      </label>
                    </>
                  ) : (
                    <label className="col-span-2 block">
                      <span className="mb-1 block text-xs text-neutral-400">
                        URL {form.type === "webhook" ? "du webhook" : `du webhook ${TYPE_LABELS[form.type]}`}
                      </span>
                      <input
                        value={form.url}
                        onChange={(e) => setForm({ ...form, url: e.target.value })}
                        placeholder={
                          form.type === "discord"
                            ? "https://discord.com/api/webhooks/..."
                            : form.type === "slack"
                              ? "https://hooks.slack.com/services/..."
                              : "https://mon-automatisation.exemple.fr/webhook"
                        }
                        className={INPUT_CLASS}
                      />
                    </label>
                  )}
                </div>
                <button
                  onClick={createChannel}
                  disabled={creating}
                  className="rounded border border-neutral-600 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {creating ? "Ajout..." : "Ajouter ce canal"}
                </button>
              </div>

              {message && <p className="text-xs text-neutral-400">{message}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
