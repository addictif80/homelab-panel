/** Catalog of widgets the "Vue d'ensemble" dashboard can show, and the layout new users (or a
 * login with no saved layout row) start with. Kept dependency-free (no db/fs imports) since both
 * the client (widget picker, drag-and-drop board) and the layout API route (validating a PUT'd
 * layout) import it. */
export type WidgetCategory = "Ressources" | "Sécurité" | "Fiabilité" | "Réseau" | "Autres";

export type WidgetDef = {
  id: string;
  title: string;
  category: WidgetCategory;
  description: string;
};

export const WIDGET_CATALOG: WidgetDef[] = [
  { id: "resources", title: "Ressources cumulées", category: "Ressources", description: "CPU, RAM et stockage cumulés sur toutes les machines joignables." },
  { id: "machines", title: "Machines", category: "Ressources", description: "Table des machines avec charge CPU/RAM/disque." },
  { id: "alerts", title: "Alertes machines", category: "Ressources", description: "Machines actuellement injoignables ou en erreur." },
  { id: "quickAccess", title: "Accès rapide", category: "Autres", description: "Raccourcis vers les modules principaux du panel." },
  { id: "docker", title: "Docker", category: "Ressources", description: "Conteneurs actifs/arrêtés par hôte." },
  { id: "proxmox", title: "Proxmox", category: "Ressources", description: "Nombre de nœuds Proxmox connus." },
  { id: "electricityCost", title: "Coût électrique", category: "Ressources", description: "Estimation de la consommation et du coût mensuel de l'infra." },
  { id: "securityFindings", title: "Scan de sécurité", category: "Sécurité", description: "Lance un scan à la demande et résume les failles trouvées." },
  { id: "blockedIps", title: "IPs bloquées", category: "Sécurité", description: "Dernières IPs bloquées automatiquement." },
  { id: "mailEvents", title: "Événements mail suspects", category: "Sécurité", description: "Derniers événements suspects détectés sur le mail." },
  { id: "lockdown", title: "Statut Lockdown", category: "Sécurité", description: "Indique si le mode Lockdown est actif." },
  { id: "backups", title: "Sauvegardes", category: "Fiabilité", description: "Statut du dernier run de chaque plan de sauvegarde." },
  { id: "backupRule321", title: "Règle 3-2-1", category: "Fiabilité", description: "Vérifie que chaque machine sauvegardée a bien 3 copies, sur 2 supports, dont 1 hors-site." },
  { id: "certificates", title: "Certificats SSL", category: "Fiabilité", description: "Domaines surveillés proches de l'expiration." },
  { id: "uptime", title: "Uptime Kuma", category: "Fiabilité", description: "Aperçu embarqué de ton instance Uptime Kuma." },
  { id: "maintenance", title: "Maintenance", category: "Fiabilité", description: "Nombre de fenêtres de maintenance configurées." },
  { id: "updates", title: "Mises à jour", category: "Fiabilité", description: "Machines avec une méthode de mise à jour configurée." },
  { id: "tailscale", title: "Tailscale", category: "Réseau", description: "Appareils connectés/déconnectés sur le tailnet." },
  { id: "publicIp", title: "IP publique", category: "Réseau", description: "IP publique actuelle du panel." },
  { id: "audit", title: "Journal d'audit", category: "Autres", description: "Dernières actions enregistrées sur le panel." },
  { id: "license", title: "Licence", category: "Autres", description: "Statut d'activation et jours d'essai restants." },
  { id: "notes", title: "Notes", category: "Autres", description: "Bloc-notes personnel, visible uniquement par toi." },
  { id: "logs", title: "Logs web & mail", category: "Autres", description: "Sources de logs suivies en direct." },
];

export const WIDGET_IDS = new Set(WIDGET_CATALOG.map((w) => w.id));

export function getWidgetDef(id: string): WidgetDef | undefined {
  return WIDGET_CATALOG.find((w) => w.id === id);
}

export type WidgetSize = "sm" | "md" | "lg";
export const WIDGET_SIZES: WidgetSize[] = ["sm", "md", "lg"];

export type DashboardBlock =
  | { kind: "widget"; id: string; widgetId: string; size: WidgetSize }
  | { kind: "separator"; id: string; label: string };

export type DashboardLayout = {
  columnCount: 1 | 2 | 3;
  /** One array per column (length === columnCount), each an ordered stack of blocks. */
  columns: DashboardBlock[][];
};

function isWidgetSize(v: unknown): v is WidgetSize {
  return v === "sm" || v === "md" || v === "lg";
}

function isValidBlock(b: unknown): b is DashboardBlock {
  if (!b || typeof b !== "object") return false;
  const block = b as Record<string, unknown>;
  if (typeof block.id !== "string" || !block.id) return false;
  if (block.kind === "widget") {
    return typeof block.widgetId === "string" && WIDGET_IDS.has(block.widgetId) && isWidgetSize(block.size);
  }
  if (block.kind === "separator") {
    return typeof block.label === "string" && block.label.length <= 200;
  }
  return false;
}

/** Validates a layout PUT'd by the client: right shape, known widget ids, no widget placed twice
 * across columns (a stray duplicate could otherwise wedge two DOM nodes onto one React/dnd-kit
 * key). Separators have no such uniqueness constraint — any number is fine. */
export function isValidLayout(raw: unknown): raw is DashboardLayout {
  if (!raw || typeof raw !== "object") return false;
  const layout = raw as Record<string, unknown>;
  if (layout.columnCount !== 1 && layout.columnCount !== 2 && layout.columnCount !== 3) return false;
  if (!Array.isArray(layout.columns) || layout.columns.length !== layout.columnCount) return false;
  const seenWidgetIds = new Set<string>();
  for (const column of layout.columns) {
    if (!Array.isArray(column)) return false;
    for (const block of column) {
      if (!isValidBlock(block)) return false;
      if (block.kind === "widget") {
        if (seenWidgetIds.has(block.widgetId)) return false;
        seenWidgetIds.add(block.widgetId);
      }
    }
  }
  return true;
}

function widgetBlock(widgetId: string): DashboardBlock {
  return { kind: "widget", id: widgetId, widgetId, size: "md" };
}

/** What a brand-new account (or any login with no saved `user_dashboard_layout` row, or one saved
 * by the previous single-column version — see migrateLegacyLayout) sees. */
export const DEFAULT_LAYOUT: DashboardLayout = {
  columnCount: 1,
  columns: [["resources", "machines", "quickAccess", "notes", "alerts", "logs"].map(widgetBlock)],
};

/** The dashboard's first version stored a plain string[] of widget ids (implicitly one column,
 * "md" size). Converts that shape into the current one so accounts that customized their
 * dashboard before columns/sizes/separators existed don't lose that customization. */
export function migrateLegacyLayout(raw: unknown): DashboardLayout | null {
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string" && WIDGET_IDS.has(id))) return null;
  return { columnCount: 1, columns: [raw.map(widgetBlock)] };
}
