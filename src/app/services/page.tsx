"use client";

import { useEffect, useState } from "react";

type DirectoryStatus = "none" | "pending" | "approved" | "rejected";

type ServiceLink = {
  id: string;
  name: string;
  url: string;
  faviconDataUrl: string | null;
  showPublic: boolean;
  clickCount: number;
  directoryOptIn: boolean;
  directoryStatus: DirectoryStatus;
};

const DIRECTORY_STATUS_LABEL: Record<DirectoryStatus, string> = {
  none: "",
  pending: "En attente de validation",
  approved: "Publié dans l'annuaire",
  rejected: "Refusé par l'admin",
};

const DIRECTORY_STATUS_STYLE: Record<DirectoryStatus, string> = {
  none: "",
  pending: "text-amber-400",
  approved: "text-emerald-400",
  rejected: "text-red-400",
};

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function FaviconOrInitial({ link }: { link: ServiceLink }) {
  if (link.faviconDataUrl) {
    return <img src={link.faviconDataUrl} alt="" className="h-8 w-8 rounded" />;
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-900/40 text-sm font-semibold text-blue-300">
      {link.name.charAt(0).toUpperCase() || "?"}
    </div>
  );
}

export default function ServicesPage() {
  const [links, setLinks] = useState<ServiceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formPublic, setFormPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  function load() {
    setLoading(true);
    fetch("/api/service-links")
      .then((r) => r.json())
      .then((d) => setLinks(d.links))
      .catch(() => setError("Impossible de charger les services."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function openCreateForm() {
    setEditingId(null);
    setFormName("");
    setFormUrl("");
    setFormPublic(false);
    setFormError("");
    setShowForm(true);
  }

  function openEditForm(link: ServiceLink) {
    setEditingId(link.id);
    setFormName(link.name);
    setFormUrl(link.url);
    setFormPublic(link.showPublic);
    setFormError("");
    setShowForm(true);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const res = await fetch(editingId ? `/api/service-links/${editingId}` : "/api/service-links", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName, url: formUrl, showPublic: formPublic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePublic(link: ServiceLink) {
    setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, showPublic: !l.showPublic } : l)));
    await fetch(`/api/service-links/${link.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublic: !link.showPublic }),
    });
  }

  async function toggleDirectory(link: ServiceLink) {
    const optIn = !link.directoryOptIn;
    setError("");
    try {
      const res = await fetch(`/api/service-links/${link.id}/directory`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optIn }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLinks((prev) => prev.map((l) => (l.id === link.id ? data.link : l)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    }
  }

  async function deleteLink(link: ServiceLink) {
    if (!confirm(`Supprimer « ${link.name} » ?`)) return;
    await fetch(`/api/service-links/${link.id}`, { method: "DELETE" });
    load();
  }

  async function openLink(link: ServiceLink) {
    setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, clickCount: l.clickCount + 1 } : l)));
    fetch(`/api/service-links/${link.id}/click`, { method: "POST" }).catch(() => {});
    window.open(link.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Services</h1>
          <p className="text-sm text-neutral-400">
            Raccourcis vers tes services hébergés — coche « Page publique » pour les afficher aussi sur{" "}
            <a href="/board" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
              /board
            </a>
            , accessible sans connexion. Coche « Annuaire » pour proposer un service à l&apos;annuaire public du
            vendeur (soumis à validation par un administrateur, nécessite une licence active).
          </p>
        </div>
        <button onClick={openCreateForm} className="btn-primary">
          + Ajouter un service
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Chargement...</p>}

      {showForm && (
        <form onSubmit={submitForm} className="max-w-lg space-y-3 rounded border border-neutral-800 p-4">
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Nom</label>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Nextcloud"
              required
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Lien</label>
            <input
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="https://nextcloud.exemple.fr"
              required
              className="input"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input type="checkbox" checked={formPublic} onChange={(e) => setFormPublic(e.target.checked)} />
            Afficher sur la page publique (/board)
          </label>
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Enregistrement..." : editingId ? "Enregistrer" : "Ajouter"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
              Annuler
            </button>
          </div>
          <p className="text-xs text-neutral-500">
            Le favicon est récupéré automatiquement depuis le service (utile même si la page publique est ouverte
            depuis l&apos;extérieur de ton réseau).
          </p>
        </form>
      )}

      {!loading && links.length === 0 && (
        <p className="text-sm text-neutral-500">Aucun service pour l&apos;instant. Ajoute ton premier raccourci.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <div key={link.id} className="rounded border border-neutral-800 bg-neutral-900 p-4">
            <div className="flex items-start gap-3">
              <FaviconOrInitial link={link} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-100">{link.name}</p>
                <p className="truncate text-xs text-neutral-500">{hostLabel(link.url)}</p>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
              <span>{link.clickCount} clic{link.clickCount !== 1 ? "s" : ""}</span>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={link.showPublic} onChange={() => togglePublic(link)} />
                Page publique
              </label>
            </div>

            <div className="mt-1.5 flex items-center justify-between text-xs">
              <span className={DIRECTORY_STATUS_STYLE[link.directoryStatus]}>
                {DIRECTORY_STATUS_LABEL[link.directoryStatus]}
              </span>
              <label className="flex items-center gap-1.5 text-neutral-500">
                <input type="checkbox" checked={link.directoryOptIn} onChange={() => toggleDirectory(link)} />
                Annuaire
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <button onClick={() => openLink(link)} className="btn-primary py-1 text-xs">
                Ouvrir
              </button>
              <button onClick={() => openEditForm(link)} className="btn-secondary py-1 text-xs">
                Modifier
              </button>
              <button onClick={() => deleteLink(link)} className="btn-danger py-1 text-xs">
                Supprimer
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
