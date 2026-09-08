"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<"form" | "qr">("form");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      setQrDataUrl(data.qrDataUrl);
      setSecret(data.secret);
      setStep("qr");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

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
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Configuration initiale</h1>
          <p className="text-sm text-neutral-400">
            Crée le compte administrateur unique du panel.
          </p>
        </div>

        {step === "form" && (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm mb-1">Nom d&apos;utilisateur</label>
              <input
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Mot de passe (12+ caractères)</label>
              <input
                type="password"
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-blue-600 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              Continuer
            </button>
          </form>
        )}

        {step === "qr" && (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-neutral-400">
              Scanne ce QR code avec ton application d&apos;authentification (Google
              Authenticator, Aegis, 1Password...), ou saisis la clé manuellement.
            </p>
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR code TOTP" className="mx-auto rounded bg-white p-2" />
            )}
            <p className="break-all text-center text-xs text-neutral-500">{secret}</p>
            <div>
              <label className="block text-sm mb-1">Code à 6 chiffres</label>
              <input
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm tracking-widest"
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
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-blue-600 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              Activer la 2FA
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
