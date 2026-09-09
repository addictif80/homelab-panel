"use client";

import { useEffect, useState } from "react";

type Pricing = {
  amountCents: number;
  currency: string;
  productName: string;
  productDescription: string;
};

type Sale = { id: string; customerEmail: string; amountCents: number; currency: string; createdAt: string };

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
  const [webhookSecret, setWebhookSecret] = useState("");
  const [amount, setAmount] = useState("29.00");
  const [productName, setProductName] = useState("Homelab Panel");
  const [productDescription, setProductDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [sales, setSales] = useState<Sale[] | null>(null);
  const [totalCents, setTotalCents] = useState(0);
  const [resending, setResending] = useState<string | null>(null);

  function loadConfig() {
    fetch("/api/seller/config")
      .then((r) => r.json())
      .then((d) => {
        setHasSecretKey(d.hasSecretKey);
        setHasWebhookSecret(d.hasWebhookSecret);
        setWebhookUrl(d.webhookUrl);
        setPricing(d.pricing);
        if (d.pricing) {
          setAmount(centsToAmountStr(d.pricing.amountCents));
          setProductName(d.pricing.productName);
          setProductDescription(d.pricing.productDescription);
        }
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

  useEffect(() => {
    loadConfig();
    loadSales();
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
          webhookSecret: webhookSecret || undefined,
          amountCents: Math.round(parseFloat(amount) * 100),
          currency: "eur",
          productName,
          productDescription,
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
          <label className="col-span-2 block">
            <span className="mb-1 block text-xs text-neutral-400">
              URL à renseigner dans Stripe (Developers → Webhooks)
            </span>
            <input readOnly value={webhookUrl} className={`${INPUT_CLASS} text-neutral-500`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Nom du produit</span>
            <input value={productName} onChange={(e) => setProductName(e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Tarif (EUR)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} className={INPUT_CLASS} />
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
        <div className="flex items-center gap-3">
          <button
            onClick={saveConfig}
            disabled={saving}
            className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
          >
            {saving ? "Enregistrement..." : "Enregistrer et synchroniser le tarif"}
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
            Tarif Stripe actuel : {centsToAmountStr(pricing.amountCents)} {pricing.currency.toUpperCase()}
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

        <div className="overflow-hidden rounded border border-neutral-800">
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
        <div className="overflow-hidden rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Montant</th>
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
    </div>
  );
}
