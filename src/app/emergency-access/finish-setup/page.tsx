"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function FinishSetupPage() {
  return (
    <Suspense fallback={null}>
      <FinishSetupForm />
    </Suspense>
  );
}

function FinishSetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const username = searchParams.get("username") || "";
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, code }),
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
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <h1 className="font-display text-lg font-bold text-neutral-100">Dernière étape</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Confirme le code à 6 chiffres affiché par ton application d&apos;authentification pour activer ton compte.
          </p>
        </div>

        {!done && (
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Code à 6 chiffres</label>
              <input
                className="input tracking-widest"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full py-2">
              Activer mon compte
            </button>
          </form>
        )}

        {done && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-emerald-400">Compte activé !</p>
            <button className="btn-primary w-full py-2" onClick={() => router.push("/login")}>
              Se connecter
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
