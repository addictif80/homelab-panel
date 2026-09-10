"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"password" | "totp">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [pendingToken, setPendingToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.setupRequired) router.replace("/setup");
      });
  }, [router]);

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      setPendingToken(data.pendingToken);
      setStep("totp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, code, trustDevice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-neutral-950 p-6">
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mb-2 text-2xl">🏠</div>
          <h1 className="text-lg font-semibold text-neutral-100">Homelab Panel</h1>
          <p className="mt-1 text-sm text-neutral-500">Connexion sécurisée</p>
        </div>

        {step === "password" && (
          <form onSubmit={handlePassword} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Nom d&apos;utilisateur</label>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Mot de passe</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full py-2">
              Continuer
            </button>
          </form>
        )}

        {step === "totp" && (
          <form onSubmit={handleTotp} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Code d&apos;authentification (2FA)</label>
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
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-700 bg-neutral-800"
              />
              Se souvenir de cet appareil pendant 30 jours
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full py-2">
              Se connecter
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
