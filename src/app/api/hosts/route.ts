import { NextRequest, NextResponse } from "next/server";
import { getDb, logAudit } from "@/lib/db";

export type Host = {
  id: number;
  name: string;
  slug: string;
  kind: string;
  role: string | null;
  os: string | null;
  cluster: string | null;
  parent_host_id: number | null;
  lan_ip: string | null;
  tailscale_ip: string | null;
  public_ip: string | null;
  ssh_port: number;
  ssh_user: string | null;
  docker_enabled: number;
  update_method: string | null;
  notes: string | null;
};

export async function GET() {
  const hosts = getDb().prepare(`SELECT * FROM hosts ORDER BY kind, name`).all() as Host[];
  const links = getDb()
    .prepare(`SELECT id, host_a_id, host_b_id, link_type FROM network_links`)
    .all();
  return NextResponse.json({ hosts, links });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, kind, role, os, cluster, lan_ip, tailscale_ip, public_ip, ssh_port, ssh_user, docker_enabled, update_method, notes } =
    body;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Le nom est requis." }, { status: 400 });
  }
  const allowedKinds = ["physical", "vm", "lxc", "vps", "nas", "router"];
  if (!allowedKinds.includes(kind)) {
    return NextResponse.json({ error: "Type de machine invalide." }, { status: 400 });
  }

  const slug = slugify(name);
  const db = getDb();
  try {
    const info = db
      .prepare(
        `INSERT INTO hosts (name, slug, kind, role, os, cluster, lan_ip, tailscale_ip, public_ip, ssh_port, ssh_user, docker_enabled, update_method, notes)
         VALUES (@name, @slug, @kind, @role, @os, @cluster, @lan_ip, @tailscale_ip, @public_ip, @ssh_port, @ssh_user, @docker_enabled, @update_method, @notes)`
      )
      .run({
        name,
        slug,
        kind,
        role: role ?? null,
        os: os ?? null,
        cluster: cluster ?? null,
        lan_ip: lan_ip ?? null,
        tailscale_ip: tailscale_ip ?? null,
        public_ip: public_ip ?? null,
        ssh_port: ssh_port ?? 22,
        ssh_user: ssh_user ?? null,
        docker_enabled: docker_enabled ? 1 : 0,
        update_method: update_method ?? null,
        notes: notes ?? null,
      });
    logAudit("host.created", name);
    return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Une machine avec ce nom existe déjà." }, { status: 409 });
  }
}
