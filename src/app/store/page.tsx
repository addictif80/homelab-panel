"use client";

import { useEffect, useRef, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";

type PlanKey = "lifetime" | "monthly" | "annual";
const PLAN_KEYS: PlanKey[] = ["lifetime", "monthly", "annual"];
const PLAN_TITLES: Record<PlanKey, string> = { lifetime: "Achat unique", monthly: "Mensuel", annual: "Annuel" };
const PLAN_SUFFIX: Record<PlanKey, string> = { lifetime: "", monthly: "/mois", annual: "/an" };
const PLAN_NOTE: Record<PlanKey, string> = {
  lifetime: "Paiement unique, licence à vie",
  monthly: "Sans engagement, résiliable à tout moment",
  annual: "Facturé une fois par an",
};

type PlanPricing = { enabled: boolean; amountCents: number };
type Pricing = { currency: string; productName: string; productDescription: string; plans: Record<PlanKey, PlanPricing> };
type KeyRecoveryConfig = { enabled: boolean; amountCents: number };
type LandingCta = { enabled: boolean; text: string; buttonLabel: string; buttonUrl: string };
type DirectoryEntry = {
  id: string;
  ownerName: string;
  serviceName: string;
  serviceUrl: string;
  description: string;
  faviconDataUrl: string | null;
  screenshotDataUrl: string | null;
};

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
  {
    title: "Terminal SSH intégré, dans le navigateur",
    text: "Un vrai shell (machine, VM, LXC ou conteneur Docker) directement dans le panel, sans client SSH séparé — historique de commandes, redimensionnement automatique, élévation sudo gérée pour toi.",
    icon: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M7 9.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12.5 14.5h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: "Migration de VM et de conteneurs en un clic",
    text: "Déplace une VM/LXC Proxmox ou un conteneur Docker (image, volumes, données) d'une machine à une autre — migration native si même cluster, export/import automatique sinon.",
    icon: (
      <>
        <rect x="2.5" y="9" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
        <rect x="14.5" y="9" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9.5 12.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M12 10.5l2 2-2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    title: "Docker Compose et modèles d'applications",
    text: "Déploie n'importe quel docker-compose.yml (stacks façon Portainer) ou pars d'un modèle prêt à l'emploi ; une pastille signale automatiquement les images qui ont une mise à jour disponible.",
    icon: (
      <>
        <rect x="4" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
        <rect x="13" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
        <rect x="8.5" y="13.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" />
      </>
    ),
  },
  {
    title: "Santé matérielle en direct",
    text: "Températures, état SMART des disques (avec détection automatique des contrôleurs RAID) et niveau de charge de l'onduleur, lus en direct par SSH — aucune sonde IPMI à configurer.",
    icon: (
      <>
        <path d="M12 3v11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="12" cy="17.5" r="3.2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 3a1.6 1.6 0 013.2 0v9.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: "Audit de ports passif",
    text: "Détecte les ports sensibles exposés (bases de données, RDP, Docker distant...) sans jamais tenter la moindre authentification — aucun risque de déclencher ton propre fail2ban.",
    icon: (
      <>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 4v2.4M12 17.6V20M4 12h2.4M17.6 12H20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: "Coffre de récupération hors-ligne",
    text: "Exporte un instantané chiffré (AES-256) de toute la configuration du panel — inventaire, identifiants, plans de sauvegarde — à garder en lieu sûr, hors ligne, pour reconstruire après un sinistre.",
    icon: (
      <>
        <rect x="5.5" y="10.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8.5 10.5V7.5a3.5 3.5 0 017 0v3" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="14.8" r="1.4" stroke="currentColor" strokeWidth="1.6" />
      </>
    ),
  },
  {
    title: "Mode Lockdown en un clic",
    text: "En cas de doute sur une intrusion, verrouille l'accès au panel depuis toutes les autres sessions actives d'un seul geste, sans jamais te déconnecter toi-même par erreur.",
    icon: (
      <>
        <path d="M12 3l7 3.2v5.4c0 4.7-3 8-7 9.4-4-1.4-7-4.7-7-9.4V6.2L12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M9.5 12l1.8 1.8L15 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    title: "Réseau, DNS et routeurs centralisés",
    text: "Tailscale (ACL, routes), reverse proxy Nginx Proxy Manager, DNS multi-registrar (Cloudflare, OVH, Gandi, Namecheap) et gestion de routeurs (OpenWrt, pfSense, Freebox) au même endroit.",
    icon: (
      <>
        <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.8 12h16.4M12 3.8c2.3 2.2 3.6 5.2 3.6 8.2s-1.3 6-3.6 8.2c-2.3-2.2-3.6-5.2-3.6-8.2S9.7 6 12 3.8z" stroke="currentColor" strokeWidth="1.6" />
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
  { title: "Tu achètes", text: "Paiement sécurisé via Stripe (unique ou par abonnement), aucune carte bancaire ne transite par nos serveurs." },
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

function formatAmount(amountCents: number, currency: string): string {
  const amount = (amountCents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = currency.toLowerCase() === "eur" ? "€" : currency.toUpperCase();
  return `${amount} ${symbol}`;
}

export default function StorePage() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [trialDays, setTrialDays] = useState<number | null>(null);
  const [keyRecovery, setKeyRecovery] = useState<KeyRecoveryConfig | null>(null);
  const [landingCta, setLandingCta] = useState<LandingCta | null>(null);
  const [ctaDismissed, setCtaDismissed] = useState(false);
  const [directoryEntries, setDirectoryEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState<PlanKey | null>(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("security");

  const [ticketEmail, setTicketEmail] = useState("");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSending, setTicketSending] = useState(false);
  const [ticketError, setTicketError] = useState("");
  const [ticketLink, setTicketLink] = useState<string | null>(null);

  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");

  const [promoInput, setPromoInput] = useState("");
  const [promoValidating, setPromoValidating] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [appliedPromo, setAppliedPromo] = useState("");
  const [promoDiscounts, setPromoDiscounts] = useState<Partial<Record<PlanKey, string>>>({});

  useEffect(() => {
    fetch("/api/store/pricing")
      .then((r) => r.json())
      .then((d) => {
        setPricing(d.pricing);
        setTrialDays(d.trialDays);
        setKeyRecovery(d.keyRecovery ?? null);
        setLandingCta(d.landingCta ?? null);
      });
    fetch("/api/store/directory")
      .then((r) => r.json())
      .then((d) => setDirectoryEntries(d.entries ?? []));
  }, []);

  async function submitTicket(e: React.FormEvent) {
    e.preventDefault();
    setTicketSending(true);
    setTicketError("");
    try {
      const res = await fetch("/api/store/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: ticketEmail, subject: ticketSubject, message: ticketMessage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTicketLink(`/store/support/${data.id}?token=${data.token}`);
      setTicketSubject("");
      setTicketMessage("");
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setTicketSending(false);
    }
  }

  async function submitRecovery(e: React.FormEvent) {
    e.preventDefault();
    setRecoveryLoading(true);
    setRecoveryError("");
    try {
      const res = await fetch("/api/store/key-recovery/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: recoveryEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : "Erreur.");
      setRecoveryLoading(false);
    }
  }

  const enabledPlans = pricing ? PLAN_KEYS.filter((k) => pricing.plans[k]?.enabled) : [];
  const heroPlan = enabledPlans[0] ?? null;

  async function buy(plan: PlanKey) {
    setLoading(plan);
    setError("");
    try {
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, promoCode: appliedPromo || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
      setLoading(null);
    }
  }

  async function applyPromo() {
    if (!promoInput.trim()) return;
    setPromoValidating(true);
    setPromoError("");
    setPromoDiscounts({});
    try {
      const results = await Promise.all(
        enabledPlans.map(async (plan) => {
          const res = await fetch("/api/store/promo-codes/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: promoInput, plan }),
          });
          const data = await res.json();
          return { plan, valid: res.ok && data.valid, label: data.discountedLabel as string | undefined, error: data.error as string | undefined };
        })
      );
      const valid = results.filter((r) => r.valid);
      if (valid.length === 0) {
        setPromoError(results[0]?.error || "Code promo invalide.");
        setAppliedPromo("");
        return;
      }
      setPromoDiscounts(Object.fromEntries(valid.map((r) => [r.plan, r.label])));
      setAppliedPromo(promoInput.trim());
    } catch {
      setPromoError("Erreur de validation du code.");
    } finally {
      setPromoValidating(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Optional seller-configured promo banner */}
      {landingCta?.enabled && landingCta.text && !ctaDismissed && (
        <div className="relative sticky top-0 z-30 flex items-center justify-center gap-3 bg-blue-600 px-10 py-2.5 text-center text-sm text-white">
          <span className="min-w-0 truncate">{landingCta.text}</span>
          {landingCta.buttonLabel && landingCta.buttonUrl && (
            <a
              href={landingCta.buttonUrl}
              className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-medium hover:bg-white/25"
            >
              {landingCta.buttonLabel}
            </a>
          )}
          <button
            onClick={() => setCtaDismissed(true)}
            aria-label="Fermer le bandeau"
            className="absolute right-4 shrink-0 text-white/70 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

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
            <a href="/store/guide" className="hover:text-neutral-100">Guide de déploiement</a>
            <a href="#support" className="hover:text-neutral-100">Support</a>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <a href="#tarifs" className="btn-primary px-4 py-2">Acheter</a>
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
              <a
                href="#tarifs"
                className="btn-primary px-6 py-3 text-sm shadow-lg shadow-blue-950/40"
              >
                {heroPlan && pricing
                  ? `Acheter maintenant — à partir de ${formatAmount(pricing.plans[heroPlan].amountCents, pricing.currency)}${PLAN_SUFFIX[heroPlan]}`
                  : "Voir les tarifs"}
              </a>
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
                  <Row text="Certificat homelab.exemple.fr" value="87 jours restants" />
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
        <FeatureSlider features={FEATURES} />

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

      {/* Directory of customer instances that opted in */}
      {directoryEntries.length > 0 && (
        <section id="annuaire" className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-14 text-center">
            <span className="font-mono text-xs uppercase tracking-wider text-blue-400">Annuaire</span>
            <h2 className="mt-3 text-3xl font-semibold">Des services hébergés par nos clients</h2>
            <p className="mx-auto mt-3 max-w-xl text-neutral-400">
              Chaque instance choisit elle-même ce qu&apos;elle publie ici — validé au cas par cas avant mise en
              ligne.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {directoryEntries.map((entry) => (
              <a
                key={entry.id}
                href={entry.serviceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950 shadow-xl shadow-black/20 transition-transform hover:-translate-y-0.5"
              >
                {entry.screenshotDataUrl && (
                  <img src={entry.screenshotDataUrl} alt="" className="h-36 w-full border-b border-neutral-800 object-cover object-top" />
                )}
                <div className="flex items-center gap-3.5 p-5">
                  {entry.faviconDataUrl ? (
                    <img src={entry.faviconDataUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600/20 text-base font-semibold text-blue-300">
                      {entry.serviceName.charAt(0).toUpperCase() || "?"}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-100">{entry.serviceName}</p>
                    <p className="truncate text-xs text-neutral-500">{entry.ownerName}</p>
                    {entry.description && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-400">{entry.description}</p>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Pricing */}
      <section id="tarifs" className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="font-mono text-xs uppercase tracking-wider text-blue-400">Tarifs</span>
        <h2 className="mt-3 text-3xl font-semibold">Choisis la formule qui te convient</h2>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mx-auto mt-6 flex max-w-xs items-center gap-2">
          <input
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
            placeholder="Code promo"
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
          />
          <button
            onClick={applyPromo}
            disabled={promoValidating || !promoInput.trim()}
            className="btn-secondary shrink-0 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {promoValidating ? "..." : "Appliquer"}
          </button>
        </div>
        {promoError && <p className="mt-1.5 text-xs text-red-400">{promoError}</p>}
        {appliedPromo && !promoError && <p className="mt-1.5 text-xs text-emerald-400">Code {appliedPromo} appliqué.</p>}

        {pricing && enabledPlans.length > 0 ? (
          <div className={`mx-auto mt-10 grid gap-6 ${enabledPlans.length === 1 ? "max-w-sm" : enabledPlans.length === 2 ? "max-w-2xl sm:grid-cols-2" : "max-w-4xl sm:grid-cols-3"}`}>
            {enabledPlans.map((k) => (
              <div key={k} className="flex h-full flex-col rounded-2xl border border-neutral-700 bg-gradient-to-b from-neutral-900 to-neutral-950 p-8">
                <h3 className="text-base font-semibold">{pricing.productName} — {PLAN_TITLES[k]}</h3>
                <p className="mt-2 min-h-[2.5rem] text-sm text-neutral-400">
                  {k === "lifetime" ? pricing.productDescription : " "}
                </p>
                <p className="mt-4 font-display text-4xl font-semibold">
                  {promoDiscounts[k] ? (
                    <>
                      <span className="mr-2 text-lg text-neutral-600 line-through">
                        {formatAmount(pricing.plans[k].amountCents, pricing.currency)}
                      </span>
                      {promoDiscounts[k]}
                    </>
                  ) : (
                    formatAmount(pricing.plans[k].amountCents, pricing.currency)
                  )}
                  <span className="text-lg text-neutral-500">{PLAN_SUFFIX[k]}</span>
                </p>
                <p className="mt-2 font-mono text-xs uppercase tracking-wider text-neutral-500">{PLAN_NOTE[k]}</p>
                <button
                  onClick={() => buy(k)}
                  disabled={loading !== null}
                  className="btn-primary mt-8 w-full py-3.5 text-sm disabled:opacity-50"
                >
                  {loading === k ? "Redirection..." : "Choisir cette offre"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-8 text-sm text-neutral-500">Tarif indisponible pour le moment.</p>
        )}
        <p className="mt-8 text-xs text-neutral-600">Lien de téléchargement envoyé par email après paiement.</p>

        {keyRecovery?.enabled && (
          <div className="mx-auto mt-14 max-w-md rounded-xl border border-neutral-800 bg-neutral-900/60 p-6 text-left">
            <h3 className="text-sm font-semibold text-neutral-100">Licence lifetime perdue ?</h3>
            <p className="mt-1.5 text-sm text-neutral-400">
              Retrouve ta clé d&apos;activation moyennant {formatAmount(keyRecovery.amountCents, pricing?.currency ?? "eur")} —
              renseignée à l&apos;email utilisé pour ton achat initial.
            </p>
            <form onSubmit={submitRecovery} className="mt-4 flex flex-wrap gap-2">
              <input
                type="email"
                required
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                placeholder="ton@email.fr"
                className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
              />
              <button
                type="submit"
                disabled={recoveryLoading}
                className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
              >
                {recoveryLoading ? "Redirection..." : "Payer et recevoir ma clé"}
              </button>
            </form>
            {recoveryError && <p className="mt-2 text-xs text-red-400">{recoveryError}</p>}
          </div>
        )}
      </section>

      {/* Support */}
      <section id="support" className="border-t border-neutral-800 bg-neutral-900/40 py-24">
        <div className="mx-auto max-w-xl px-6">
          <div className="mb-10 text-center">
            <span className="font-mono text-xs uppercase tracking-wider text-blue-400">Assistance</span>
            <h2 className="mt-3 text-3xl font-semibold">Une question, un souci ?</h2>
            <p className="mt-3 text-neutral-400">
              Ouvre un ticket, tu recevras un email avec un lien pour suivre et compléter la conversation. Pour un
              problème de mise en place, jette d&apos;abord un œil au{" "}
              <a href="/store/guide" className="text-blue-400 hover:underline">guide de déploiement</a>.
            </p>
          </div>

          {ticketLink ? (
            <div className="rounded-xl border border-emerald-900 bg-emerald-950/20 p-6 text-center">
              <p className="text-sm text-emerald-300">
                Ticket créé — un email de confirmation vient de partir avec ce même lien.
              </p>
              <a href={ticketLink} className="btn-primary mt-4 inline-block px-5 py-2 text-sm">
                Voir mon ticket
              </a>
            </div>
          ) : (
            <form onSubmit={submitTicket} className="card space-y-3 p-6">
              <input
                type="email"
                required
                value={ticketEmail}
                onChange={(e) => setTicketEmail(e.target.value)}
                placeholder="ton@email.fr"
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
              />
              <input
                required
                value={ticketSubject}
                onChange={(e) => setTicketSubject(e.target.value)}
                placeholder="Sujet"
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
              />
              <textarea
                required
                rows={4}
                value={ticketMessage}
                onChange={(e) => setTicketMessage(e.target.value)}
                placeholder="Décris ton problème..."
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
              />
              {ticketError && <p className="text-sm text-red-400">{ticketError}</p>}
              <button type="submit" disabled={ticketSending} className="btn-primary w-full py-2.5 text-sm disabled:opacity-50">
                {ticketSending ? "Envoi..." : "Envoyer le ticket"}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* CTA band */}
      <section className="border-t border-neutral-800 py-20 text-center">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="text-3xl font-semibold">Prêt à reprendre le contrôle de ton homelab ?</h2>
          <p className="mt-3 text-neutral-400">
            Un seul panel pour la sécurité, les sauvegardes et l&apos;administration de toute ton infra.
          </p>
          <a href="#tarifs" className="btn-primary mt-7 inline-block px-7 py-3.5 text-sm">
            Voir les tarifs
          </a>
        </div>
      </section>

      <footer className="border-t border-neutral-800 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 text-sm text-neutral-500 sm:flex-row">
          <div className="flex items-center gap-2">
            {LOGOMARK}
            <span>Homelab Panel</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="/store/guide" className="hover:text-neutral-300">Guide de déploiement</a>
            <a href="#support" className="hover:text-neutral-300">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureSlider({ features }: { features: typeof FEATURES }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  function scrollToIndex(i: number) {
    const track = trackRef.current;
    const wrapped = (i + features.length) % features.length;
    const card = track?.children[wrapped] as HTMLElement | undefined;
    if (track && card) track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
    setIndex(wrapped);
  }

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setIndex((i) => {
        const next = (i + 1) % features.length;
        scrollToIndex(next);
        return next;
      });
    }, 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, features.length]);

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        ref={trackRef}
        className="flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-2"
        style={{ scrollbarWidth: "none" }}
      >
        {features.map((f) => (
          <div
            key={f.title}
            className="w-[82%] shrink-0 snap-center rounded-xl border border-neutral-800 bg-neutral-950 p-8 sm:w-[46%] lg:w-[31.5%]"
          >
            <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-800 text-blue-400">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                {f.icon}
              </svg>
            </div>
            <h3 className="text-base font-semibold">{f.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-neutral-400">{f.text}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-center gap-4">
        <button
          onClick={() => scrollToIndex(index - 1)}
          aria-label="Fonctionnalité précédente"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-800 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
        >
          ‹
        </button>
        <div className="flex gap-1.5">
          {features.map((f, i) => (
            <button
              key={f.title}
              onClick={() => scrollToIndex(i)}
              aria-label={`Aller à la diapositive ${i + 1}`}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${i === index ? "bg-blue-400" : "bg-neutral-700 hover:bg-neutral-600"}`}
            />
          ))}
        </div>
        <button
          onClick={() => scrollToIndex(index + 1)}
          aria-label="Fonctionnalité suivante"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-800 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
        >
          ›
        </button>
      </div>
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
