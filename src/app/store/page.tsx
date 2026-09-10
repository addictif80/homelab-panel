"use client";

import { useEffect, useState } from "react";

type Pricing = { amountCents: number; currency: string; productName: string; productDescription: string };

const INK = "#101828";
const MUTED = "#5b6472";
const BORDER = "#e6e9f0";
const SURFACE = "#f7f8fc";
const PRIMARY = "#3b56d9";
const PRIMARY_DARK = "#2a3fae";

const TABS: { key: string; label: string; icon: string }[] = [
  { key: "security", label: "Sécurité", icon: "🛡️" },
  { key: "backups", label: "Sauvegardes", icon: "🗄️" },
  { key: "infra", label: "Docker & Proxmox", icon: "🖥️" },
  { key: "network", label: "Réseau", icon: "🌐" },
  { key: "alerts", label: "Alertes", icon: "🔔" },
];

const FEATURES = [
  {
    title: "Centre de sécurité qui explique, pas juste qui alerte",
    text: "SSH mal configuré, pare-feu absent, IP suspecte dans les logs, certificat qui expire : chaque problème est expliqué en français simple, avec un correctif en un clic à valider ou les commandes exactes à copier-coller.",
    icon: "🛡️",
  },
  {
    title: "Sauvegardes versionnées, cross-OS",
    text: "Proxmox, Synology, ZimaOS, OpenWrt, VPS Debian/Ubuntu : un seul système de sauvegarde façon Hyper Backup, avec historique de versions, qui transfère directement d'une machine à l'autre quel que soit l'OS.",
    icon: "🗄️",
  },
  {
    title: "Un seul panel, pas dix onglets",
    text: "SSH web, Docker, VM Proxmox, reverse proxy, Tailscale, supervision Uptime Kuma, explorateur de fichiers avec copie machine à machine, mises à jour système : tout au même endroit, un seul compte, une seule 2FA.",
    icon: "🧩",
  },
  {
    title: "Alertes où tu veux vraiment les voir",
    text: "Email (ton propre serveur SMTP), webhook générique, ntfy, Discord ou Slack — configurable en quelques clics, sans dépendre d'un service tiers imposé.",
    icon: "🔔",
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
    <div style={{ color: INK, background: "#fbfbfe" }} className="min-h-screen font-sans">
      {/* Nav */}
      <nav className="sticky top-0 z-20 border-b py-3" style={{ borderColor: BORDER, background: "rgba(255,255,255,.92)", backdropFilter: "blur(8px)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6">
          <span className="text-lg font-semibold">🏠 Homelab Panel</span>
          <div className="hidden items-center gap-6 text-sm font-medium md:flex" style={{ color: MUTED }}>
            <a href="#fonctionnalites" className="hover:text-inherit">Fonctionnalités</a>
            <a href="#tarifs" className="hover:text-inherit">Tarif</a>
          </div>
          <button
            onClick={buy}
            className="rounded px-4 py-2 text-sm font-semibold text-white shadow-sm"
            style={{ background: PRIMARY }}
          >
            Acheter
          </button>
        </div>
      </nav>

      {/* Hero */}
      <header className="border-b py-16" style={{ borderColor: BORDER }}>
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
          <div>
            <span
              className="mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: "#eef1fd", color: PRIMARY }}
            >
              ✨ Pensé pour ceux qui gèrent leur homelab seuls
            </span>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              Le panel qui gère ton homelab — <span style={{ color: PRIMARY }}>et qui t&apos;évite de jongler entre dix interfaces.</span>
            </h1>
            <p className="mt-4 text-lg" style={{ color: MUTED }}>
              Sécurité, sauvegardes, Docker, Proxmox, reverse proxy, Tailscale, supervision : un seul panel
              auto-hébergé, avec des explications en français simple et des correctifs en un clic.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={buy}
                disabled={loading}
                className="rounded px-6 py-3 text-sm font-semibold text-white shadow disabled:opacity-50"
                style={{ background: PRIMARY }}
              >
                {loading ? "Redirection..." : "Acheter maintenant"}
              </button>
              <a
                href="/api/store/trial-download"
                className="rounded border px-6 py-3 text-sm font-semibold"
                style={{ borderColor: BORDER, color: INK }}
              >
                Essayer gratuitement{trialDays ? ` (${trialDays} jours)` : ""}
              </a>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <p className="mt-4 text-sm" style={{ color: MUTED }}>
              ✅ Paiement unique &nbsp;·&nbsp; ✅ Licence à vie &nbsp;·&nbsp; ✅ Auto-hébergé chez toi
            </p>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-xl" style={{ borderColor: BORDER }}>
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">
                {TABS.find((t) => t.key === activeTab)?.icon} {TABS.find((t) => t.key === activeTab)?.label}
              </span>
              <span className="rounded border px-2 py-0.5 text-xs" style={{ borderColor: BORDER, color: MUTED }}>
                Aperçu
              </span>
            </div>
            <div className="mb-4 flex flex-wrap gap-2 border-b pb-3" style={{ borderColor: BORDER }}>
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className="rounded-full border px-3 py-1 text-xs font-semibold transition"
                  style={
                    activeTab === t.key
                      ? { background: PRIMARY, borderColor: PRIMARY, color: "#fff" }
                      : { borderColor: BORDER, color: MUTED }
                  }
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            <div className="min-h-[190px] text-sm">
              {activeTab === "security" && (
                <div>
                  <Row ok text="PermitRootLogin par mot de passe" value="désactivé" />
                  <Row ok text="Fail2ban" value="actif" />
                  <Row ok text="Certificat homelab.abhd.fr" value="87 jours restants" />
                  <p className="mt-2 text-xs" style={{ color: MUTED }}>
                    Chaque ligne rouge vient avec une explication simple et un bouton pour corriger.
                  </p>
                </div>
              )}
              {activeTab === "backups" && (
                <div>
                  <Row ok text="Configs Mailcow → DS115J" value="il y a 2h" />
                  <Row ok text="Volumes Docker HP → DS115J" value="hier" />
                  <Row ok text="7 versions conservées" value="rétention" />
                  <p className="mt-2 text-xs" style={{ color: MUTED }}>
                    Historique complet, restauration en un clic vers n&apos;importe quelle machine.
                  </p>
                </div>
              )}
              {activeTab === "infra" && (
                <div>
                  <Row ok text="12 conteneurs Docker" value="3 machines" />
                  <Row ok text="pve1 / pve2" value="cluster actif" />
                  <Row ok text="Terminal SSH intégré" value="VM, LXC, conteneurs" />
                  <p className="mt-2 text-xs" style={{ color: MUTED }}>
                    Démarre, arrête, met à jour et ouvre un shell sans quitter le panel.
                  </p>
                </div>
              )}
              {activeTab === "network" && (
                <div>
                  <Row ok text="Nginx Proxy Manager" value="5 domaines" />
                  <Row ok text="Tailscale" value="8 appareils" />
                  <Row ok text="Uptime Kuma" value="intégré" />
                  <p className="mt-2 text-xs" style={{ color: MUTED }}>
                    Redirections, ACL et supervision réseau gérés depuis le même endroit.
                  </p>
                </div>
              )}
              {activeTab === "alerts" && (
                <div>
                  <Alert color="#7a5600" bg="#fff7e6" border="#ffe9b8" text="IP suspecte détectée dans les logs (bruteforce)" />
                  <Alert color="#8a2323" bg="#fdeaea" border="#f6c6c6" text="Certificat expire dans 5 jours" />
                  <Alert color="#1e6b3a" bg="#eaf6ee" border="#bfe6cc" text="Sauvegarde du soir terminée avec succès" />
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Trust strip */}
      <div className="border-b bg-white py-3" style={{ borderColor: BORDER }}>
        <div className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-8 gap-y-2 px-6 text-xs font-semibold" style={{ color: MUTED }}>
          <span>🔒 Auto-hébergé chez toi</span>
          <span>🚫 Aucune donnée envoyée à un tiers</span>
          <span>🖥️ Proxmox · Synology · OpenWrt · ZimaOS</span>
          <span>🔑 2FA obligatoire</span>
          <span>♾️ Licence à vie</span>
        </div>
      </div>

      {/* Features */}
      <section id="fonctionnalites" className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-10 text-center">
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: PRIMARY }}>
            Fonctionnalités
          </span>
          <h2 className="mt-2 text-2xl font-bold">Ce qui fait la différence</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
              <div
                className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl text-lg"
                style={{ background: "#eef1fd" }}
              >
                {f.icon}
              </div>
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm" style={{ color: MUTED }}>
                {f.text}
              </p>
            </div>
          ))}
        </div>

        {/* Comparison table */}
        <div className="mt-14 overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
          <table className="w-full text-sm">
            <thead style={{ background: SURFACE }}>
              <tr>
                <th className="px-5 py-3 text-left font-bold" style={{ width: "50%" }}></th>
                <th className="px-5 py-3 text-center font-bold" style={{ color: MUTED }}>
                  Scripts + 10 interfaces séparées
                </th>
                <th className="px-5 py-3 text-center font-bold" style={{ color: PRIMARY }}>
                  Homelab Panel
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row} className="border-t" style={{ borderColor: BORDER }}>
                  <td className="px-5 py-3">{row}</td>
                  <td className="px-5 py-3 text-center" style={{ color: "#adb5bd" }}>
                    –
                  </td>
                  <td className="px-5 py-3 text-center font-bold" style={{ color: "#157347" }}>
                    ✓
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Steps */}
      <section className="py-16" style={{ background: SURFACE }}>
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-10 text-center">
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: PRIMARY }}>
              En pratique
            </span>
            <h2 className="mt-2 text-2xl font-bold">De l&apos;achat au panel en ligne, en 3 étapes</h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="flex gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: INK }}
                >
                  {i + 1}
                </div>
                <div>
                  <h3 className="text-sm font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm" style={{ color: MUTED }}>
                    {s.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="tarifs" className="mx-auto max-w-3xl px-6 py-20 text-center">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: PRIMARY }}>
          Tarif
        </span>
        <h2 className="mt-2 text-2xl font-bold">Un tarif simple, sans abonnement</h2>

        {pricing ? (
          <div className="mx-auto mt-8 max-w-sm rounded-2xl border p-8 shadow-lg" style={{ borderColor: PRIMARY }}>
            <h3 className="text-sm font-semibold">{pricing.productName}</h3>
            {pricing.productDescription && (
              <p className="mt-2 text-sm" style={{ color: MUTED }}>
                {pricing.productDescription}
              </p>
            )}
            <p className="mt-4 text-4xl font-extrabold">{formatPrice(pricing)}</p>
            <p className="mt-1 text-xs" style={{ color: MUTED }}>
              Paiement unique, licence auto-hébergée.
            </p>
            <button
              onClick={buy}
              disabled={loading}
              className="mt-6 w-full rounded px-6 py-3 text-sm font-semibold text-white shadow disabled:opacity-50"
              style={{ background: PRIMARY }}
            >
              {loading ? "Redirection..." : "Acheter maintenant"}
            </button>
            <p className="mt-4 text-xs" style={{ color: "#adb5bd" }}>
              Lien de téléchargement à usage unique envoyé par email après paiement.
            </p>
          </div>
        ) : (
          <p className="mt-6 text-sm" style={{ color: MUTED }}>
            Tarif indisponible pour le moment.
          </p>
        )}
      </section>

      {/* CTA band */}
      <section className="py-16 text-center text-white" style={{ background: `linear-gradient(135deg, ${INK}, #1d2b6b 60%, ${PRIMARY})` }}>
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="text-2xl font-bold">Prêt à reprendre le contrôle de ton homelab ?</h2>
          <p className="mt-3" style={{ color: "rgba(255,255,255,.85)" }}>
            Un seul panel pour la sécurité, les sauvegardes et l&apos;administration de toute ton infra.
          </p>
          <button
            onClick={buy}
            disabled={loading}
            className="mt-6 rounded px-6 py-3 text-sm font-semibold shadow disabled:opacity-50"
            style={{ background: "#fff", color: INK }}
          >
            {loading ? "Redirection..." : "Acheter maintenant"}
          </button>
        </div>
      </section>

      <footer className="border-t bg-white py-6" style={{ borderColor: BORDER }}>
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 text-xs sm:flex-row" style={{ color: MUTED }}>
          <span>🏠 Homelab Panel</span>
          <div className="flex gap-4">
            <a href="/login" className="hover:underline">
              Connexion
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Row({ ok, text, value }: { ok: boolean; text: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b py-2" style={{ borderColor: BORDER }}>
      <span>
        <span style={{ color: ok ? "#157347" : "#c0392b" }}>{ok ? "✓" : "✕"}</span> {text}
      </span>
      <span style={{ color: MUTED }}>{value}</span>
    </div>
  );
}

function Alert({ color, bg, border, text }: { color: string; bg: string; border: string; text: string }) {
  return (
    <div className="mb-2 rounded px-3 py-2 text-xs font-semibold" style={{ color, background: bg, border: `1px solid ${border}` }}>
      {text}
    </div>
  );
}
