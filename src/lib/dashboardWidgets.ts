/** Catalog of widgets the "Vue d'ensemble" dashboard can show, and the order/selection new users
 * (or a login with no saved layout row) start with. Kept dependency-free (no db/fs imports) since
 * both the client (widget picker, drag-and-drop grid) and the layout API route (validating a
 * PUT'd layout) import it. */
export type WidgetCategory = "Ressources" | "Sécurité" | "Fiabilité" | "Réseau" | "Autres";

export type WidgetDef = {
  id: string;
  title: string;
  category: WidgetCategory;
  description: string;
  /** Grid span at desktop width — most widgets are a single column-ish tile ("sm"); a few need
   * the wide two-column slot (machines table, logs panel, quick access grid). */
  size: "sm" | "lg";
};

export const WIDGET_CATALOG: WidgetDef[] = [
  { id: "resources", title: "Ressources cumulées", category: "Ressources", description: "CPU, RAM et stockage cumulés sur toutes les machines joignables.", size: "lg" },
  { id: "machines", title: "Machines", category: "Ressources", description: "Table des machines avec charge CPU/RAM/disque.", size: "lg" },
  { id: "alerts", title: "Alertes machines", category: "Ressources", description: "Machines actuellement injoignables ou en erreur.", size: "sm" },
  { id: "quickAccess", title: "Accès rapide", category: "Autres", description: "Raccourcis vers les modules principaux du panel.", size: "lg" },
  { id: "docker", title: "Docker", category: "Ressources", description: "Conteneurs actifs/arrêtés par hôte.", size: "sm" },
  { id: "proxmox", title: "Proxmox", category: "Ressources", description: "Nombre de nœuds Proxmox connus.", size: "sm" },
  { id: "securityFindings", title: "Scan de sécurité", category: "Sécurité", description: "Lance un scan à la demande et résume les failles trouvées.", size: "sm" },
  { id: "blockedIps", title: "IPs bloquées", category: "Sécurité", description: "Dernières IPs bloquées automatiquement.", size: "sm" },
  { id: "mailEvents", title: "Événements mail suspects", category: "Sécurité", description: "Derniers événements suspects détectés sur le mail.", size: "sm" },
  { id: "lockdown", title: "Statut Lockdown", category: "Sécurité", description: "Indique si le mode Lockdown est actif.", size: "sm" },
  { id: "backups", title: "Sauvegardes", category: "Fiabilité", description: "Statut du dernier run de chaque plan de sauvegarde.", size: "sm" },
  { id: "certificates", title: "Certificats SSL", category: "Fiabilité", description: "Domaines surveillés proches de l'expiration.", size: "sm" },
  { id: "uptime", title: "Uptime Kuma", category: "Fiabilité", description: "Aperçu embarqué de ton instance Uptime Kuma.", size: "sm" },
  { id: "maintenance", title: "Maintenance", category: "Fiabilité", description: "Nombre de fenêtres de maintenance configurées.", size: "sm" },
  { id: "updates", title: "Mises à jour", category: "Fiabilité", description: "Machines avec une méthode de mise à jour configurée.", size: "sm" },
  { id: "tailscale", title: "Tailscale", category: "Réseau", description: "Appareils connectés/déconnectés sur le tailnet.", size: "sm" },
  { id: "publicIp", title: "IP publique", category: "Réseau", description: "IP publique actuelle du panel.", size: "sm" },
  { id: "audit", title: "Journal d'audit", category: "Autres", description: "Dernières actions enregistrées sur le panel.", size: "sm" },
  { id: "license", title: "Licence", category: "Autres", description: "Statut d'activation et jours d'essai restants.", size: "sm" },
  { id: "notes", title: "Notes", category: "Autres", description: "Bloc-notes personnel, visible uniquement par toi.", size: "sm" },
  { id: "logs", title: "Logs web & mail", category: "Autres", description: "Sources de logs suivies en direct.", size: "sm" },
];

export const WIDGET_IDS = new Set(WIDGET_CATALOG.map((w) => w.id));

export function getWidgetDef(id: string): WidgetDef | undefined {
  return WIDGET_CATALOG.find((w) => w.id === id);
}

/** What a brand-new account (or any login with no saved `user_dashboard_layout` row) sees —
 * matches the dashboard's previous, non-customizable layout so upgrading never rearranges an
 * existing user's screen. */
export const DEFAULT_LAYOUT: string[] = [
  "resources",
  "machines",
  "quickAccess",
  "notes",
  "alerts",
  "logs",
];
