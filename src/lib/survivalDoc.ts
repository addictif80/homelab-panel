import { getDb } from "./db";
import { listContainers } from "./docker";

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
type ServiceLinkRow = { name: string; url: string; description: string };

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
export async function generateSurvivalDoc(): Promise<string> {
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
  const serviceLinks = db.prepare(`SELECT name, url, description FROM service_links ORDER BY name`).all() as ServiceLinkRow[];

  // Live, not stored — a container list frozen at some past "generation" would defeat the whole
  // point of this doc being trustworthy during an actual emergency. Best-effort per host: one
  // unreachable machine (mid-incident is exactly when that's likely) doesn't blank the whole doc.
  const dockerHosts = hosts.filter((h) => h.docker_enabled);
  const containersByHost = new Map<number, Awaited<ReturnType<typeof listContainers>>>();
  await Promise.all(
    dockerHosts.map(async (h) => {
      try {
        containersByHost.set(h.id, await listContainers(h.id));
      } catch {
        // Left unset — rendered below as "injoignable au moment de la génération".
      }
    })
  );

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

  if (dockerHosts.length > 0) {
    lines.push(`## Conteneurs Docker`);
    lines.push("");
    for (const h of dockerHosts) {
      const containers = containersByHost.get(h.id);
      lines.push(`### ${h.name}`);
      lines.push("");
      if (!containers) {
        lines.push(`_Injoignable au moment de la génération de ce document._`);
      } else if (containers.length === 0) {
        lines.push(`_Aucun conteneur._`);
      } else {
        lines.push(`| Conteneur | Image | État |`);
        lines.push(`|---|---|---|`);
        for (const c of containers) {
          lines.push(`| ${c.name} | ${c.image} | ${c.status} |`);
        }
      }
      lines.push("");
    }
  }

  if (serviceLinks.length > 0) {
    lines.push(`## Services & applications`);
    lines.push("");
    for (const s of serviceLinks) {
      lines.push(`- **${s.name}** — ${s.url}${s.description ? ` — ${s.description}` : ""}`);
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
