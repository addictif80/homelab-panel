"use client";

import { useState } from "react";

type Finding = {
  hostId: number;
  hostName: string;
  address: string;
  port: number;
  label: string;
  severity: "critical" | "warning";
};

export default function PortAuditPanel() {
  const [running, setRunning] = useState(false);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [ranAt, setRanAt] = useState<Date | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/security/port-audit", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur.");
      setFindings(data.findings);
      setRanAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">Auto-audit réseau</h2>
        <button
          onClick={run}
          disabled={running}
          className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
        >
          {running ? "Sondage en cours..." : "Auditer les ports de toute l'infra"}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Le panel tente une simple connexion TCP (sans authentification) vers chaque machine de l&apos;inventaire, sur
        des ports qui ne devraient jamais répondre depuis l&apos;extérieur (bases de données, Telnet, RDP, VNC, API
        Docker non chiffrée...). Aucune tentative de connexion réelle n&apos;est faite — ça ne risque donc pas de
        déclencher tes propres bans fail2ban.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {findings && (
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Machine</th>
                <th className="px-3 py-2 font-medium">Adresse</th>
                <th className="px-3 py-2 font-medium">Port ouvert</th>
                <th className="px-3 py-2 font-medium">Sévérité</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f, i) => (
                <tr key={`${f.hostId}-${f.port}-${i}`} className="border-t border-neutral-900">
                  <td className="px-3 py-2 text-neutral-200">{f.hostName}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400">{f.address}</td>
                  <td className="px-3 py-2 text-neutral-300">
                    {f.port} ({f.label})
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded border px-1.5 py-0 text-[10px] ${
                        f.severity === "critical"
                          ? "border-red-800 bg-red-950/40 text-red-300"
                          : "border-amber-800 bg-amber-950/40 text-amber-300"
                      }`}
                    >
                      {f.severity === "critical" ? "Critique" : "À surveiller"}
                    </span>
                  </td>
                </tr>
              ))}
              {findings.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-neutral-600">
                    Aucun port sensible détecté comme accessible — {ranAt?.toLocaleTimeString("fr-FR")}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
