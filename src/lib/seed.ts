import { getDb } from "./db";

type SeedHost = {
  name: string;
  slug: string;
  kind: "physical" | "vm" | "lxc" | "vps" | "nas" | "router";
  role: string;
  os?: string;
  cluster?: string;
  lan_ip?: string;
  tailscale_ip?: string;
  public_ip?: string;
  update_method?: string;
  docker_enabled?: number;
  notes?: string;
};

const SEED_HOSTS: SeedHost[] = [
  {
    name: "Dell PowerEdge R610",
    slug: "pve1-dell",
    kind: "physical",
    role: "Nœud Proxmox",
    os: "Proxmox VE",
    cluster: "abhd",
    lan_ip: "192.168.0.100",
    update_method: "apt",
    notes: "pve1 / dell",
  },
  {
    name: "Fujitsu PRIMERGY TX1310 M1",
    slug: "pve2-fujitsu",
    kind: "physical",
    role: "Nœud Proxmox",
    os: "Proxmox VE",
    cluster: "abhd",
    lan_ip: "192.168.0.200",
    update_method: "apt",
    notes: "pve2 / fujitsu",
  },
  {
    name: "Synology DS115J",
    slug: "synology-ds115j",
    kind: "nas",
    role: "Backup",
    os: "DSM",
    update_method: "dsm",
    notes: "NAS de sauvegarde",
  },
  {
    name: "HP EliteDesk 800 G1",
    slug: "hp-elitedesk-800-g1",
    kind: "physical",
    role: "Failover web (Caddy)",
    os: "ZimaOS",
    update_method: "apt",
    docker_enabled: 1,
    notes: "Hébergé chez un membre de la famille, failover web via Caddy",
  },
  {
    name: "VPS Contabo",
    slug: "vps-contabo",
    kind: "vps",
    role: "Mailcow + CloudPanel",
    update_method: "apt",
    docker_enabled: 1,
    notes: "Mailcow + CloudPanel",
  },
  {
    name: "VPS Ionos",
    slug: "vps-ionos",
    kind: "vps",
    role: "Frontend public (Nginx Proxy Manager)",
    update_method: "apt",
    docker_enabled: 1,
    notes: "Nginx Proxy Manager en Docker",
  },
  {
    name: "Netgear R7000",
    slug: "netgear-r7000",
    kind: "router",
    role: "Routeur / Wi-Fi",
    os: "OpenWrt",
    update_method: "opkg",
    notes: "Flashé en OpenWrt",
  },
];

// (host_slug_a, host_slug_b, link_type) — best-effort topology, editable later via the inventory UI.
const SEED_LINKS: [string, string, string][] = [
  ["pve1-dell", "netgear-r7000", "lan"],
  ["pve2-fujitsu", "netgear-r7000", "lan"],
  ["synology-ds115j", "netgear-r7000", "lan"],
  ["pve1-dell", "pve2-fujitsu", "cluster"],
  ["pve1-dell", "hp-elitedesk-800-g1", "tailscale"],
  ["pve1-dell", "vps-contabo", "tailscale"],
  ["pve1-dell", "vps-ionos", "tailscale"],
  ["pve2-fujitsu", "hp-elitedesk-800-g1", "tailscale"],
  ["pve2-fujitsu", "vps-contabo", "tailscale"],
  ["pve2-fujitsu", "vps-ionos", "tailscale"],
  ["hp-elitedesk-800-g1", "vps-contabo", "tailscale"],
  ["hp-elitedesk-800-g1", "vps-ionos", "tailscale"],
  ["vps-contabo", "vps-ionos", "tailscale"],
];

export function seedIfEmpty() {
  const db = getDb();
  const { c } = db.prepare(`SELECT COUNT(*) as c FROM hosts`).get() as { c: number };
  if (c > 0) return;

  const insertHost = db.prepare(`
    INSERT INTO hosts (name, slug, kind, role, os, cluster, lan_ip, tailscale_ip, public_ip, update_method, docker_enabled, notes)
    VALUES (@name, @slug, @kind, @role, @os, @cluster, @lan_ip, @tailscale_ip, @public_ip, @update_method, @docker_enabled, @notes)
  `);

  const insertMany = db.transaction((hosts: SeedHost[]) => {
    for (const h of hosts) {
      insertHost.run({
        name: h.name,
        slug: h.slug,
        kind: h.kind,
        role: h.role,
        os: h.os ?? null,
        cluster: h.cluster ?? null,
        lan_ip: h.lan_ip ?? null,
        tailscale_ip: h.tailscale_ip ?? null,
        public_ip: h.public_ip ?? null,
        update_method: h.update_method ?? null,
        docker_enabled: h.docker_enabled ?? 0,
        notes: h.notes ?? null,
      });
    }
  });
  insertMany(SEED_HOSTS);

  const slugToId = new Map<string, number>();
  for (const row of db.prepare(`SELECT id, slug FROM hosts`).all() as { id: number; slug: string }[]) {
    slugToId.set(row.slug, row.id);
  }

  const insertLink = db.prepare(
    `INSERT INTO network_links (host_a_id, host_b_id, link_type) VALUES (?, ?, ?)`
  );
  const insertLinks = db.transaction((links: [string, string, string][]) => {
    for (const [a, b, type] of links) {
      const idA = slugToId.get(a);
      const idB = slugToId.get(b);
      if (idA && idB) insertLink.run(idA, idB, type);
    }
  });
  insertLinks(SEED_LINKS);
}
