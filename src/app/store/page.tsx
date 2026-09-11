"use client";

import { useEffect, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";

type Pricing = { amountCents: number; currency: string; productName: string; productDescription: string };

const TABS: { key: string; label: string }[] = [
  { key: "security", label: "Sécurité" },
  { key: "backups", label: "Sauvegardes" },
  { key: "infra", label: "Docker & Proxmox" },
  { key: "network", label: "Réseau" },
  { key: "alerts", label: "Alertes" },
];

const FEATURES = [
  {
    title: "Un centre de sécurité qui explique, pas qui alerte",
    text: "SSH mal configuré, pare-feu absent, IP suspecte, certificat qui expire : chaque problème vient avec une explication claire et un correctif en un clic à valider, ou les commandes exactes à copier.",
    icon: (
      <path d="M12 3l7 3.2v5.4c0 4.7-3 8-7 9.4-4-1.4-7-4.7-7-9.4V6.2L12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    ),
  },
  {
    title: "Sauvegardes versionnées, cross-OS",
    text: "Proxmox, Synology, ZimaOS, OpenWrt, VPS Debian/Ubuntu : un seul système de sauvegarde façon Hyper Backup, historique de versions, transfert direct d'une machine à l'autre quel que soit l'OS.",
    icon: (
      <>
        <rect x="3.5" y="5" width="17" height="4.2" rx="1" stroke="currentColor" strokeWidth="1.6" />
        <path d="M4.5 9.2V17a2 2 0 002 2h11a2 2 0 002-2V9.2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 13h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: "Un seul panel, pas dix onglets",
    text: "SSH web, Docker, VM Proxmox, reverse proxy, Tailscale, DNS, supervision Uptime Kuma, explorateur de fichiers : tout au même endroit, un seul compte, une seule 2FA.",
    icon: (
      <>
        <rect x="4" y="4" width="16" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.6" />
        <rect x="4" y="10" width="16" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.6" />
        <rect x="4" y="16" width="16" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.6" />
      </>
    ),
  },
  {
    title: "Des alertes où tu veux vraiment les voir",
    text: "Email via ton propre serveur SMTP, webhook générique, ntfy, Discord ou Slack — configurable en quelques clics, sans dépendre d'un service tiers imposé.",
    icon: (
      <>
        <path d="M6 9a6 6 0 0112 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M10 19a2 2 0 004 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
];

const COMPARISON_ROWS = [
  "Fonctionne avec Proxmox, Synology, OpenWrt et ZimaOS en même temps",
  "Explique chaque alerte de sécurité en langage simple",
  "Correctifs de sécurité en un clic (avec confirmation)",
  "Sauvegardes versionnées machine à machine, sans service cloud tiers",
  "Terminal SSH, Docker et gestion Proxmox dans la même interface",
  "Auto-hébergé, aucune donnée envoyée à un tiers",
];

const STEPS = [
  { title: "Tu achètes", text: "Paiement unique et sécurisé via Stripe, aucune carte bancaire ne transite par nos serveurs." },
  { title: "Tu reçois ton lien", text: "Un email avec un lien de téléchargement à usage unique arrive dans les minutes qui suivent." },
  { title: "Tu déploies chez toi", text: "npm install, npm run build, et c'est en ligne sur ton propre serveur — la licence t'appartient." },
];

const CHECK = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0">
    <path d="M5 13l4 4L19 7" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LOGOMARK = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0">
    <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.6" className="text-blue-600" />
    <path d="M7.5 9H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
    <path d="M7.5 12.5H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
    <path d="M7.5 16H12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-blue-600" />
  </svg>
);

function formatPrice(pricing: Pricing): string {
  const amount = (pricing.amountCents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = pricing.currency.toLowerCase() === "eur" ? "€" : pricing.currency.toUpperCase();
  return `${amount} ${symbol}`;
}

export default function StorePage() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [trialDays, setTrialDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("security");

  useEffect(() => {
    fetch("/api/store/pricing")
      .then((r) => r.json())
      .then((d) => {
        setPricing(d.pricing);
        setTrialDays(d.trialDays);
      });
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
      {/* Nav */}
      <nav className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/90 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            {LOGOMARK}
            <span className="font-display text-base font-semibold">Homelab Panel</span>
          </div>
          <div className="hidden items-center gap-9 text-sm text-neutral-400 md:flex">
            <a href="#fonctionnalites" className="hover:text-neutral-100">Fonctionnalités</a>
            <a href="#tarifs" className="hover:text-neutral-100">Tarif</a>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <a href="/login" className="hidden text-sm text-neutral-400 hover:text-neutral-100 sm:inline">Se connecter</a>
            <button onClick={buy} className="btn-primary px-4 py-2">Acheter</button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="border-b border-neutral-800">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-neutral-800 px-3.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">Pour l&apos;auto-hébergement sérieux</span>
            </div>
            <h1 className="text-4xl font-semibold leading-[1.1] sm:text-5xl">
              Un seul panel pour tout ton homelab —{" "}
              <span className="text-blue-400">pas dix onglets ouverts.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-neutral-400">
              Sécurité, sauvegardes, Docker, Proxmox, reverse proxy, Tailscale, DNS, supervision : une interface
              auto-hébergée, avec des explications claires et des correctifs en un clic.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button onClick={buy} disabled={loading} className="btn-primary px-6 py-3 text-sm shadow-lg shadow-blue-950/40 disabled:opacity-50">
                {loading ? "Redirection..." : `Acheter maintenant${pricing ? ` — ${formatPrice(pricing)}` : ""}`}
              </button>
              <a
                href="/api/store/trial-download"
                className="btn-secondary px-6 py-3 text-sm"
              >
                Essai gratuit{trialDays ? ` — ${trialDays} jours` : ""}
              </a>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2 text-sm text-neutral-400">{CHECK}Paiement unique</div>
              <div className="flex items-center gap-2 text-sm text-neutral-400">{CHECK}Licence à vie</div>
              <div className="flex items-center gap-2 text-sm text-neutral-400">{CHECK}Auto-hébergé chez toi</div>
            </div>
          </div>

          {/* Product visualization */}
          <div className="card overflow-hidden shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3.5">
              <span className="font-mono text-xs text-neutral-500">{TABS.find((t) => t.key === activeTab)?.label.toUpperCase()}</span>
              <span className="rounded-full border border-neutral-800 px-2.5 py-0.5 font-mono text-[11px] text-neutral-500">Aperçu</span>
            </div>
            <div className="flex flex-wrap gap-1.5 border-b border-neutral-800 px-4 py-3">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    activeTab === t.key ? "bg-blue-600 text-white" : "text-neutral-400 hover:bg-neutral-800"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="min-h-[210px] p-5 text-sm">
              {activeTab === "security" && (
                <div>
                  <Row ok text="PermitRootLogin par mot de passe" value="désactivé" />
                  <Row ok text="Fail2ban" value="actif" />
                  <Row text="Certificat homelab.abhd.fr" value="87 jours restants" />
                  <p className="mt-3 text-xs text-neutral-500">
                    Chaque ligne à surveiller vient avec une explication simple et un bouton pour corriger.
                  </p>
                </div>
              )}
              {activeTab === "backups" && (
                <div>
                  <Row ok text="Configs Mailcow → DS115J" value="il y a 2h" />
                  <Row ok text="Volumes Docker HP → DS115J" value="hier" />
                  <Row ok text="7 versions conservées" value="rétention" />
                  <p className="mt-3 text-xs text-neutral-500">
                    Historique complet, restauration en un clic vers n&apos;importe quelle machine.
                  </p>
                </div>
              )}
              {activeTab === "infra" && (
                <div>
                  <Row ok text="12 conteneurs Docker" value="3 machines" />
                  <Row ok text="pve1 / pve2" value="cluster actif" />
                  <Row ok text="Terminal SSH intégré" value="VM, LXC, conteneurs" />
                  <p className="mt-3 text-xs text-neutral-500">
                    Démarre, arrête, met à jour et ouvre un shell sans quitter le panel.
                  </p>
                </div>
              )}
              {activeTab === "network" && (
                <div>
                  <Row ok text="Nginx Proxy Manager" value="5 domaines" />
                  <Row ok text="Tailscale" value="8 appareils" />
                  <Row ok text="Uptime Kuma" value="intégré" />
                  <p className="mt-3 text-xs text-neutral-500">
                    Redirections, ACL, DNS et supervision réseau gérés depuis le même endroit.
                  </p>
                </div>
              )}
              {activeTab === "alerts" && (
                <div className="space-y-2.5">
                  <Alert kind="warning" text="IP suspecte détectée dans les logs (bruteforce)" />
                  <Alert kind="danger" text="Certificat expire dans 5 jours" />
                  <Alert kind="success" text="Sauvegarde du soir terminée avec succès" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Trust strip */}
        <div className="border-t border-neutral-800 py-5">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-6">
            {["PROXMOX", "SYNOLOGY", "OPENWRT", "ZIMAOS", "DOCKER"].map((name, i) => (
              <span key={name} className="flex items-center gap-10">
                {i > 0 && <span className="hidden h-3.5 w-px bg-neutral-800 sm:block" />}
                <span className="font-mono text-xs tracking-wider text-neutral-600">{name}</span>
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Features */}
      <section id="fonctionnalites" className="mx-auto max-w-6xl px-6 py-24">
        <div className="mb-14 text-center">
          <span className="font-mono text-xs uppercase tracking-wider text-blue-400">Fonctionnalités</span>
          <h2 className="mt-3 text-3xl font-semibold">Ce qui fait la différence</h2>
        </div>
        <div className="grid gap-px overflow-hidden rounded-xl border border-neutral-800 bg-neutral-800 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-neutral-950 p-8">
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-800 text-blue-400">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none">{f.icon}</svg>
              </div>
              <h3 className="text-base font-semibold">{f.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-neutral-400">{f.text}</p>
            </div>
          ))}
        </div>

        {/* Comparison table */}
        <div className="mt-20 overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900">
              <tr>
                <th className="w-1/2 px-5 py-3.5"></th>
                <th className="px-5 py-3.5 text-center font-mono text-xs font-normal text-neutral-500">Scripts + 10 interfaces</th>
                <th className="px-5 py-3.5 text-center font-mono text-xs font-normal text-blue-400">Homelab Panel</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row} className="border-t border-neutral-800">
                  <td className="px-5 py-3.5">{row}</td>
                  <td className="px-5 py-3.5 text-center text-neutral-700">—</td>
                  <td className="px-5 py-3.5 text-center">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="mx-auto">
                      <path d="M5 13l4 4L19 7" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Steps */}
      <section className="border-y border-neutral-800 bg-neutral-900/40 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-14 text-center">
            <span className="font-mono text-xs uppercase tracking-wider text-blue-400">En pratique</span>
            <h2 className="mt-3 text-3xl font-semibold">De l&apos;achat au panel en ligne, en 3 étapes</h2>
          </div>
          <div className="grid gap-10 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-700 font-mono text-sm text-neutral-300">
                  {i + 1}
                </div>
                <div>
                  <h3 className="text-sm font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">{s.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="tarifs" className="mx-auto max-w-3xl px-6 py-24 text-center">
        <span className="font-mono text-xs uppercase tracking-wider text-blue-400">Tarif</span>
        <h2 className="mt-3 text-3xl font-semibold">Un tarif simple, sans abonnement</h2>

        {pricing ? (
          <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-neutral-700 bg-gradient-to-b from-neutral-900 to-neutral-950 p-10">
            <h3 className="text-base font-semibold">{pricing.productName}</h3>
            {pricing.productDescription && <p className="mt-2 text-sm text-neutral-400">{pricing.productDescription}</p>}
            <p className="mt-6 font-display text-5xl font-semibold">{formatPrice(pricing)}</p>
            <p className="mt-2 font-mono text-xs uppercase tracking-wider text-neutral-500">Paiement unique</p>
            <button onClick={buy} disabled={loading} className="btn-primary mt-8 w-full py-3.5 text-sm disabled:opacity-50">
              {loading ? "Redirection..." : "Acheter maintenant"}
            </button>
            <p className="mt-5 text-xs text-neutral-600">Lien de téléchargement envoyé par email après paiement.</p>
          </div>
        ) : (
          <p className="mt-8 text-sm text-neutral-500">Tarif indisponible pour le moment.</p>
        )}
      </section>

      {/* CTA band */}
      <section className="border-t border-neutral-800 py-20 text-center">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="text-3xl font-semibold">Prêt à reprendre le contrôle de ton homelab ?</h2>
          <p className="mt-3 text-neutral-400">
            Un seul panel pour la sécurité, les sauvegardes et l&apos;administration de toute ton infra.
          </p>
          <button onClick={buy} disabled={loading} className="btn-primary mt-7 px-7 py-3.5 text-sm disabled:opacity-50">
            {loading ? "Redirection..." : "Acheter maintenant"}
          </button>
        </div>
      </section>

      <footer className="border-t border-neutral-800 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 text-sm text-neutral-500 sm:flex-row">
          <div className="flex items-center gap-2">
            {LOGOMARK}
            <span>Homelab Panel</span>
          </div>
          <a href="/login" className="hover:text-neutral-300">Connexion</a>
        </div>
      </footer>
    </div>
  );
}

function Row({ ok, text, value }: { ok?: boolean; text: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-900 py-2 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
        <span className="text-neutral-200">{text}</span>
      </div>
      <span className={`font-mono text-xs ${ok ? "text-emerald-400" : "text-amber-400"}`}>{value}</span>
    </div>
  );
}

function Alert({ kind, text }: { kind: "warning" | "danger" | "success"; text: string }) {
  const styles = {
    warning: "border-amber-900/50 bg-amber-950/30 text-amber-300",
    danger: "border-red-900/50 bg-red-950/30 text-red-300",
    success: "border-emerald-900/50 bg-emerald-950/30 text-emerald-300",
  }[kind];
  return <div className={`rounded-lg border px-3.5 py-2.5 text-xs ${styles}`}>{text}</div>;
}
