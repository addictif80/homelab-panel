"use client";

import { useEffect, useState } from "react";

export default function DirectorySettingsPanel() {
  const [open, setOpen] = useState(false);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open && ownerName === null) {
      fetch("/api/settings/directory")
        .then((r) => r.json())
        .then((d) => setOwnerName(d.ownerName || ""));
    }
  }, [open, ownerName]);

  async function save() {
    if (ownerName === null) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/directory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage("Enregistré.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-neutral-300"
      >
        <span>Annuaire public — nom affiché</span>
        <span className="text-neutral-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-4">
          <p className="text-xs text-neutral-500">
            Nom affiché à côté de chaque service que tu soumets à l&apos;annuaire public (page{" "}
            <code>/services</code>, case « Annuaire »). Une fois soumis, chaque service attend une validation par
            un administrateur avant d&apos;apparaître sur la page publique du vendeur.
          </p>
          {ownerName === null ? (
            <p className="text-sm text-neutral-500">Chargement...</p>
          ) : (
            <>
              <input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Homelab de Julien"
                className="input"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={save}
                  disabled={saving || !ownerName.trim()}
                  className="rounded border border-neutral-600 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {saving ? "Enregistrement..." : "Enregistrer"}
                </button>
                {message && <span className="text-xs text-neutral-400">{message}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
