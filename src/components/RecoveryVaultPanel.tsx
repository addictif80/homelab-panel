"use client";

import { useState } from "react";

export default function RecoveryVaultPanel() {
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportDone, setExportDone] = useState(false);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPassphrase, setImportPassphrase] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSummary, setImportSummary] = useState<{ table: string; rows: number }[] | null>(null);
  const [confirmingImport, setConfirmingImport] = useState(false);

  async function doExport() {
    setExporting(true);
    setExportError("");
    setExportDone(false);
    try {
      const res = await fetch("/api/settings/recovery-vault/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: exportPassphrase }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erreur.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `homelab-panel-vault-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportDone(true);
      setExportPassphrase("");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setExporting(false);
    }
  }

  async function doImport() {
    if (!importFile) return;
    setImporting(true);
    setImportError("");
    setImportSummary(null);
    try {
      const envelope = JSON.parse(await importFile.text());
      const res = await fetch("/api/settings/recovery-vault/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: importPassphrase, envelope }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur.");
      setImportSummary(data.summary);
      setImportPassphrase("");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Fichier invalide ou phrase secrète incorrecte.");
    } finally {
      setImporting(false);
      setConfirmingImport(false);
    }
  }

  return (
    <section className="space-y-4 rounded border border-neutral-800 bg-neutral-900 p-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-100">Coffre-fort de récupération hors-ligne</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Exporte un instantané chiffré (AES-256, authentifié) de toute la configuration du panel — inventaire,
          identifiants, intégrations, plans de sauvegarde — protégé par une phrase secrète de ton choix. À conserver
          hors ligne (clé USB, stockage froid) pour reconstruire le panel si le serveur qui l&apos;héberge est
          détruit. Les comptes utilisateurs et l&apos;historique (journal d&apos;audit, ventes...) ne sont pas
          inclus.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded border border-neutral-800 p-3">
          <p className="text-xs font-medium text-neutral-300">Exporter</p>
          <input
            type="password"
            value={exportPassphrase}
            onChange={(e) => setExportPassphrase(e.target.value)}
            placeholder="Phrase secrète (12 caractères min.)"
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          />
          <button
            onClick={doExport}
            disabled={exporting || exportPassphrase.length < 12}
            className="w-full rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
          >
            {exporting ? "Génération..." : "Télécharger le coffre-fort"}
          </button>
          {exportError && <p className="text-xs text-red-400">{exportError}</p>}
          {exportDone && <p className="text-xs text-emerald-400">Téléchargé — garde la phrase secrète de côté, elle n'est pas récupérable.</p>}
        </div>

        <div className="space-y-2 rounded border border-neutral-800 p-3">
          <p className="text-xs font-medium text-neutral-300">Importer (restaure et remplace la config actuelle)</p>
          <input
            type="file"
            accept="application/json"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-neutral-400"
          />
          <input
            type="password"
            value={importPassphrase}
            onChange={(e) => setImportPassphrase(e.target.value)}
            placeholder="Phrase secrète du coffre-fort"
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          />
          <button
            onClick={() => setConfirmingImport(true)}
            disabled={importing || !importFile || !importPassphrase}
            className="w-full rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
          >
            {importing ? "Restauration..." : "Restaurer"}
          </button>
          {importError && <p className="text-xs text-red-400">{importError}</p>}
          {importSummary && (
            <p className="text-xs text-emerald-400">
              Restauré : {importSummary.filter((s) => s.rows > 0).map((s) => `${s.table} (${s.rows})`).join(", ") || "rien à restaurer"}.
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-neutral-800 pt-3">
        <a
          href="/api/settings/survival-doc"
          className="inline-block rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          Générer le manuel de survie (.md)
        </a>
        <p className="mt-1 text-[11px] text-neutral-600">
          Document lisible (pas de secrets) résumant l&apos;infrastructure et la procédure de restauration, pour
          quelqu&apos;un d&apos;autre en cas d&apos;urgence.
        </p>
      </div>

      {confirmingImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded border border-neutral-700 bg-neutral-900 p-5">
            <h3 className="text-sm font-semibold text-neutral-100">Confirmer la restauration ?</h3>
            <p className="mt-2 text-sm text-neutral-300">
              Ça va remplacer l&apos;inventaire, les identifiants, les intégrations et les plans de sauvegarde
              actuels par ceux du fichier importé. Cette action n&apos;est pas réversible sans un autre export.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmingImport(false)}
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Annuler
              </button>
              <button
                onClick={doImport}
                className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60"
              >
                Confirmer la restauration
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
