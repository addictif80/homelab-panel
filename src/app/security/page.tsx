"use client";

import { useCallback, useEffect, useState } from "react";
import DetectionThresholdsPanel from "@/components/DetectionThresholdsPanel";
import SmtpSettingsPanel from "@/components/SmtpSettingsPanel";
import NotificationChannelsPanel from "@/components/NotificationChannelsPanel";
import CertificateWatchPanel from "@/components/CertificateWatchPanel";
import TrustedDevicesPanel from "@/components/TrustedDevicesPanel";
import SecurityLogsPanel from "@/components/SecurityLogsPanel";

type Severity = "critical" | "warning" | "info" | "good";

type Finding = {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  detail: string;
  fixId?: string;
  fixLabel?: string;
  fixWarning?: string;
  fixParams?: Record<string, string>;
  howTo?: string[];
  ignored?: boolean;
};

type HostScanResult = {
  hostId: number;
  hostName: string;
  hostKind: string;
  hostOs: string | null;
  findings: Finding[];
  error?: string;
};

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info", "good"];

const SEVERITY_STYLES: Record<Severity, { dot: string; badge: string; label: string }> = {
  critical: { dot: "bg-red-500", badge: "border-red-800 bg-red-950/40 text-red-300", label: "Critique" },
  warning: { dot: "bg-amber-500", badge: "border-amber-800 bg-amber-950/40 text-amber-300", label: "À surveiller" },
  info: { dot: "bg-blue-500", badge: "border-blue-900 bg-blue-950/30 text-blue-300", label: "Info" },
  good: { dot: "bg-emerald-500", badge: "border-emerald-900 bg-emerald-950/30 text-emerald-300", label: "OK" },
};

function activeFindings(host: HostScanResult): Finding[] {
  return host.findings.filter((f) => !f.ignored);
}

type SuspiciousIp = {
  ip: string;
  severity: Severity;
  hosts: { hostId: number; hostName: string; findingId: string; title: string; detail: string }[];
};

/** Flattens every "block-ip" finding across all hosts into one IP-centric list, so a suspicious
 * address that shows up on several machines (or that would otherwise require scrolling through
 * every host card to spot) is visible and actionable from a single place. */
