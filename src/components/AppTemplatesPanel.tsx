"use client";

import { useEffect, useState } from "react";

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

const EMPTY_FORM = { name: "", description: "", image: "", ports: "", volumes: "", env: "", restartPolicy: "unless-stopped" };

export default function AppTemplatesPanel({ onUse }: { onUse: (template: AppTemplate) => void }) {
  const [templates, setTemplates] = useState<AppTemplate[]>([]);
  const [editing, setEditing] = useState<string | null>(null); // template id being edited, or "new"
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/docker/templates")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates || []));
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(t?: AppTemplate) {
    if (t) {
      setForm({
        name: t.name,
        description: t.description,
        image: t.image,
        ports: t.ports.join("\n"),
        volumes: t.volumes.join("\n"),
        env: t.env.join("\n"),
        restartPolicy: t.restartPolicy,
      });
      setEditing(t.id);
    } else {
      setForm(EMPTY_FORM);
      setEditing("new");
    }
  }

  async function save() {
    if (!form.name.trim() || !form.image.trim()) {
      setError("Nom et image requis.");
      return;
    }
    setSaving(true);
    setError("");
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      image: form.image.trim(),
      ports: form.ports.split("\n").map((s) => s.trim()).filter(Boolean),
      volumes: form.volumes.split("\n").map((s) => s.trim()).filter(Boolean),
      env: form.env.split("\n").map((s) => s.trim()).filter(Boolean),
      restartPolicy: form.restartPolicy,
    };
    try {
      const res =
        editing === "new"
          ? await fetch("/api/docker/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          : await fetch(`/api/docker/templates/${editing}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Supprimer ce modèle ?")) return;
    await fetch(`/api/docker/templates/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-3 rounded border border-neutral-800 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-neutral-300">Modèles d&apos;applications</p>
        <button
          onClick={() => startEdit()}
          className="rounded border border-blue-700 bg-blue-900/40 px-2.5 py-1 text-xs text-blue-200 hover:bg-blue-900/60"
        >
          + Nouveau modèle
        </button>
      </div>

      {editing && (
        <div className="space-y-2 rounded border border-neutral-700 bg-neutral-900/50 p-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Nom"
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            />
            <input
              value={form.image}
              onChange={(e) => setForm({ ...form, image: e.target.value })}
              placeholder="Image (ex: nginx:latest)"
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            />
          </div>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Description"
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          />
          <div className="grid grid-cols-3 gap-2">
            <textarea
              value={form.ports}
              onChange={(e) => setForm({ ...form, ports: e.target.value })}
              placeholder="Ports (un par ligne)"
              rows={3}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-100"
            />
            <textarea
              value={form.volumes}
              onChange={(e) => setForm({ ...form, volumes: e.target.value })}
              placeholder="Volumes (un par ligne)"
              rows={3}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-100"
            />
            <textarea
              value={form.env}
              onChange={(e) => setForm({ ...form, env: e.target.value })}
              placeholder="Variables d'env (une par ligne)"
              rows={3}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-100"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(null)}
              className="rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
            >
              Annuler
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-50"
            >
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <div key={t.id} className="rounded border border-neutral-700 p-3">
            <button onClick={() => onUse(t)} className="block w-full text-left hover:opacity-80">
              <p className="font-medium text-neutral-100">{t.name}</p>
              <p className="mt-1 text-xs text-neutral-400">{t.description}</p>
              <p className="mt-2 font-mono text-[11px] text-neutral-500">{t.image}</p>
            </button>
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={() => startEdit(t)}
                className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] hover:bg-neutral-800"
              >
                Modifier
              </button>
              <button
                onClick={() => remove(t.id)}
                className="rounded border border-red-900 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-950/40"
              >
                Supprimer
              </button>
            </div>
          </div>
        ))}
        {templates.length === 0 && !editing && (
          <p className="col-span-full text-sm text-neutral-600">Aucun modèle — crées-en un.</p>
        )}
      </div>
    </div>
  );
}
