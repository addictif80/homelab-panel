"use client";

import { useEffect, useState } from "react";

type Pricing = { amountCents: number; currency: string; productName: string; productDescription: string };

const FEATURES: { title: string; text: string }[] = [
  {
    title: "Centre de sécurité qui explique, pas seulement qui alerte",
    text: "Chaque problème détecté (SSH mal configuré, pare-feu absent, IP suspecte dans les logs, certificat qui expire...) est expliqué en français simple, avec soit un correctif en un clic à valider, soit les commandes exactes à copier-coller.",
  },
  {
    title: "Sauvegardes versionnées, cross-OS",
    text: "Proxmox, Synology, ZimaOS, OpenWrt, VPS Debian/Ubuntu : un seul système de sauvegarde versionné (façon Hyper Backup) qui transfère directement d'une machine à l'autre, quel que soit l'OS de chaque côté.",
  },
  {
    title: "Un seul panel, pas dix onglets",
    text: "SSH web, gestion Docker, VM Proxmox, reverse proxy, Tailscale, supervision Uptime Kuma, explorateur de fichiers avec copie machine à machine, mises à jour système : tout au même endroit, avec le même compte et la même 2FA.",
  },
  {
    title: "Alertes où tu veux vraiment les voir",
    text: "Email (ton propre serveur SMTP), webhook générique, ntfy, Discord ou Slack — configurable en quelques clics, sans dépendre d'un service tiers imposé.",
  },
];

function formatPrice(pricing: Pricing): string {
  const amount = (pricing.amountCents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = pricing.currency.toLowerCase() === "eur" ? "€" : pricing.currency.toUpperCase();
  return `${amount} ${symbol}`;
}

export default function StorePage() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/store/pricing")
      .then((r) => r.json())
      .then((d) => setPricing(d.pricing));
  }, []);

  async function buy() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/store/checkout", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-4xl px-6 py-20">
        <header className="text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-blue-400">Homelab Panel</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-neutral-50 sm:text-5xl">
            Le centre de contrôle unique pour ton homelab
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-neutral-400">
            Proxmox, Synology, OpenWrt, VPS, Docker... au lieu de jongler entre dix interfaces différentes, pilote
            sécurité, sauvegardes, mises à jour et accès depuis un seul panel — pensé pour quelqu&apos;un qui gère son
            infra tout seul, pas pour une équipe IT.
          </p>
        </header>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="text-sm font-semibold text-neutral-100">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-neutral-400">{f.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center">
          {pricing ? (
            <>
              <h2 className="text-lg font-semibold text-neutral-100">{pricing.productName}</h2>
              {pricing.productDescription && (
                <p className="mx-auto mt-2 max-w-lg text-sm text-neutral-400">{pricing.productDescription}</p>
              )}
              <p className="mt-4 text-4xl font-semibold text-neutral-50">{formatPrice(pricing)}</p>
              <p className="mt-1 text-xs text-neutral-500">Paiement unique, licence auto-hébergée.</p>
              <button
                onClick={buy}
                disabled={loading}
                className="mt-6 rounded bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {loading ? "Redirection..." : "Acheter maintenant"}
              </button>
              {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
              <p className="mt-4 text-xs text-neutral-600">
                Après paiement, un lien de téléchargement à usage unique t&apos;est envoyé par email.
              </p>
            </>
          ) : (
            <p className="text-sm text-neutral-500">Tarif indisponible pour le moment.</p>
          )}
        </div>
      </div>
    </div>
  );
}