function collectSuspiciousIps(results: HostScanResult[]): SuspiciousIp[] {
  const byIp = new Map<string, SuspiciousIp>();
  for (const host of results) {
    for (const finding of host.findings) {
      if (finding.ignored || finding.fixId !== "block-ip" || !finding.fixParams?.ip) continue;
      const ip = finding.fixParams.ip;
      const entry = byIp.get(ip) ?? { ip, severity: finding.severity, hosts: [] };
      entry.hosts.push({
        hostId: host.hostId,
        hostName: host.hostName,
        findingId: finding.id,
        title: finding.title,
        detail: finding.detail,
      });
      if (SEVERITY_ORDER.indexOf(finding.severity) < SEVERITY_ORDER.indexOf(entry.severity)) {
        entry.severity = finding.severity;
      }
      byIp.set(ip, entry);
    }
  }
  return Array.from(byIp.values()).sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

function hostScore(host: HostScanResult): Severity {
  if (host.error) return "warning";
  const active = activeFindings(host);
  if (active.some((f) => f.severity === "critical")) return "critical";
  if (active.some((f) => f.severity === "warning")) return "warning";
  if (active.some((f) => f.severity === "info")) return "info";
  return "good";
}

export default function SecurityPage() {
  const [results, setResults] = useState<HostScanResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<{ hostId: number; finding: Finding } | null>(null);
  const [applying, setApplying] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [expandedHowTo, setExpandedHowTo] = useState<Set<string>>(new Set());
  const [ignoring, setIgnoring] = useState<string | null>(null);
  const [blockModal, setBlockModal] = useState<{
    ip: SuspiciousIp;
    scope: "host" | "all";
    targetHostId: number;
  } | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [blockedIps, setBlockedIps] = useState<{ ip: string; blockedAt: string }[]>([]);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/security/scan");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec de l'analyse.");
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshBlockedIps = useCallback(async () => {
    const res = await fetch("/api/security/blocked-ips");
    if (!res.ok) return;
    const data = await res.json();
    setBlockedIps(data.blockedIps);
  }, []);

  useEffect(() => {
    runScan();
    refreshBlockedIps();
  }, [runScan, refreshBlockedIps]);

  async function unblockIp(ip: string) {
    setUnblocking(ip);
    try {
      const res = await fetch("/api/security/blocked-ips/unblock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec du déblocage.");
      setStatusMsg(data.message);
      await refreshBlockedIps();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setUnblocking(null);
    }
  }

  async function applyFix() {
    if (!confirming) return;
    const { hostId, finding } = confirming;
    setApplying(true);
    try {
      const res = await fetch(`/api/security/hosts/${hostId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixId: finding.fixId, params: finding.fixParams }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec du correctif.");
      setStatusMsg(data.result.message);
      setResults((prev) => (prev ? prev.map((h) => (h.hostId === hostId ? data.rescan : h)) : prev));
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setApplying(false);
      setConfirming(null);
    }
  }

  function openBlockModal(ip: SuspiciousIp) {
    setBlockModal({ ip, scope: "host", targetHostId: ip.hosts[0].hostId });
  }

  async function applyBlock() {
    if (!blockModal) return;
    const { ip, scope, targetHostId } = blockModal;
    setBlocking(true);
    try {
      const res = await fetch(`/api/security/hosts/${targetHostId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixId: scope === "all" ? "block-ip-everywhere" : "block-ip",
          params: { ip: ip.ip },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec du blocage.");
      setStatusMsg(data.result.message);
      if (scope === "all") {
        await runScan();
      } else {
        setResults((prev) => (prev ? prev.map((h) => (h.hostId === targetHostId ? data.rescan : h)) : prev));
      }
      await refreshBlockedIps();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBlocking(false);
      setBlockModal(null);
    }
  }

  async function setIgnored(hostId: number, findingId: string, ignore: boolean) {
    const key = `${hostId}:${findingId}`;
    setIgnoring(key);
    try {
      await fetch(`/api/security/hosts/${hostId}/ignore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId, ignore }),
      });
      setResults((prev) =>
        prev
          ? prev.map((h) =>
              h.hostId !== hostId
                ? h
                : { ...h, findings: h.findings.map((f) => (f.id === findingId ? { ...f, ignored: ignore } : f)) }
            )
          : prev
      );
    } finally {
      setIgnoring(null);
    }
  }

  function toggleHowTo(key: string) {
    setExpandedHowTo((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const totalCritical =
    results?.reduce((n, h) => n + activeFindings(h).filter((f) => f.severity === "critical").length, 0) ?? 0;
  const totalWarning =
    results?.reduce((n, h) => n + activeFindings(h).filter((f) => f.severity === "warning").length, 0) ?? 0;
  const suspiciousIps = results ? collectSuspiciousIps(results) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Centre de sécurité</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Analyse l&apos;ensemble de ton infrastructure (machines physiques, VM, VPS, NAS, routeur) et propose des
            corrections simples, à valider toi-même avant chaque action.
          </p>
        </div>
        <button
          onClick={runScan}
          disabled={loading}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Analyse en cours..." : "Relancer l'analyse"}
        </button>
      </div>

      {error && <div className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}
      {statusMsg && (
        <div className="rounded border border-neutral-700 bg-neutral-900 p-3 text-sm text-neutral-300">{statusMsg}</div>
      )}

      {results && (
        <div className="flex gap-4 text-sm">
          <div className="rounded border border-red-900 bg-red-950/20 px-4 py-2 text-red-300">
            {totalCritical} problème{totalCritical !== 1 ? "s" : ""} critique{totalCritical !== 1 ? "s" : ""}
          </div>
          <div className="rounded border border-amber-900 bg-amber-950/20 px-4 py-2 text-amber-300">
            {totalWarning} point{totalWarning !== 1 ? "s" : ""} à surveiller
          </div>
        </div>
      )}

      {!results && loading && <div className="text-sm text-neutral-500">Analyse de toutes les machines en cours (SSH)...</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <SecurityLogsPanel />

        <div className="space-y-4">
          <div className="rounded border border-neutral-800 bg-neutral-900">
            <div className="border-b border-neutral-800 px-4 py-3">
              <h2 className="text-sm font-semibold text-neutral-100">
                Adresses IP suspectes {suspiciousIps.length > 0 ? `(${suspiciousIps.length})` : ""}
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                Vue regroupée de toutes les machines — pas besoin de défiler host par host.
              </p>
            </div>
            {suspiciousIps.length === 0 ? (
              <p className="p-4 text-sm text-neutral-500">Aucune IP suspecte détectée.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-neutral-800 text-xs text-neutral-500">
                      <th className="px-4 py-2 font-normal">IP</th>
                      <th className="px-4 py-2 font-normal">Sévérité</th>
                      <th className="px-4 py-2 font-normal">Machines concernées</th>
                      <th className="px-4 py-2 font-normal"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {suspiciousIps.map((entry) => {
                      const style = SEVERITY_STYLES[entry.severity];
                      return (
                        <tr key={entry.ip} className="border-b border-neutral-800 last:border-0 align-top">
                          <td className="px-4 py-2 font-mono text-xs text-neutral-100">{entry.ip}</td>
                          <td className="px-4 py-2">
                            <span className={`rounded border px-1.5 py-0 text-[10px] ${style.badge}`}>{style.label}</span>
                          </td>
                          <td className="px-4 py-2 text-xs text-neutral-300">
                            <div className="flex flex-wrap gap-1">
                              {entry.hosts.map((h) => (
                                <span key={h.hostId} className="rounded border border-neutral-700 px-1.5 py-0.5">
                                  {h.hostName}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              onClick={() => openBlockModal(entry)}
                              className="rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                            >
                              Bloquer
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded border border-neutral-800 bg-neutral-900">
            <div className="border-b border-neutral-800 px-4 py-3">
              <h2 className="text-sm font-semibold text-neutral-100">
                IPs bloquées {blockedIps.length > 0 ? `(${blockedIps.length})` : ""}
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                Débloquer retire la règle sur toutes les machines de l&apos;infrastructure d&apos;un coup.
              </p>
            </div>
            {blockedIps.length === 0 ? (
              <p className="p-4 text-sm text-neutral-500">Aucune IP bloquée actuellement.</p>
            ) : (
              <ul className="divide-y divide-neutral-800">
                {blockedIps.map((entry) => (
                  <li key={entry.ip} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <span className="font-mono text-sm text-neutral-100">{entry.ip}</span>
                      <span className="ml-2 text-xs text-neutral-500">
                        Bloquée le {new Date(entry.blockedAt).toLocaleString("fr-FR")}
                      </span>
                    </div>
                    <button
                      onClick={() => unblockIp(entry.ip)}
                      disabled={unblocking === entry.ip}
                      className="rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                    >
                      {unblocking === entry.ip ? "Déblocage..." : "Débloquer"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-neutral-100">Analyse par machine</h2>
        {results
          ?.slice()
          .sort((a, b) => SEVERITY_ORDER.indexOf(hostScore(a)) - SEVERITY_ORDER.indexOf(hostScore(b)))
          .map((host) => {
            const score = hostScore(host);
            const style = SEVERITY_STYLES[score];
            return (
              <div key={host.hostId} className="rounded border border-neutral-800 bg-neutral-900">
                <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
                    <span className="font-medium text-neutral-100">{host.hostName}</span>
                    <span className="text-xs text-neutral-500">
                      {host.hostKind}
                      {host.hostOs ? ` · ${host.hostOs}` : ""}
                    </span>
                  </div>
                  <span className={`rounded border px-2 py-0.5 text-xs ${style.badge}`}>{style.label}</span>
                </div>

                <div className="p-4">
                  {host.error && <p className="text-sm text-amber-400">Analyse impossible : {host.error}</p>}

                  {!host.error && host.findings.length === 0 && (
                    <p className="text-sm text-emerald-400">Aucun problème détecté sur cette machine.</p>
                  )}

                  {!host.error && host.findings.length > 0 && (
                    <ul className="space-y-3">
                      {host.findings
                        .slice()
                        .sort((a, b) => {
                          if (!!a.ignored !== !!b.ignored) return a.ignored ? 1 : -1;
                          return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
                        })
                        .map((finding) => {
                          const fStyle = SEVERITY_STYLES[finding.severity];
                          const howToKey = `${host.hostId}:${finding.id}`;
                          const busy = ignoring === howToKey;
                          return (
                            <li
                              key={finding.id}
                              className={`rounded border border-neutral-800 p-3 ${finding.ignored ? "opacity-50" : ""}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className={`rounded border px-1.5 py-0 text-[10px] ${fStyle.badge}`}>
                                      {fStyle.label}
                                    </span>
                                    {finding.ignored && (
                                      <span className="rounded border border-neutral-700 px-1.5 py-0 text-[10px] text-neutral-500">
                                        Ignorée
                                      </span>
                                    )}
                                    <span className="text-sm font-medium text-neutral-100">{finding.title}</span>
                                  </div>
                                  <p className="mt-1 text-xs leading-relaxed text-neutral-400">{finding.detail}</p>

                                  {finding.howTo && finding.howTo.length > 0 && (
                                    <div className="mt-2">
                                      <button
                                        onClick={() => toggleHowTo(howToKey)}
                                        className="text-xs text-blue-400 hover:underline"
                                      >
                                        {expandedHowTo.has(howToKey) ? "Masquer" : "Comment corriger (commandes)"}
                                      </button>
                                      {expandedHowTo.has(howToKey) && (
                                        <pre className="mt-2 overflow-x-auto rounded border border-neutral-800 bg-black p-2 text-[11px] text-neutral-300">
                                          {finding.howTo.join("\n")}
                                        </pre>
                                      )}
                                    </div>
                                  )}
                                </div>

                                <div className="flex shrink-0 flex-col items-end gap-1">
                                  {finding.fixId === "block-ip" && !finding.ignored && finding.fixParams?.ip && (
                                    <button
                                      onClick={() =>
                                        openBlockModal({
                                          ip: finding.fixParams!.ip,
                                          severity: finding.severity,
                                          hosts: [
                                            {
                                              hostId: host.hostId,
                                              hostName: host.hostName,
                                              findingId: finding.id,
                                              title: finding.title,
                                              detail: finding.detail,
                                            },
                                          ],
                                        })
                                      }
                                      className="rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                                    >
                                      {finding.fixLabel || "Corriger"}
                                    </button>
                                  )}
                                  {finding.fixId && finding.fixId !== "block-ip" && !finding.ignored && (
                                    <button
                                      onClick={() => setConfirming({ hostId: host.hostId, finding })}
                                      className="rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                                    >
                                      {finding.fixLabel || "Corriger"}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setIgnored(host.hostId, finding.id, !finding.ignored)}
                                    disabled={busy}
                                    className="text-xs text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
                                  >
                                    {finding.ignored ? "Réactiver" : "Ignorer"}
                                  </button>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      <div className="space-y-3">
        <DetectionThresholdsPanel />
        <SmtpSettingsPanel />
        <NotificationChannelsPanel />
        <CertificateWatchPanel onChanged={runScan} />
        <TrustedDevicesPanel />
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded border border-neutral-700 bg-neutral-900 p-5">
            <h2 className="text-sm font-semibold text-neutral-100">Confirmer l&apos;action</h2>
            <p className="mt-2 text-sm text-neutral-300">{confirming.finding.fixLabel}</p>
            <p className="mt-1 text-xs text-neutral-500">Machine : {results?.find((h) => h.hostId === confirming.hostId)?.hostName}</p>
            {confirming.finding.fixWarning && (
              <p className="mt-3 rounded border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-300">
                {confirming.finding.fixWarning}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirming(null)}
                disabled={applying}
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Annuler
              </button>
              <button
                onClick={applyFix}
                disabled={applying}
                className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
              >
                {applying ? "Application..." : "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {blockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded border border-neutral-700 bg-neutral-900 p-5">
            <h2 className="text-sm font-semibold text-neutral-100">
              Bloquer <span className="font-mono">{blockModal.ip.ip}</span>
            </h2>
            <p className="mt-2 text-xs text-neutral-500">
              Repérée sur : {blockModal.ip.hosts.map((h) => h.hostName).join(", ")}
            </p>

            <div className="mt-4 space-y-2">
              <label className="flex items-start gap-2 rounded border border-neutral-700 p-2.5 text-sm">
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={blockModal.scope === "host"}
                  onChange={() => setBlockModal({ ...blockModal, scope: "host" })}
                />
                <span>
                  <span className="block text-neutral-200">Bloquer sur un serveur ciblé</span>
                  {blockModal.ip.hosts.length > 1 ? (
                    <select
                      value={blockModal.targetHostId}
                      onChange={(e) => setBlockModal({ ...blockModal, targetHostId: Number(e.target.value) })}
                      className="mt-1.5 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
                    >
                      {blockModal.ip.hosts.map((h) => (
                        <option key={h.hostId} value={h.hostId}>
                          {h.hostName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-neutral-500">{blockModal.ip.hosts[0].hostName}</span>
                  )}
                </span>
              </label>

              <label className="flex items-start gap-2 rounded border border-neutral-700 p-2.5 text-sm">
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={blockModal.scope === "all"}
                  onChange={() => setBlockModal({ ...blockModal, scope: "all" })}
                />
                <span>
                  <span className="block text-neutral-200">Bloquer sur toute l&apos;infrastructure</span>
                  <span className="text-xs text-neutral-500">Réplique le blocage sur chaque machine de l&apos;inventaire.</span>
                </span>
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setBlockModal(null)}
                disabled={blocking}
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Annuler
              </button>
              <button
                onClick={applyBlock}
                disabled={blocking}
                className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
              >
                {blocking ? "Blocage..." : "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
