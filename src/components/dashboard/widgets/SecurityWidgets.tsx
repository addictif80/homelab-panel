"use client";

import { useEffect, useState } from "react";
import { MiniStat, WidgetLoading } from "../shared";
import type { Finding } from "@/lib/security/types";

export function BlockedIpsWidget() {
  const [ips, setIps] = useState<{ ip: string; blockedAt: string }[] | null>(null);

  useEffect(() => {
    fetch("/api/security/blocked-ips")
      .then((r) => r.json())
      .then((d) => setIps(d.blockedIps ?? []))
      .catch(() => setIps([]));
  }, []);

  if (ips === null) return <WidgetLoading />;
  if (ips.length === 0) return <p className="text-xs text-neutral-500">Aucune IP bloquée pour l&apos;instant.</p>;

  return (
    <div className="space-y-1.5">
      <div className="text-2xl font-bold tabular-nums">{ips.length}</div>
      <div className="text-xs text-neutral-500">IP(s) bloquée(s)</div>
      <ul className="mt-2 space-y-1 text-xs text-neutral-400">
        {ips.slice(0, 4).map((b) => (
          <li key={b.ip} className="flex justify-between font-mono">
            <span>{b.ip}</span>
            <span className="text-neutral-600">{new Date(b.blockedAt).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
      <a href="/security" className="mt-2 inline-block text-xs text-blue-600 hover:underline">
        Voir plus →
      </a>
    </div>
  );
}

export function MailEventsWidget() {
  const [events, setEvents] = useState<{ id: number; senderEmail: string | null; ipAddress: string | null; receivedAt: string }[] | null>(null);

  useEffect(() => {
    fetch("/api/security/mail-log")
      .then((r) => r.json())
      .then((d) => setEvents((d.events ?? []).slice(0, 4)))
      .catch(() => setEvents([]));
  }, []);

  if (events === null) return <WidgetLoading />;
  if (events.length === 0) return <p className="text-xs text-neutral-500">Aucun événement mail récent.</p>;

  return (
    <div className="space-y-1.5">
      <ul className="space-y-1.5 text-xs">
        {events.map((e) => (
          <li key={e.id} className="flex justify-between gap-2 text-neutral-400">
            <span className="truncate">{e.senderEmail ?? e.ipAddress ?? "Inconnu"}</span>
            <span className="shrink-0 text-neutral-600">{new Date(e.receivedAt).toLocaleTimeString()}</span>
          </li>
        ))}
      </ul>
      <a href="/mail-security" className="mt-1 inline-block text-xs text-blue-600 hover:underline">
        Voir plus →
      </a>
    </div>
  );
}

export function LockdownWidget() {
  const [state, setState] = useState<{ active: boolean; activatedAt: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/security/lockdown")
      .then((r) => r.json())
      .then(setState)
      .catch(() => setState({ active: false, activatedAt: null }));
  }, []);

  if (state === null) return <WidgetLoading />;

  return (
    <MiniStat
      value={state.active ? "Actif" : "Inactif"}
      label={state.active && state.activatedAt ? `depuis le ${new Date(state.activatedAt).toLocaleString()}` : "Mode Lockdown"}
      tone={state.active ? "danger" : "success"}
      href="/security"
    />
  );
}

/** Unlike the other security widgets (cheap DB reads), a full scan probes every host over SSH —
 * expensive enough that it must never run just because this widget happens to be on screen. It
 * only fires on an explicit click, same trade-off the Security Center page itself makes. */
export function SecurityFindingsWidget() {
  const [results, setResults] = useState<{ findings: Finding[] }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runScan() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/security/scan");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur.");
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  if (results === null) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-neutral-500">
          Scanne toutes les machines par SSH — pas exécuté automatiquement pour ne pas les solliciter à chaque visite.
        </p>
        <button
          onClick={runScan}
          disabled={loading}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Scan en cours..." : "Lancer le scan"}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  const active = results.flatMap((r) => r.findings).filter((f) => !f.ignored && f.severity !== "good");
  const counts = { critical: 0, warning: 0, info: 0 } as Record<string, number>;
  for (const f of active) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold tabular-nums">{active.length}</span>
        <span className="text-xs text-neutral-500">faille(s) trouvée(s)</span>
      </div>
      <div className="flex gap-3 text-xs">
        <span className="text-red-400">{counts.critical ?? 0} critiques</span>
        <span className="text-amber-400">{counts.warning ?? 0} avertissements</span>
        <span className="text-neutral-500">{counts.info ?? 0} infos</span>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={runScan} disabled={loading} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
          {loading ? "Scan en cours..." : "Relancer"}
        </button>
        <a href="/security" className="text-xs text-blue-600 hover:underline">
          Voir le détail →
        </a>
      </div>
    </div>
  );
}
