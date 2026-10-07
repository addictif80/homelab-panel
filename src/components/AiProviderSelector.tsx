"use client";

import { useEffect, useState } from "react";

type Provider = "ollama" | "1min";

export default function AiProviderSelector() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/ai-provider")
      .then((r) => r.json())
      .then((data) => setProvider(data.provider ?? "ollama"));
  }, []);

  async function change(next: Provider) {
    setProvider(next);
    setSaving(true);
    try {
      await fetch("/api/settings/ai-provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: next }),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!provider) return null;

  return (
    <div className="flex items-center justify-between card px-4 py-2.5">
      <span className="text-sm text-neutral-300">Fournisseur actif pour l&apos;assistant IA</span>
      <select
        value={provider}
        onChange={(e) => change(e.target.value as Provider)}
        disabled={saving}
        className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 disabled:opacity-50"
      >
        <option value="ollama">Ollama (auto-hébergé)</option>
        <option value="1min">1min.ai (cloud)</option>
      </select>
    </div>
  );
}
