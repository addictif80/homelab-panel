import { getDb } from "../db";

export type OutageRow = {
  id: number;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
};

export type OutageSummary = {
  outages: OutageRow[];
  totalOutages: number;
  totalDowntimeMinutes: number;
  longestOutageMinutes: number | null;
  ongoing: boolean;
};

type Row = { id: number; started_at: string; ended_at: string | null };

function withDuration(row: Row): OutageRow {
  const durationMinutes = row.ended_at
    ? Math.round((new Date(`${row.ended_at}Z`).getTime() - new Date(`${row.started_at}Z`).getTime()) / 60_000)
    : null;
  return { id: row.id, startedAt: row.started_at, endedAt: row.ended_at, durationMinutes };
}

export function getOutageSummary(sinceDays = 90): OutageSummary {
  const rows = getDb()
    .prepare(`SELECT id, started_at, ended_at FROM isp_outages WHERE started_at >= datetime('now', ?) ORDER BY started_at DESC`)
    .all(`-${sinceDays} days`) as Row[];

  const outages = rows.map(withDuration);
  const closed = outages.filter((o) => o.durationMinutes !== null);
  const totalDowntimeMinutes = closed.reduce((sum, o) => sum + (o.durationMinutes ?? 0), 0);
  const longestOutageMinutes = closed.length > 0 ? Math.max(...closed.map((o) => o.durationMinutes ?? 0)) : null;

  return {
    outages,
    totalOutages: outages.length,
    totalDowntimeMinutes,
    longestOutageMinutes,
    ongoing: outages.some((o) => o.endedAt === null),
  };
}

function formatDate(iso: string): string {
  // Stored as UTC ("YYYY-MM-DD HH:MM:SS"), rendered in the panel's local time so the report reads
  // in the timezone the person filing the ISP claim actually lives in.
  return new Date(`${iso}Z`).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "medium" });
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "en cours";
  if (minutes < 1) return "< 1 min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/**
 * A plain-text report meant to be attached to an ISP complaint or compensation request: every
 * outage this panel itself observed, with start/end timestamps and duration — generated from
 * probes against three independent public DNS resolvers (never the ISP's own status page), so
 * it's evidence the ISP can't just claim the panel invented.
 */
export function generateOutageReportText(sinceDays = 90): string {
  const summary = getOutageSummary(sinceDays);
  const lines: string[] = [];
  lines.push("PREUVE DE COUPURES INTERNET");
  lines.push(`Période couverte : ${sinceDays} derniers jours — généré le ${formatDate(new Date().toISOString().slice(0, 19).replace("T", " "))}`);
  lines.push("");
  lines.push(
    "Méthode : le panel Homelab Panel tente une connexion réseau vers trois résolveurs DNS publics et " +
      "indépendants (Cloudflare 1.1.1.1, Google 8.8.8.8, Quad9 9.9.9.9) toutes les 60 secondes. Une coupure " +
      "n'est enregistrée que lorsque les trois échouent simultanément, ce qui exclut une panne isolée d'un " +
      "seul de ces fournisseurs."
  );
  lines.push("");
  lines.push(`Nombre de coupures détectées : ${summary.totalOutages}`);
  lines.push(`Temps de coupure cumulé : ${formatDuration(summary.totalDowntimeMinutes)}`);
  if (summary.longestOutageMinutes !== null) {
    lines.push(`Coupure la plus longue : ${formatDuration(summary.longestOutageMinutes)}`);
  }
  lines.push("");
  lines.push("Détail des coupures :");
  if (summary.outages.length === 0) {
    lines.push("(aucune coupure détectée sur cette période)");
  } else {
    for (const o of summary.outages) {
      const end = o.endedAt ? formatDate(o.endedAt) : "toujours en cours au moment de la génération";
      lines.push(`- Du ${formatDate(o.startedAt)} au ${end} — durée : ${formatDuration(o.durationMinutes)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
