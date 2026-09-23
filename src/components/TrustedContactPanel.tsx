"use client";

import { useEffect, useState } from "react";

type Contact = {
  configured: boolean;
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  question1: string;
  question2: string;
  question3: string;
};

const emptyForm = {
  firstName: "",
  lastName: "",
  birthDate: "",
  email: "",
  question1: "",
  answer1: "",
  question2: "",
  answer2: "",
  question3: "",
  answer3: "",
};

export default function TrustedContactPanel() {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<Contact | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    fetch("/api/settings/trusted-contact")
      .then((r) => r.json())
      .then((d) => setContact(d.contact));
  }

  useEffect(() => {
    if (open && contact === undefined) load();
  }, [open, contact]);

  function startEdit() {
    setForm(emptyForm);
    setError("");
    setEditing(true);
  }

  async function save() {
    setError("");
    const required = [
      form.firstName,
      form.lastName,
      form.birthDate,
      form.email,
      form.question1,
      form.answer1,
      form.question2,
      form.answer2,
      form.question3,
      form.answer3,
    ];
    if (required.some((v) => !v.trim())) {
      setError("Tous les champs sont requis.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/trusted-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      setEditing(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Supprimer la personne de confiance ? L'accès d'urgence sera désactivé.")) return;
    await fetch("/api/settings/trusted-contact", { method: "DELETE" });
    load();
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-neutral-300"
      >
        <span>Accès d&apos;urgence — personne de confiance (en cas de décès ou d&apos;indisponibilité)</span>
        <span className="text-neutral-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-4">
          <p className="text-xs text-neutral-500">
            Désigne une personne qui pourra, en répondant correctement à 3 questions, déclencher la création d&apos;un
            accès administrateur complet au panel. L&apos;activation n&apos;est jamais immédiate : un délai de sécurité de
            48h s&apos;applique et tu peux annuler à tout moment depuis l&apos;email d&apos;alerte reçu. Passé ce délai, ton
            propre compte est suspendu et seule cette personne peut le débloquer.
          </p>

          {contact === undefined && <p className="text-xs text-neutral-600">Chargement…</p>}

          {contact === null && !editing && (
            <div>
              <p className="mb-2 text-xs text-neutral-600">Aucune personne de confiance configurée.</p>
              <button
                onClick={startEdit}
                className="rounded border border-neutral-600 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
              >
                Configurer
              </button>
            </div>
          )}

          {contact && !editing && (
            <div className="space-y-2 rounded border border-neutral-800 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-neutral-200">
                  {contact.firstName} {contact.lastName}
                </span>
                <div className="flex gap-3">
                  <button onClick={startEdit} className="text-xs text-blue-400 hover:underline">
                    Modifier
                  </button>
                  <button onClick={remove} className="text-xs text-red-400 hover:underline">
                    Retirer
                  </button>
                </div>
              </div>
              <p className="text-xs text-neutral-500">{contact.email}</p>
              <p className="text-xs text-neutral-600">
                Questions : {contact.question1} · {contact.question2} · {contact.question3}
              </p>
            </div>
          )}

          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <input
                  placeholder="Prénom"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                />
                <input
                  placeholder="Nom"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                />
              </div>
              <input
                type="date"
                value={form.birthDate}
                onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
              />
              <input
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
              />
              {([1, 2, 3] as const).map((n) => (
                <div key={n} className="grid grid-cols-2 gap-2">
                  <input
                    placeholder={`Question ${n}`}
                    value={form[`question${n}` as "question1" | "question2" | "question3"]}
                    onChange={(e) => setForm({ ...form, [`question${n}`]: e.target.value })}
                    className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                  />
                  <input
                    placeholder="Réponse"
                    value={form[`answer${n}` as "answer1" | "answer2" | "answer3"]}
                    onChange={(e) => setForm({ ...form, [`answer${n}`]: e.target.value })}
                    className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                  />
                </div>
              ))}
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded border border-neutral-600 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  Enregistrer
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded border border-neutral-800 px-3 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
