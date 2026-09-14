import { getDb } from "./db";

type HostRow = {
  id: number;
  name: string;
  kind: string;
  role: string | null;
  os: string | null;
  cluster: string | null;
  lan_ip: string | null;
  tailscale_ip: string | null;
  public_ip: string | null;
  ssh_port: number;
  docker_enabled: number;
  proxmox_node: string | null;
  notes: string | null;
};

type LinkRow = { a_name: string; b_name: string; link_type: string };
type BackupPlanRow = { name: string; source_type: string; schedule: string; retention_count: number; source_host: string; dest_host: string };

const KIND_LABELS: Record<string, string> = {
  physical: "Serveur physique",
  vm: "VM",
  lxc: "Conteneur LXC",
  vps: "VPS",
  nas: "NAS",
  router: "Routeur / box",
};

/**
 * A human-readable rebuild reference — deliberately NOT a data export (see recoveryVault.ts for
 * that): no credentials, tokens, or encrypted blobs, only what someone else would need to
 * understand and start recovering the infrastructure in an emergency. Safe to print, safe to keep
 * next to the encrypted vault rather than as sensitive as it.
 */
export function generateSurvivalDoc(): string {
  const db = getDb();
  const hosts = db.prepare(`SELECT * FROM hosts ORDER BY kind, name`).all() as HostRow[];
  const links = db
    .prepare(
      `SELECT ha.name as a_name, hb.name as b_name, l.link_type FROM network_links l
       JOIN hosts ha ON ha.id = l.host_a_id JOIN hosts hb ON hb.id = l.host_b_id
       ORDER BY l.link_type, ha.name`
    )
    .all() as LinkRow[];
  const backupPlans = db
    .prepare(
      `SELECT p.name, p.source_type, p.schedule, p.retention_count,
              sh.name as source_host, dh.name as dest_host
       FROM backup_plans p
       JOIN hosts sh ON sh.id = p.source_host_id
       JOIN hosts dh ON dh.id = p.dest_host_id
       ORDER BY p.name`
    )
    .all() as BackupPlanRow[];

  const lines: string[] = [];
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  lines.push(`# Manuel de survie — Homelab Panel`);
  lines.push("");
  lines.push(`Généré le ${now}. Document de référence pour reconstruire ou dépanner l'infrastructure —`);
  lines.push(`ne contient aucun mot de passe, clé ou jeton. Les secrets eux-mêmes sont dans le`);
  lines.push(`coffre-fort de récupération chiffré (section "Coffre-fort" du Centre de sécurité).`);
  lines.push("");

  lines.push(`## Inventaire des machines (${hosts.length})`);
  lines.push("");
  lines.push(`| Nom | Type | Rôle | OS | Adresse | Docker |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const h of hosts) {
    const address = h.tailscale_ip || h.lan_ip || h.public_ip || "—";
    lines.push(
      `| ${h.name} | ${KIND_LABELS[h.kind] ?? h.kind} | ${h.role ?? "—"} | ${h.os ?? "—"} | ${address} | ${h.docker_enabled ? "oui" : "non"} |`
    );
  }
  lines.push("");

  const proxmoxNodes = hosts.filter((h) => h.proxmox_node);
  if (proxmoxNodes.length > 0) {
    lines.push(`## Cluster(s) Proxmox`);
    lines.push("");
    for (const h of proxmoxNodes) {
      lines.push(`- **${h.name}** — nœud \`${h.proxmox_node}\`${h.cluster ? `, cluster \`${h.cluster}\`` : ""}`);
    }
    lines.push("");
  }

  if (links.length > 0) {
    lines.push(`## Topologie réseau`);
    lines.push("");
    for (const l of links) {
      lines.push(`- ${l.a_name} ↔ ${l.b_name} (${l.link_type})`);
    }
    lines.push("");
  }

  lines.push(`## Sauvegardes configurées (${backupPlans.length})`);
  lines.push("");
  if (backupPlans.length === 0) {
    lines.push(`Aucun plan de sauvegarde configuré — voir la page "Sauvegardes" du panel.`);
  } else {
    lines.push(`| Plan | Type | Source → Destination | Fréquence | Versions conservées |`);
    lines.push(`|---|---|---|---|---|`);
    for (const p of backupPlans) {
      lines.push(`| ${p.name} | ${p.source_type} | ${p.source_host} → ${p.dest_host} | ${p.schedule} | ${p.retention_count} |`);
    }
  }
  lines.push("");

  const notesHosts = hosts.filter((h) => h.notes);
  if (notesHosts.length > 0) {
    lines.push(`## Notes par machine`);
    lines.push("");
    for (const h of notesHosts) {
      lines.push(`- **${h.name}** : ${h.notes}`);
    }
    lines.push("");
  }

  lines.push(`## Où sont les secrets`);
  lines.push("");
  lines.push(`- Identifiants SSH, mots de passe, jetons d'API : chiffrés dans la base du panel (\`data/panel.db\`),`);
  lines.push(`  déchiffrables uniquement avec la variable d'environnement \`VAULT_MASTER_KEY\` du serveur qui héberge`);
  lines.push(`  le panel — garde-la de côté séparément (gestionnaire de mots de passe), jamais dans ce document ni`);
  lines.push(`  dans le coffre-fort de récupération lui-même.`);
  lines.push(`- Configuration complète (inventaire, identifiants chiffrés, intégrations, plans de sauvegarde) :`);
  lines.push(`  export chiffré par phrase secrète, généré depuis le Centre de sécurité → Coffre-fort.`);
  lines.push("");

  lines.push(`## Procédure de restauration résumée`);
  lines.push("");
  lines.push(`1. Redéployer le panel sur une nouvelle machine (voir le guide de déploiement).`);
  lines.push(`2. Restaurer la variable d'environnement \`VAULT_MASTER_KEY\` d'origine.`);
  lines.push(`3. Importer le fichier du coffre-fort de récupération (Centre de sécurité → Coffre-fort → Importer).`);
  lines.push(`4. Vérifier chaque machine listée ci-dessus (adresse, accès SSH) et relancer une sauvegarde de test.`);

  return lines.join("\n");
}
