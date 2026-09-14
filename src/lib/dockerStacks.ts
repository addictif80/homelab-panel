import { randomUUID } from "crypto";
import { getDb } from "./db";
import { runSshCommand, runSshCommandStreaming, shellQuote } from "./ssh";

export type DockerStack = {
  id: string;
  hostId: number;
  name: string;
  composeContent: string;
  createdAt: string;
  updatedAt: string;
};

type StackRow = { id: string; host_id: number; name: string; compose_content: string; created_at: string; updated_at: string };

function rowToStack(row: StackRow): DockerStack {
  return {
    id: row.id,
    hostId: row.host_id,
    name: row.name,
    composeContent: row.compose_content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listStacks(hostId?: number): DockerStack[] {
  const rows = hostId
    ? (getDb().prepare(`SELECT * FROM docker_stacks WHERE host_id = ? ORDER BY name`).all(hostId) as StackRow[])
    : (getDb().prepare(`SELECT * FROM docker_stacks ORDER BY name`).all() as StackRow[]);
  return rows.map(rowToStack);
}

export function getStack(id: string): DockerStack | null {
  const row = getDb().prepare(`SELECT * FROM docker_stacks WHERE id = ?`).get(id) as StackRow | undefined;
  return row ? rowToStack(row) : null;
}

function stackDir(name: string): string {
  // Slugify to a restricted charset ([a-z0-9-] only) — safe to interpolate directly into a
  // command without shellQuote, and avoids docker compose's own dislike of spaces/punctuation in
  // project names. $HOME (not `~`) because the path is built inside a single-quoted shellQuote
  // string elsewhere — `~` doesn't expand inside single quotes, $HOME does since it's expanded by
  // the shell that ultimately runs the unquoted `cd $HOME/...` form used below.
  const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "stack";
  return `$HOME/.homelab-panel-stacks/${slug}`;
}

async function writeComposeFile(hostId: number, dir: string, content: string): Promise<void> {
  const b64 = Buffer.from(content, "utf8").toString("base64");
  // `dir` is never shellQuote()'d: it's built entirely from stackDir()'s restricted
  // [a-z0-9-] slug plus the literal $HOME/.homelab-panel-stacks/ prefix, so it's safe to
  // interpolate unquoted — and it must stay unquoted for $HOME to actually expand.
  await runSshCommand(hostId, `mkdir -p ${dir}`, { sudo: true });
  const { code, stderr } = await runSshCommand(hostId, `printf '%s' ${shellQuote(b64)} | base64 -d > ${dir}/docker-compose.yml`, {
    sudo: true,
  });
  if (code !== 0) throw new Error(stderr.trim() || "Échec de l'écriture du fichier compose.");
}

/** Creates (or overwrites) a stack's record and deploys it immediately with `docker compose up -d`. */
export async function createAndDeployStack(
  hostId: number,
  name: string,
  composeContent: string,
  append: (text: string) => void
): Promise<DockerStack> {
  const id = randomUUID();
  const dir = stackDir(name);

  append(`Écriture de docker-compose.yml sur la machine cible...\n`);
  await writeComposeFile(hostId, dir, composeContent);

  append(`Déploiement (docker compose up -d)...\n`);
  const code = await runSshCommandStreaming(hostId, `cd ${dir} && docker compose up -d`, append, { sudo: true });
  if (code !== 0) throw new Error("Échec du déploiement — voir le journal ci-dessus.");

  getDb()
    .prepare(`INSERT INTO docker_stacks (id, host_id, name, compose_content) VALUES (?, ?, ?, ?)`)
    .run(id, hostId, name, composeContent);
  return getStack(id)!;
}

export async function redeployStack(id: string, append: (text: string) => void): Promise<void> {
  const stack = getStack(id);
  if (!stack) throw new Error("Stack introuvable.");
  const dir = stackDir(stack.name);

  append(`Réécriture de docker-compose.yml...\n`);
  await writeComposeFile(stack.hostId, dir, stack.composeContent);

  append(`Redéploiement (docker compose up -d)...\n`);
  const code = await runSshCommandStreaming(stack.hostId, `cd ${dir} && docker compose up -d`, append, { sudo: true });
  if (code !== 0) throw new Error("Échec du redéploiement — voir le journal ci-dessus.");

  getDb().prepare(`UPDATE docker_stacks SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

export async function updateStackContent(id: string, composeContent: string): Promise<void> {
  getDb()
    .prepare(`UPDATE docker_stacks SET compose_content = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(composeContent, id);
}

/** Stops and removes the stack's containers (`docker compose down`) but keeps its record — a
 * stopped stack can still be redeployed later without pasting the compose file again. */
export async function bringStackDown(id: string, append: (text: string) => void): Promise<void> {
  const stack = getStack(id);
  if (!stack) throw new Error("Stack introuvable.");
  const dir = stackDir(stack.name);
  const code = await runSshCommandStreaming(stack.hostId, `cd ${dir} && docker compose down`, append, { sudo: true });
  if (code !== 0) throw new Error("Échec de l'arrêt de la stack — voir le journal ci-dessus.");
}

export async function deleteStack(id: string): Promise<void> {
  const stack = getStack(id);
  if (!stack) return;
  const dir = stackDir(stack.name);
  await runSshCommand(stack.hostId, `cd ${dir} && docker compose down 2>/dev/null; rm -rf ${dir}`, {
    sudo: true,
  }).catch(() => {});
  getDb().prepare(`DELETE FROM docker_stacks WHERE id = ?`).run(id);
}
