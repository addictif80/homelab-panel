"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";

type UserSummary = { id: number; username: string; role: "admin" | "viewer"; totpEnabled: boolean; createdAt: string };

const EMPTY_FORM = { username: "", password: "", role: "viewer" as "admin" | "viewer" };

export default function UsersPage() {
  const [me, setMe] = useState<{ username: string; role: string } | null>(null);
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [newAccountSecret, setNewAccountSecret] = useState<{ qrDataUrl: string; secret: string; username: string } | null>(
    null
  );

  const load = useCallback(async () => {
    const meRes = await fetch("/api/auth/me");
    const meData = await meRes.json();
    setMe(meRes.ok ? meData : null);

    const res = await fetch("/api/users");
    const data = await res.json();
    if (res.ok) setUsers(data.users);
    else setError(data.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewAccountSecret({ qrDataUrl: data.qrDataUrl, secret: data.secret, username: form.username });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  }

  async function changeRole(u: UserSummary, role: "admin" | "viewer") {
    setError("");
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function removeUser(u: UserSummary) {
    if (!confirm(`Supprimer le compte ${u.username} ?`)) return;
    setError("");
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  if (me && me.role !== "admin") {
    return <p className="text-sm text-neutral-500">Cette page est réservée aux administrateurs.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Comptes</h1>
          <p className="text-sm text-neutral-400">
            Un compte <strong>administrateur</strong> a accès à tout. Un compte{" "}
            <strong>lecture seule</strong> peut consulter le panel mais ne peut lancer aucune action
            (mises à jour, redémarrages, suppressions, etc.).
          </p>
        </div>
        <button
          onClick={() => setShowCreate((s) => !s)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
        >
          + Ajouter un compte
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {showCreate && (
        <form onSubmit={createUser} className="max-w-md space-y-3 rounded border border-neutral-800 p-4">
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Nom d&apos;utilisateur</label>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Mot de passe (12 caractères min.)</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              required
              minLength={12}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Rôle</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "viewer" })}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            >
              <option value="viewer">Lecture seule</option>
              <option value="admin">Administrateur</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {creating ? "Création..." : "Créer le compte"}
          </button>
        </form>
      )}

      {newAccountSecret && (
        <div className="max-w-md space-y-3 rounded border border-blue-800 bg-blue-950/30 p-4">
          <p className="text-sm text-neutral-200">
            Compte <strong>{newAccountSecret.username}</strong> créé. Ce QR code ne sera plus affiché ensuite —
            transmets-le à la personne concernée pour qu&apos;elle configure sa 2FA (Google Authenticator, etc.),
            puis qu&apos;elle valide le code depuis l&apos;écran de connexion.
          </p>
          <Image src={newAccountSecret.qrDataUrl} alt="QR code 2FA" width={200} height={200} className="rounded bg-white p-2" />
          <p className="font-mono text-xs text-neutral-400">Secret : {newAccountSecret.secret}</p>
          <button
            onClick={() => setNewAccountSecret(null)}
            className="rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
          >
            Fermer
          </button>
        </div>
      )}

      {!users ? (
        <p className="text-sm text-neutral-500">Chargement...</p>
      ) : (
        <div className="overflow-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Utilisateur</th>
                <th className="px-3 py-2 font-medium">Rôle</th>
                <th className="px-3 py-2 font-medium">2FA</th>
                <th className="px-3 py-2 font-medium">Créé le</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-neutral-800">
                  <td className="px-3 py-2 font-medium">
                    {u.username} {me?.username === u.username && <span className="text-xs text-neutral-500">(toi)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value as "admin" | "viewer")}
                      className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
                    >
                      <option value="viewer">Lecture seule</option>
                      <option value="admin">Administrateur</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-neutral-400">{u.totpEnabled ? "✅" : "⏳ non configurée"}</td>
                  <td className="px-3 py-2 text-neutral-400">{new Date(`${u.createdAt}Z`).toLocaleDateString()}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => removeUser(u)}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-red-400 hover:bg-neutral-800"
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
