import { randomUUID } from "crypto";
import { getDb } from "./db";

export type AppTemplate = {
  id: string;
  name: string;
  description: string;
  image: string;
  ports: string[];
  volumes: string[];
  env: string[];
  restartPolicy: string;
};

type TemplateRow = {
  id: string;
  name: string;
  description: string;
  image: string;
  ports_json: string;
  volumes_json: string;
  env_json: string;
  restart_policy: string;
};

function rowToTemplate(row: TemplateRow): AppTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    image: row.image,
    ports: JSON.parse(row.ports_json),
    volumes: JSON.parse(row.volumes_json),
    env: JSON.parse(row.env_json),
    restartPolicy: row.restart_policy,
  };
}

/** One-click prefill for the "run a container" form on /docker — seeded with a curated built-in
 * set (see db.ts's seedAppTemplatesIfEmpty) but fully editable from the panel afterwards, not a
 * fixed list baked into source. */
export function listAppTemplates(): AppTemplate[] {
  return (getDb().prepare(`SELECT * FROM app_templates ORDER BY name`).all() as TemplateRow[]).map(rowToTemplate);
}

export type AppTemplateInput = {
  name: string;
  description: string;
  image: string;
  ports: string[];
  volumes: string[];
  env: string[];
  restartPolicy: string;
};

export function createAppTemplate(input: AppTemplateInput): AppTemplate {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO app_templates (id, name, description, image, ports_json, volumes_json, env_json, restart_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      input.description,
      input.image,
      JSON.stringify(input.ports),
      JSON.stringify(input.volumes),
      JSON.stringify(input.env),
      input.restartPolicy || "unless-stopped"
    );
  return rowToTemplate(getDb().prepare(`SELECT * FROM app_templates WHERE id = ?`).get(id) as TemplateRow);
}

export function updateAppTemplate(id: string, input: AppTemplateInput): AppTemplate {
  const db = getDb();
  const existing = db.prepare(`SELECT 1 FROM app_templates WHERE id = ?`).get(id);
  if (!existing) throw new Error("Modèle introuvable.");
  db.prepare(
    `UPDATE app_templates SET name = ?, description = ?, image = ?, ports_json = ?, volumes_json = ?, env_json = ?, restart_policy = ? WHERE id = ?`
  ).run(
    input.name,
    input.description,
    input.image,
    JSON.stringify(input.ports),
    JSON.stringify(input.volumes),
    JSON.stringify(input.env),
    input.restartPolicy || "unless-stopped",
    id
  );
  return rowToTemplate(db.prepare(`SELECT * FROM app_templates WHERE id = ?`).get(id) as TemplateRow);
}

export function deleteAppTemplate(id: string): void {
  getDb().prepare(`DELETE FROM app_templates WHERE id = ?`).run(id);
}
