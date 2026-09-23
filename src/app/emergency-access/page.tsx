"use client";

import { useEffect, useState } from "react";

type Questions = { question1: string; question2: string; question3: string };

export default function EmergencyAccessPage() {
  const [questions, setQuestions] = useState<Questions | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [email, setEmail] = useState("");
  const [answer1, setAnswer1] = useState("");
  const [answer2, setAnswer2] = useState("");
  const [answer3, setAnswer3] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/emergency-access/questions")
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        setConfigured(ok && d.configured);
        if (ok && d.configured) setQuestions(d.questions);
      })
      .catch(() => setConfigured(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/emergency-access/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, birthDate, email, answer1, answer2, answer3 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-neutral-950 p-6">
      <div className="card w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <h1 className="font-display text-lg font-bold text-neutral-100">Accès d&apos;urgence</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Cette page permet à une personne de confiance désignée à l&apos;avance de demander l&apos;accès à ce panel.
          </p>
        </div>

        {configured === null && <p className="text-sm text-neutral-500 text-center">Chargement…</p>}

        {configured === false && (
          <p className="text-sm text-neutral-400 text-center">
            Aucun accès d&apos;urgence n&apos;a été configuré sur ce panel.
          </p>
        )}

        {configured && !done && questions && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-xs text-neutral-500">
              Renseigne tes informations et réponds aux 3 questions telles que convenu avec la personne qui t&apos;a désigné(e).
              Si tout correspond, l&apos;accès sera activé après un délai de sécurité — la personne concernée en sera avertie
              par email et pourra l&apos;annuler si nécessaire.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Prénom</label>
                <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div>
                <label className="mb-1 block text-sm text-neutral-300">Nom</label>
                <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Date de naissance</label>
              <input type="date" className="input" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Email</label>
              <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">{questions.question1}</label>
              <input className="input" value={answer1} onChange={(e) => setAnswer1(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">{questions.question2}</label>
              <input className="input" value={answer2} onChange={(e) => setAnswer2(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">{questions.question3}</label>
              <input className="input" value={answer3} onChange={(e) => setAnswer3(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full py-2">
              {loading ? "Vérification…" : "Envoyer la demande"}
            </button>
          </form>
        )}

        {done && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-emerald-400">Demande envoyée.</p>
            <p className="text-sm text-neutral-400">
              Si les informations correspondent, tu recevras un email de confirmation. L&apos;accès n&apos;est jamais immédiat :
              un délai de sécurité s&apos;applique, pendant lequel la personne qui t&apos;a désigné(e) peut annuler la demande.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
