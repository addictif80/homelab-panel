"use client";

import { useEffect, useState } from "react";
import ReleasesPanel from "@/components/ReleasesPanel";
import SupportTicketsPanel from "@/components/SupportTicketsPanel";

type PlanKey = "lifetime" | "monthly" | "annual";
const PLAN_KEYS: PlanKey[] = ["lifetime", "monthly", "annual"];
const PLAN_LABELS: Record<PlanKey, string> = { lifetime: "Achat unique (lifetime)", monthly: "Abonnement mensuel", annual: "Abonnement annuel" };

type PlanPricing = { enabled: boolean; amountCents: number };
type Pricing = {
  currency: string;
  productName: string;
  productDescription: string;
  plans: Record<PlanKey, PlanPricing>;
};

type Sale = {
  id: string;
  customerEmail: string;
  amountCents: number;
  currency: string;
  productType: PlanKey;
  subscriptionStatus: "active" | "past_due" | "canceled" | null;
  currentPeriodEnd: string | null;
  createdAt: string;
};
type LicenseKeyRow = {
  key: string;
  saleId: string;
  createdAt: string;
  usedAt: string | null;
  usedByInfo: string | null;
  amountCents: number;
  saleNotes: string | null;
  customerEmail: string;
};
type KeyRecoveryOrder = { id: string; email: string; amountCents: number; currency: string; saleId: string | null; createdAt: string };

type PromoCode = {
  id: string;
  code: string;
  discountType: "percent" | "amount";
  discountValue: number;
  applicablePlans: PlanKey[];
  maxRedemptions: number | null;
  validFrom: string | null;
  validUntil: string | null;
  enabled: boolean;
  timesRedeemed: number | null;
};

const INPUT_CLASS = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100";

function centsToAmountStr(cents: number): string {
  return (cents / 100).toFixed(2);
}

function monthKey(iso: string): string {
  return `${iso}Z`.slice(0, 7);
}

function quarterOf(monthNum: number): number {
  return Math.floor((monthNum - 1) / 3) + 1;
}

