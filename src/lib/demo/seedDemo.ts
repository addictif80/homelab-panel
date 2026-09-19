import type Database from "better-sqlite3";
import { hashPassword } from "../auth";

/**
 * Entirely fictitious fleet — private-range IPs and made-up names, never anything resembling a
 * real reachable address, since a public /demo visitor never opens a real network connection to
 * any of this (see ssh.ts's demo short-circuit) but the inventory should still look and feel real.
 */
const DEMO_HOSTS = [
  {
    name: "pve-node-a",
    slug: "pve-node-a",
    kind: "physical",
    role: "Nœud Proxmox",
    os: "Proxmox VE",
    cluster: "demo-cluster",
    lan_ip: "10.20.0.10",
    docker_enabled: 0,
    needs_sudo: 0,
    proxmox_node: "pve-node-a",
    notes: "Serveur de démonstration — données fictives.",
  },
  {
    name: "pve-node-b",
    slug: "pve-node-b",
    kind: "physical",
    role: "Nœud Proxmox",
    os: "Proxmox VE",
    cluster: "demo-cluster",
    lan_ip: "10.20.0.11",
    docker_enabled: 0,
    needs_sudo: 0,
    proxmox_node: "pve-node-b",
    notes: "Serveur de démonstration — données fictives.",
  },
  {
    name: "nas-demo",
    slug: "nas-demo",
    kind: "nas",
    role: "Sauvegardes",
    os: "TrueNAS",
    lan_ip: "10.20.0.20",
    docker_enabled: 0,
    needs_sudo: 1,
    notes: "NAS de démonstration.",
  },
  {
    name: "vps-web-demo",
    slug: "vps-web-demo",
    kind: "vps",
    role: "Reverse proxy + sites web",
    lan_ip: "10.20.0.30",
    docker_enabled: 1,
    needs_sudo: 1,
    notes: "Serveur web de démonstration.",
  },
  {
    name: "vps-mail-demo",
    slug: "vps-mail-demo",
    kind: "vps",
    role: "Messagerie (Mailcow)",
    lan_ip: "10.20.0.31",
    docker_enabled: 1,
    needs_sudo: 1,
    notes: "Serveur mail de démonstration.",
  },
  {
    name: "box-demo",
    slug: "box-demo",
    kind: "router",
    role: "Routeur / Wi-Fi",
    os: "OpenWrt",
    lan_ip: "10.20.0.1",
    docker_enabled: 0,
    needs_sudo: 0,
    notes: "Routeur de démonstration.",
  },
];

const DEMO_SERVICES = [
  { name: "Jellyfin", url: "https://jellyfin.demo.exemple.fr", description: "Serveur multimédia personnel." },
  { name: "Nextcloud", url: "https://cloud.demo.exemple.fr", description: "Stockage et partage de fichiers." },
  { name: "Vaultwarden", url: "https://vault.demo.exemple.fr", description: "Gestionnaire de mots de passe auto-hébergé." },
  { name: "Immich", url: "https://photos.demo.exemple.fr", description: "Sauvegarde et tri de photos." },
];

export type DemoContainerSpec = { id: string; name: string; image: string; status: string; state: string; ports: string };

/** Per-host fake Docker fleet, keyed by host slug — only used by the SSH-layer simulation in
 * ssh.ts, never persisted to a table (the real app doesn't store container lists in the DB
 * either — they're always fetched live over SSH). */
export const DEMO_CONTAINERS: Record<string, DemoContainerSpec[]> = {
  "vps-web-demo": [
    { id: "a1b2c3d4e5f6", name: "nginx-proxy-manager", image: "jc21/nginx-proxy-manager:latest", status: "Up 4 days", state: "running", ports: "0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp" },
    { id: "b2c3d4e5f6a1", name: "portainer", image: "portainer/portainer-ce:latest", status: "Up 4 days", state: "running", ports: "0.0.0.0:9000->9000/tcp" },
    { id: "c3d4e5f6a1b2", name: "watchtower", image: "containrrr/watchtower:latest", status: "Up 4 days", state: "running", ports: "" },
  ],
  "vps-mail-demo": [
    { id: "d4e5f6a1b2c3", name: "mailcowdockerized-postfix-mailcow-1", image: "mailcow/postfix:latest", status: "Up 2 days", state: "running", ports: "" },
    { id: "e5f6a1b2c3d4", name: "mailcowdockerized-dovecot-mailcow-1", image: "mailcow/dovecot:latest", status: "Up 2 days", state: "running", ports: "0.0.0.0:143->143/tcp" },
    { id: "f6a1b2c3d4e5", name: "mailcowdockerized-rspamd-mailcow-1", image: "mailcow/rspamd:latest", status: "Restarting (1) 3 seconds ago", state: "restarting", ports: "" },
  ],
};

export function seedDemo(db: Database.Database) {
  db.prepare(
    `INSERT INTO users (username, password_hash, totp_enabled, role) VALUES ('demo', ?, 0, 'admin')`
  ).run(hashPassword("demo"));

  const insertHost = db.prepare(`
    INSERT INTO hosts (name, slug, kind, role, os, cluster, lan_ip, docker_enabled, needs_sudo, proxmox_node, notes)
    VALUES (@name, @slug, @kind, @role, @os, @cluster, @lan_ip, @docker_enabled, @needs_sudo, @proxmox_node, @notes)
  `);
  for (const h of DEMO_HOSTS) {
    insertHost.run({
      name: h.name,
      slug: h.slug,
      kind: h.kind,
      role: h.role,
      os: h.os ?? null,
      cluster: h.cluster ?? null,
      lan_ip: h.lan_ip ?? null,
      docker_enabled: h.docker_enabled,
      needs_sudo: h.needs_sudo,
      proxmox_node: h.proxmox_node ?? null,
      notes: h.notes,
    });
  }

  const insertLink = db.prepare(`
    INSERT INTO network_links (host_a_id, host_b_id, link_type) VALUES (?, ?, ?)
  `);
  const slugToId = new Map<string, number>();
  for (const row of db.prepare(`SELECT id, slug FROM hosts`).all() as { id: number; slug: string }[]) {
    slugToId.set(row.slug, row.id);
  }
  const pairs: [string, string, string][] = [
    ["pve-node-a", "box-demo", "lan"],
    ["pve-node-b", "box-demo", "lan"],
    ["nas-demo", "box-demo", "lan"],
    ["pve-node-a", "pve-node-b", "cluster"],
    ["pve-node-a", "vps-web-demo", "tailscale"],
    ["pve-node-a", "vps-mail-demo", "tailscale"],
  ];
  for (const [a, b, type] of pairs) {
    const idA = slugToId.get(a);
    const idB = slugToId.get(b);
    if (idA && idB) insertLink.run(idA, idB, type);
  }

  const insertService = db.prepare(`
    INSERT INTO service_links (id, name, url, description, show_public)
    VALUES (?, ?, ?, ?, 1)
  `);
  DEMO_SERVICES.forEach((s, i) => {
    insertService.run(`demo-service-${i}`, s.name, s.url, s.description);
  });

  db.prepare(`INSERT OR REPLACE INTO license (id, status, activated_at) VALUES (1, 'activated', datetime('now'))`).run();
}
