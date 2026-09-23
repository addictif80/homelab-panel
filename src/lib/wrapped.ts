import { getDb } from "./db";

export type WrappedCard = { id: string; kicker: string; value: string; subtitle: string; color: string };

type CountRow = { c: number };
type TextRow = { t: string | null };

function count(sql: string, ...params: unknown[]): number {
  return (getDb().prepare(sql).get(...params) as CountRow).c;
}

/**
 * A fun, shareable recap built entirely from what the panel actually recorded — no invented
 * numbers. Anything the panel doesn't persist long-term (pulse_history is a rolling 24h window,
 * for instance — see pulseRecorder.ts) is left out rather than approximated, since a "wrapped"
 * with a made-up uptime percentage would undermine the one built from real data next to it.
 */
export function generateWrapped(): WrappedCard[] {
  const db = getDb();
  const cards: WrappedCard[] = [];

  const since = (db.prepare(`SELECT MIN(created_at) as t FROM audit_log`).get() as TextRow).t;
  const sinceDate = since ? new Date(`${since}Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : null;

  const hostCount = count(`SELECT COUNT(*) as c FROM hosts`);
  cards.push({
    id: "fleet",
    kicker: sinceDate ? `Depuis le ${sinceDate}` : "Ton homelab",
    value: `${hostCount} machine${hostCount !== 1 ? "s" : ""}`,
    subtitle: hostCount === 0 ? "Un inventaire encore vide — à toi de jouer." : `géré${hostCount !== 1 ? "es" : "e"} depuis un seul panel.`,
    color: "from-indigo-500 to-blue-600",
  });

  const totalActions = count(`SELECT COUNT(*) as c FROM audit_log`);
  cards.push({
    id: "actions",
    kicker: "Actions au compteur",
    value: totalActions.toLocaleString("fr-FR"),
    subtitle: "clics, commandes et déploiements passés par le panel plutôt qu'à la main.",
    color: "from-fuchsia-500 to-purple-600",
  });

  const backupSuccess = count(`SELECT COUNT(*) as c FROM backup_runs WHERE status = 'success'`);
  const backupPlans = count(`SELECT COUNT(*) as c FROM backup_plans WHERE enabled = 1`);
  cards.push({
    id: "backups",
    kicker: "Sauvegardes réussies",
    value: backupSuccess.toLocaleString("fr-FR"),
    subtitle:
      backupPlans === 0
        ? "Aucun plan actif pour l'instant."
        : `sur ${backupPlans} plan${backupPlans !== 1 ? "s" : ""} actif${backupPlans !== 1 ? "s" : ""}. Autant de nuits plus tranquilles.`,
    color: "from-emerald-500 to-teal-600",
  });

  const updatesApplied = count(`SELECT COUNT(*) as c FROM update_jobs WHERE status = 'success' AND mode = 'apply'`);
  cards.push({
    id: "updates",
    kicker: "Mises à jour appliquées",
    value: updatesApplied.toLocaleString("fr-FR"),
    subtitle: "en un clic, sans SSH manuel à chaque fois.",
    color: "from-amber-500 to-orange-600",
  });

  const fixesApplied = count(`SELECT COUNT(*) as c FROM audit_log WHERE action = 'security.fix'`);
  cards.push({
    id: "security",
    kicker: "Failles corrigées",
    value: fixesApplied.toLocaleString("fr-FR"),
    subtitle: fixesApplied === 0 ? "Le Centre de sécurité attend son premier scan." : "directement depuis le Centre de sécurité, en un clic à chaque fois.",
    color: "from-red-500 to-rose-600",
  });

  const busiestDay = db
    .prepare(
      `SELECT date(created_at) as day, COUNT(*) as c FROM audit_log GROUP BY day ORDER BY c DESC LIMIT 1`
    )
    .get() as { day: string; c: number } | undefined;
  if (busiestDay) {
    cards.push({
      id: "busiest-day",
      kicker: "Le jour le plus chargé",
      value: new Date(busiestDay.day).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }),
      subtitle: `${busiestDay.c} action${busiestDay.c !== 1 ? "s" : ""} en une seule journée. Une bonne, ou une mauvaise journée ?`,
      color: "from-cyan-500 to-sky-600",
    });
  }

  const topAction = db
    .prepare(
      `SELECT substr(action, 1, instr(action || '.', '.') - 1) as prefix, COUNT(*) as c
       FROM audit_log GROUP BY prefix ORDER BY c DESC LIMIT 1`
    )
    .get() as { prefix: string; c: number } | undefined;
  const PREFIX_LABELS: Record<string, string> = {
    ssh: "Le terminal SSH",
    backup: "Les sauvegardes",
    security: "Le Centre de sécurité",
    files: "L'explorateur de fichiers",
    login: "La connexion",
    docker: "Docker",
    update: "Les mises à jour",
  };
  if (topAction) {
    cards.push({
      id: "top-feature",
      kicker: "Ta fonctionnalité préférée (sans le savoir)",
      value: PREFIX_LABELS[topAction.prefix] ?? topAction.prefix,
      subtitle: `${topAction.c} action${topAction.c !== 1 ? "s" : ""} — c'est celle que tu as le plus utilisée.`,
      color: "from-violet-500 to-indigo-600",
    });
  }

  cards.push({
    id: "outro",
    kicker: "Et la suite ?",
    value: "🎉",
    subtitle: "Continue comme ça — ou va régler ce qui traîne encore dans le Centre de sécurité.",
    color: "from-pink-500 to-rose-500",
  });

  return cards;
}