export default function SellerPage() {
  const [hasSecretKey, setHasSecretKey] = useState(false);
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [pricing, setPricing] = useState<Pricing | null>(null);

  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [planAmounts, setPlanAmounts] = useState<Record<PlanKey, string>>({ lifetime: "29.00", monthly: "5.00", annual: "49.00" });
  const [planEnabled, setPlanEnabled] = useState<Record<PlanKey, boolean>>({ lifetime: true, monthly: false, annual: false });
  const [productName, setProductName] = useState("Homelab Panel");
  const [productDescription, setProductDescription] = useState("");
  const [trialDays, setTrialDaysInput] = useState("14");
  const [subscriptionGraceDays, setSubscriptionGraceDays] = useState("7");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [sales, setSales] = useState<Sale[] | null>(null);
  const [totalCents, setTotalCents] = useState(0);
  const [resending, setResending] = useState<string | null>(null);

  const [licenseKeys, setLicenseKeys] = useState<LicenseKeyRow[] | null>(null);
  const [keyTotals, setKeyTotals] = useState({ totalIssued: 0, totalUsed: 0 });

  const [manualEmail, setManualEmail] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualGenerating, setManualGenerating] = useState(false);
  const [manualResult, setManualResult] = useState("");

  const [promoCodes, setPromoCodes] = useState<PromoCode[] | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [promoDiscountType, setPromoDiscountType] = useState<"percent" | "amount">("percent");
  const [promoDiscountValue, setPromoDiscountValue] = useState("10");
  const [promoPlans, setPromoPlans] = useState<Record<PlanKey, boolean>>({ lifetime: true, monthly: true, annual: true });
  const [promoMaxRedemptions, setPromoMaxRedemptions] = useState("");
  const [promoValidUntil, setPromoValidUntil] = useState("");
  const [promoCreating, setPromoCreating] = useState(false);
  const [promoError, setPromoError] = useState("");

  const [keyRecoveryEnabled, setKeyRecoveryEnabled] = useState(false);
  const [keyRecoveryAmount, setKeyRecoveryAmount] = useState("9.00");
  const [recoveryOrders, setRecoveryOrders] = useState<KeyRecoveryOrder[] | null>(null);
  const [recoveryTotalCents, setRecoveryTotalCents] = useState(0);

  function loadConfig() {
    fetch("/api/seller/config")
      .then((r) => r.json())
      .then((d) => {
        setHasSecretKey(d.hasSecretKey);
        setHasWebhookSecret(d.hasWebhookSecret);
        setWebhookUrl(d.webhookUrl);
        setPublishableKey(d.publishableKey || "");
        setPublicUrl(d.publicUrl || "");
        setPricing(d.pricing);
        if (d.pricing) {
          setProductName(d.pricing.productName);
          setProductDescription(d.pricing.productDescription);
          const amounts = {} as Record<PlanKey, string>;
          const enabled = {} as Record<PlanKey, boolean>;
          for (const k of PLAN_KEYS) {
            amounts[k] = centsToAmountStr(d.pricing.plans[k]?.amountCents ?? 0);
            enabled[k] = !!d.pricing.plans[k]?.enabled;
          }
          setPlanAmounts(amounts);
          setPlanEnabled(enabled);
        }
        if (d.trialDays) setTrialDaysInput(String(d.trialDays));
        if (d.subscriptionGraceDays) setSubscriptionGraceDays(String(d.subscriptionGraceDays));
        if (d.keyRecovery) {
          setKeyRecoveryEnabled(!!d.keyRecovery.enabled);
          setKeyRecoveryAmount(centsToAmountStr(d.keyRecovery.amountCents || 0));
        }
      });
  }

  function loadRecoveryOrders() {
    fetch("/api/seller/key-recovery-orders")
      .then((r) => r.json())
      .then((d) => {
        setRecoveryOrders(d.orders);
        setRecoveryTotalCents(d.totalCents);
      });
  }

  function loadSales() {
    fetch("/api/seller/sales")
      .then((r) => r.json())
      .then((d) => {
        setSales(d.sales);
        setTotalCents(d.totalCents);
      });
  }

  function loadLicenseKeys() {
    fetch("/api/seller/license-keys")
      .then((r) => r.json())
      .then((d) => {
        setLicenseKeys(d.keys);
        setKeyTotals({ totalIssued: d.totalIssued, totalUsed: d.totalUsed });
      });
  }

  async function generateManualKey() {
    setManualGenerating(true);
    setManualResult("");
    try {
      const res = await fetch("/api/seller/manual-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: manualEmail, note: manualNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setManualResult(`Clé générée : ${data.key}${manualEmail ? " (envoyée par email)" : ""}`);
      setManualEmail("");
      setManualNote("");
      loadLicenseKeys();
    } catch (err) {
      setManualResult(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setManualGenerating(false);
    }
  }

  function loadPromoCodes() {
    fetch("/api/seller/promo-codes")
      .then((r) => r.json())
      .then((d) => setPromoCodes(d.codes));
  }

  async function createPromo() {
    setPromoCreating(true);
    setPromoError("");
    try {
      const res = await fetch("/api/seller/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: promoCode,
          discountType: promoDiscountType,
          discountValue: promoDiscountType === "amount" ? Math.round((parseFloat(promoDiscountValue) || 0) * 100) : Number(promoDiscountValue),
          applicablePlans: PLAN_KEYS.filter((k) => promoPlans[k]),
          maxRedemptions: promoMaxRedemptions ? Number(promoMaxRedemptions) : null,
          validUntil: promoValidUntil ? new Date(promoValidUntil).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPromoCode("");
      setPromoDiscountValue("10");
      setPromoMaxRedemptions("");
      setPromoValidUntil("");
      loadPromoCodes();
    } catch (err) {
      setPromoError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setPromoCreating(false);
    }
  }

  async function togglePromo(id: string, enabled: boolean) {
    await fetch(`/api/seller/promo-codes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    loadPromoCodes();
  }

  async function removePromo(id: string) {
    if (!confirm("Désactiver et supprimer ce code promo ?")) return;
    await fetch(`/api/seller/promo-codes/${id}`, { method: "DELETE" });
    loadPromoCodes();
  }

  useEffect(() => {
    loadConfig();
    loadSales();
    loadLicenseKeys();
    loadRecoveryOrders();
    loadPromoCodes();
  }, []);

  async function saveConfig() {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/seller/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secretKey: secretKey || undefined,
          publishableKey,
          webhookSecret: webhookSecret || undefined,
          publicUrl,
          currency: "eur",
          productName,
          productDescription,
          plans: Object.fromEntries(
            PLAN_KEYS.map((k) => [k, { enabled: planEnabled[k], amountCents: Math.round((parseFloat(planAmounts[k]) || 0) * 100) }])
          ),
          trialDays: Number(trialDays) || undefined,
          subscriptionGraceDays: Number(subscriptionGraceDays) || undefined,
          keyRecoveryEnabled,
          keyRecoveryAmountCents: Math.round((parseFloat(keyRecoveryAmount) || 0) * 100),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSecretKey("");
      setWebhookSecret("");
      setMessage("Configuration enregistrée et synchronisée avec Stripe.");
      loadConfig();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  async function resend(saleId: string) {
    setResending(saleId);
    try {
      const res = await fetch(`/api/seller/sales/${saleId}/resend`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } finally {
      setResending(null);
    }
  }

  const displayedWebhookUrl = publicUrl ? `${publicUrl.replace(/\/+$/, "")}/api/store/webhook` : webhookUrl;

  const monthlyTotals = new Map<string, number>();
  for (const s of sales || []) {
    const key = monthKey(s.createdAt);
    monthlyTotals.set(key, (monthlyTotals.get(key) || 0) + s.amountCents);
  }
  const months = [...monthlyTotals.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Espace vendeur</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Configuration Stripe, suivi des ventes et chiffre d&apos;affaires pour ta déclaration URSSAF. Absent de la
          version téléchargée par tes clients.
        </p>
      </div>

      <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">Configuration Stripe</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">
              Clé secrète Stripe {hasSecretKey && <span className="text-emerald-500">(déjà définie)</span>}
            </span>
            <input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="sk_live_..."
              className={INPUT_CLASS}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Clé publique Stripe (publishable key)</span>
            <input
              value={publishableKey}
              onChange={(e) => setPublishableKey(e.target.value)}
              placeholder="pk_live_..."
              className={INPUT_CLASS}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">
              Secret de signature du webhook {hasWebhookSecret && <span className="text-emerald-500">(déjà défini)</span>}
            </span>
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="whsec_..."
              className={INPUT_CLASS}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">
              URL publique du panel (domaine réel, pas l&apos;IP interne du serveur)
            </span>
            <input
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              placeholder="https://mon-panel.exemple.fr"
              className={INPUT_CLASS}
            />
          </label>
          <label className="col-span-2 block">
            <span className="mb-1 block text-xs text-neutral-400">
              URL à renseigner dans Stripe (Developers → Webhooks)
            </span>
            <input readOnly value={displayedWebhookUrl} className={`${INPUT_CLASS} text-neutral-500`} />
            {!publicUrl && (
              <p className="mt-1 text-[11px] text-amber-400">
                Renseigne l&apos;URL publique ci-dessus si cette adresse ne correspond pas à ton vrai domaine (ce
                qui arrive derrière un reverse proxy) — sinon les liens envoyés à tes clients et l&apos;URL du
                webhook seront faux.
              </p>
            )}
            <p className="mt-2 text-[11px] text-neutral-500">
              Dans Stripe, sélectionne les événements{" "}
              <code className="rounded bg-neutral-950 px-1 py-0.5 font-mono">checkout.session.completed</code>,{" "}
              <code className="rounded bg-neutral-950 px-1 py-0.5 font-mono">customer.subscription.updated</code> et{" "}
              <code className="rounded bg-neutral-950 px-1 py-0.5 font-mono">customer.subscription.deleted</code> —
              ce sont les seuls que ce panel traite (les deux derniers ne sont utiles que si tu actives un abonnement
              ci-dessous).
            </p>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Nom du produit</span>
            <input value={productName} onChange={(e) => setProductName(e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Durée d&apos;essai (jours)</span>
            <input
              type="number"
              min={1}
              value={trialDays}
              onChange={(e) => setTrialDaysInput(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="col-span-2 block">
            <span className="mb-1 block text-xs text-neutral-400">Description (affichée sur la page de vente)</span>
            <textarea
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={2}
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-neutral-300">Offres proposées</p>
          <div className="grid grid-cols-3 gap-3">
            {PLAN_KEYS.map((k) => (
              <div key={k} className="rounded border border-neutral-700 p-3">
                <label className="mb-2 flex items-center gap-2 text-sm text-neutral-200">
                  <input
                    type="checkbox"
                    checked={planEnabled[k]}
                    onChange={(e) => setPlanEnabled({ ...planEnabled, [k]: e.target.checked })}
                  />
                  {PLAN_LABELS[k]}
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-400">
                    Tarif (EUR{k !== "lifetime" ? ` / ${k === "monthly" ? "mois" : "an"}` : ""})
                  </span>
                  <input
                    value={planAmounts[k]}
                    onChange={(e) => setPlanAmounts({ ...planAmounts, [k]: e.target.value })}
                    disabled={!planEnabled[k]}
                    className={`${INPUT_CLASS} disabled:opacity-40`}
                  />
                </label>
              </div>
            ))}
          </div>
          {(planEnabled.monthly || planEnabled.annual) && (
            <label className="mt-3 block max-w-xs">
              <span className="mb-1 block text-xs text-neutral-400">
                Délai de grâce après échéance non payée (jours)
              </span>
              <input
                type="number"
                min={0}
                value={subscriptionGraceDays}
                onChange={(e) => setSubscriptionGraceDays(e.target.value)}
                className={INPUT_CLASS}
              />
              <span className="mt-1 block text-[11px] text-neutral-500">
                Passé ce délai après la date d&apos;échéance non réglée, les actions du panel vendu (SSH, Docker,
                sauvegardes, correctifs...) se désactivent automatiquement, jusqu&apos;au renouvellement.
              </span>
            </label>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={saveConfig}
            disabled={saving}
            className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
          >
            {saving ? "Enregistrement..." : "Enregistrer et synchroniser les tarifs"}
          </button>
          <a
            href="/api/seller/export-test"
            className="rounded border border-neutral-600 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            Tester l&apos;export client
          </a>
          {message && <span className="text-xs text-neutral-400">{message}</span>}
        </div>
        {pricing && (
          <p className="text-xs text-neutral-500">
            Tarifs Stripe actuels :{" "}
            {PLAN_KEYS.filter((k) => pricing.plans[k]?.enabled)
              .map((k) => `${PLAN_LABELS[k]} : ${centsToAmountStr(pricing.plans[k].amountCents)} ${pricing.currency.toUpperCase()}`)
              .join(" · ") || "aucune offre active"}
          </p>
        )}
      </section>

      <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">Chiffre d&apos;affaires (déclaration URSSAF)</h2>
          <span className="text-sm text-neutral-300">
            Total encaissé : <strong>{centsToAmountStr(totalCents)} €</strong>
          </span>
        </div>

        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Mois</th>
                <th className="px-3 py-2 font-medium">Trimestre</th>
                <th className="px-3 py-2 font-medium">CA encaissé</th>
              </tr>
            </thead>
            <tbody>
              {months.map(([month, cents]) => {
                const [, m] = month.split("-");
                return (
                  <tr key={month} className="border-t border-neutral-900">
                    <td className="px-3 py-2 text-neutral-200">{month}</td>
                    <td className="px-3 py-2 text-neutral-500">T{quarterOf(Number(m))}</td>
                    <td className="px-3 py-2 text-neutral-200">{centsToAmountStr(cents)} €</td>
                  </tr>
                );
              })}
              {months.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-neutral-600">
                    Aucune vente pour l&apos;instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h3 className="pt-2 text-xs font-medium text-neutral-400">Détail des ventes</h3>
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Montant</th>
                <th className="px-3 py-2 font-medium">Offre</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sales?.map((s) => (
                <tr key={s.id} className="border-t border-neutral-900">
                  <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                    {new Date(`${s.createdAt}Z`).toLocaleString("fr-FR")}
                  </td>
                  <td className="px-3 py-2 text-neutral-300">{s.customerEmail}</td>
                  <td className="px-3 py-2 text-neutral-200">
                    {centsToAmountStr(s.amountCents)} {s.currency.toUpperCase()}
                  </td>
                  <td className="px-3 py-2 text-neutral-400">
                    {PLAN_LABELS[s.productType] ?? s.productType}
                    {s.subscriptionStatus && (
                      <span
                        className={`ml-1.5 rounded border px-1.5 py-0 text-[10px] ${
                          s.subscriptionStatus === "active"
                            ? "border-emerald-900 bg-emerald-950/30 text-emerald-400"
                            : s.subscriptionStatus === "past_due"
                              ? "border-amber-900 bg-amber-950/30 text-amber-400"
                              : "border-neutral-700 text-neutral-500"
                        }`}
                      >
                        {s.subscriptionStatus === "active" ? "actif" : s.subscriptionStatus === "past_due" ? "impayé" : "annulé"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => resend(s.id)}
                      disabled={resending === s.id}
                      className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800 disabled:opacity-50"
                    >
                      {resending === s.id ? "Envoi..." : "Renvoyer le lien"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">Clés d&apos;activation</h2>
          <span className="text-sm text-neutral-300">
            {keyTotals.totalUsed} activée{keyTotals.totalUsed !== 1 ? "s" : ""} / {keyTotals.totalIssued} émise
            {keyTotals.totalIssued !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="text-xs text-neutral-500">
          Une clé est générée automatiquement à chaque vente et n&apos;est utilisable qu&apos;une seule fois — la
          validation se fait côté serveur (une clé déjà consommée est refusée même si elle est réessayée ailleurs).
        </p>

        <div className="flex flex-wrap items-end gap-2 rounded border border-neutral-800 p-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Générer une clé manuellement — email (optionnel)</span>
            <input
              value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value)}
              placeholder="destinataire@email.fr"
              className={`${INPUT_CLASS} w-56`}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Note (raison)</span>
            <input
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
              placeholder="ex: exemplaire presse"
              className={`${INPUT_CLASS} w-56`}
            />
          </label>
          <button
            onClick={generateManualKey}
            disabled={manualGenerating}
            className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
          >
            {manualGenerating ? "Génération..." : "Générer"}
          </button>
          {manualResult && <span className="text-xs text-neutral-400">{manualResult}</span>}
        </div>

        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Clé</th>
                <th className="px-3 py-2 font-medium">Origine</th>
                <th className="px-3 py-2 font-medium">Émise</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 font-medium">Utilisée le</th>
              </tr>
            </thead>
            <tbody>
              {licenseKeys?.map((k) => (
                <tr key={k.key} className="border-t border-neutral-900">
                  <td className="px-3 py-2 font-mono text-xs text-neutral-200">{k.key}</td>
                  <td className="px-3 py-2 text-neutral-400">
                    {k.amountCents === 0 ? (
                      <span className="rounded border border-purple-900 bg-purple-950/30 px-1.5 py-0 text-[10px] text-purple-300">
                        Manuelle{k.saleNotes ? ` — ${k.saleNotes}` : ""}
                      </span>
                    ) : (
                      "Vente"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                    {new Date(`${k.createdAt}Z`).toLocaleString("fr-FR")}
                  </td>
                  <td className="px-3 py-2">
                    {k.usedAt ? (
                      <span className="text-emerald-400">Activée</span>
                    ) : (
                      <span className="text-neutral-500">Non utilisée</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">
                    {k.usedAt ? new Date(`${k.usedAt}Z`).toLocaleString("fr-FR") : "—"}
                  </td>
                </tr>
              ))}
              {licenseKeys?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-neutral-600">
                    Aucune clé émise pour l&apos;instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">Codes promo</h2>
        <p className="text-xs text-neutral-500">
          Créé côté Stripe (coupon + code promo) — la remise est déduite automatiquement au paiement, et la limite
          d&apos;utilisations comme la date d&apos;expiration sont appliquées par Stripe lui-même, pas seulement
          affichées ici.
        </p>

        <div className="flex flex-wrap items-end gap-2 rounded border border-neutral-800 p-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Code</span>
            <input
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder="BIENVENUE10"
              className={`${INPUT_CLASS} w-40`}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Type</span>
            <select
              value={promoDiscountType}
              onChange={(e) => setPromoDiscountType(e.target.value as "percent" | "amount")}
              className={`${INPUT_CLASS} w-32`}
            >
              <option value="percent">Pourcentage</option>
              <option value="amount">Montant (EUR)</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">
              Valeur {promoDiscountType === "percent" ? "(%)" : "(EUR)"}
            </span>
            <input
              value={promoDiscountValue}
              onChange={(e) => setPromoDiscountValue(e.target.value)}
              className={`${INPUT_CLASS} w-24`}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Utilisations max</span>
            <input
              value={promoMaxRedemptions}
              onChange={(e) => setPromoMaxRedemptions(e.target.value)}
              placeholder="illimité"
              className={`${INPUT_CLASS} w-28`}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Expire le</span>
            <input
              type="date"
              value={promoValidUntil}
              onChange={(e) => setPromoValidUntil(e.target.value)}
              className={`${INPUT_CLASS} w-40`}
            />
          </label>
          <div className="flex gap-2">
            {PLAN_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-1 text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={promoPlans[k]}
                  onChange={(e) => setPromoPlans({ ...promoPlans, [k]: e.target.checked })}
                />
                {PLAN_LABELS[k]}
              </label>
            ))}
          </div>
          <button
            onClick={createPromo}
            disabled={promoCreating || !promoCode}
            className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
          >
            {promoCreating ? "Création..." : "Créer"}
          </button>
        </div>
        {promoError && <p className="text-sm text-red-400">{promoError}</p>}

        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Remise</th>
                <th className="px-3 py-2 font-medium">Offres</th>
                <th className="px-3 py-2 font-medium">Utilisations</th>
                <th className="px-3 py-2 font-medium">Expire</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {promoCodes?.map((p) => (
                <tr key={p.id} className="border-t border-neutral-900">
                  <td className="px-3 py-2 font-mono text-xs text-neutral-200">{p.code}</td>
                  <td className="px-3 py-2 text-neutral-300">
                    {p.discountType === "percent" ? `${p.discountValue}%` : `${centsToAmountStr(p.discountValue)} €`}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{p.applicablePlans.map((k) => PLAN_LABELS[k]?.split(" ")[0]).join(", ")}</td>
                  <td className="px-3 py-2 text-neutral-400">
                    {p.timesRedeemed ?? "?"} / {p.maxRedemptions ?? "∞"}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">
                    {p.validUntil ? new Date(p.validUntil).toLocaleDateString("fr-FR") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded border px-1.5 py-0 text-[10px] ${
                        p.enabled
                          ? "border-emerald-900 bg-emerald-950/30 text-emerald-400"
                          : "border-neutral-700 text-neutral-500"
                      }`}
                    >
                      {p.enabled ? "actif" : "inactif"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => togglePromo(p.id, !p.enabled)}
                        className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                      >
                        {p.enabled ? "Désactiver" : "Activer"}
                      </button>
                      <button
                        onClick={() => removePromo(p.id)}
                        className="rounded border border-red-900 px-2 py-0.5 text-xs text-red-300 hover:bg-red-950/40"
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {promoCodes?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-neutral-600">
                    Aucun code promo pour l&apos;instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">Récupération de clé de licence (payante)</h2>
          <span className="text-sm text-neutral-300">
            Total encaissé : <strong>{centsToAmountStr(recoveryTotalCents)} €</strong>
          </span>
        </div>
        <p className="text-xs text-neutral-500">
          Permet à un client ayant acheté une licence lifetime mais ayant perdu sa clé de la retrouver moyennant un
          paiement — visible sur la page de vente uniquement s&apos;il existe un achat lifetime pour l&apos;email
          renseigné.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-neutral-200">
            <input type="checkbox" checked={keyRecoveryEnabled} onChange={(e) => setKeyRecoveryEnabled(e.target.checked)} />
            Activer
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Tarif (EUR)</span>
            <input
              value={keyRecoveryAmount}
              onChange={(e) => setKeyRecoveryAmount(e.target.value)}
              disabled={!keyRecoveryEnabled}
              className={`${INPUT_CLASS} w-32 disabled:opacity-40`}
            />
          </label>
          <button
            onClick={saveConfig}
            disabled={saving}
            className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
          >
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Montant</th>
              </tr>
            </thead>
            <tbody>
              {recoveryOrders?.map((o) => (
                <tr key={o.id} className="border-t border-neutral-900">
                  <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                    {new Date(`${o.createdAt}Z`).toLocaleString("fr-FR")}
                  </td>
                  <td className="px-3 py-2 text-neutral-300">{o.email}</td>
                  <td className="px-3 py-2 text-neutral-200">
                    {centsToAmountStr(o.amountCents)} {o.currency.toUpperCase()}
                  </td>
                </tr>
              ))}
              {recoveryOrders?.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-neutral-600">
                    Aucune récupération de clé pour l&apos;instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <SupportTicketsPanel />

      <ReleasesPanel />
    </div>
  );
}
