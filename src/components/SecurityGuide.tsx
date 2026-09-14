"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { streamOllamaChat } from "@/lib/ollamaClient";

type Severity = "critical" | "warning" | "info" | "good";

type Finding = {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  detail: string;
  fixId?: string;
  fixLabel?: string;
  fixWarning?: string;
  fixParams?: Record<string, string>;
  howTo?: string[];
  ignored?: boolean;
};

type HostScanResult = {
  hostId: number;
  hostName: string;
  hostKind: string;
  hostOs: string | null;
  findings: Finding[];
  error?: string;
};

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info", "good"];

type Bubble = {
  id: string;
  from: "guide" | "result" | "ai";
  kind?: "success" | "error" | "info";
  text: string;
  code?: string[];
};

type StepPhase = "idle" | "working" | "resolved" | "failed" | "skipped";

let bubbleSeq = 0;
function nextBubbleId(): string {
  bubbleSeq += 1;
  return `b${bubbleSeq}`;
}

export default function SecurityGuide({
  host,
  onClose,
  onHostUpdated,
}: {
  host: HostScanResult;
  onClose: () => void;
  onHostUpdated: (updated: HostScanResult) => void;
}) {
  const steps = useMemo(
    () =>
      host.findings
        .filter((f) => !f.ignored)
        .slice()
        .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)),
    // Snapshot taken once, when the guide opens for this host — re-sorting mid-walkthrough as
    // findings get fixed would reshuffle steps under the user's feet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [host.hostId]
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<StepPhase>("idle");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [showHowTo, setShowHowTo] = useState(false);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, "resolved" | "failed" | "skipped">>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const finding = steps[stepIndex];

  useEffect(() => {
    fetch("/api/settings/ollama")
      .then((r) => r.json())
      .then((data) => setAiConfigured(Boolean(data.config?.baseUrl && data.config?.model)))
      .catch(() => setAiConfigured(false));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [bubbles]);

  useEffect(() => {
    if (!finding) return;
    setShowHowTo(!finding.fixId);
    addBubble({
      from: "guide",
      text: `Pour le problème « ${finding.title} » sur ${host.hostName}, voici ce qu'il faut faire :\n\n${finding.detail}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  function addBubble(b: Omit<Bubble, "id">) {
    setBubbles((prev) => [...prev, { ...b, id: nextBubbleId() }]);
  }

  async function applyAutoFix() {
    if (!finding?.fixId) return;
    setPhase("working");
    try {
      const res = await fetch(`/api/security/hosts/${host.hostId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixId: finding.fixId, params: finding.fixParams }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec du correctif.");
      onHostUpdated(data.rescan);
      const stillPresent = (data.rescan as HostScanResult).findings.some(
        (f) => f.id === finding.id && !f.ignored
      );
      if (stillPresent) {
        addBubble({
          from: "result",
          kind: "error",
          text: `${data.result.message}\n\nMais le problème est toujours détecté après vérification. On peut essayer autre chose.`,
        });
        setPhase("failed");
      } else {
        addBubble({ from: "result", kind: "success", text: `✅ ${data.result.message} Problème résolu.` });
        markOutcome("resolved");
        setPhase("resolved");
      }
    } catch (err) {
      addBubble({
        from: "result",
        kind: "error",
        text: `❌ ${err instanceof Error ? err.message : "Erreur inconnue."}`,
      });
      setPhase("failed");
    }
  }

  async function verifyManualFix() {
    if (!finding) return;
    setPhase("working");
    try {
      const res = await fetch(`/api/security/hosts/${host.hostId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: finding.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec de la vérification.");
      onHostUpdated(data.rescan);
      if (data.resolved) {
        addBubble({ from: "result", kind: "success", text: "✅ Vérifié : le problème n'est plus détecté." });
        markOutcome("resolved");
        setPhase("resolved");
      } else {
        addBubble({
          from: "result",
          kind: "error",
          text: "Le problème est toujours détecté après vérification. Vérifie les commandes ci-dessus, ou essaie autre chose.",
        });
        setPhase("failed");
      }
    } catch (err) {
      addBubble({
        from: "result",
        kind: "error",
        text: `❌ ${err instanceof Error ? err.message : "Erreur inconnue."}`,
      });
      setPhase("failed");
    }
  }

  async function askAi() {
    if (!finding) return;
    setAiLoading(true);
    const context = [
      `Machine : ${host.hostName} (${host.hostKind}${host.hostOs ? `, ${host.hostOs}` : ""}).`,
      `Problème détecté : ${finding.title}`,
      `Détail : ${finding.detail}`,
      finding.howTo?.length ? `Instructions déjà proposées :\n${finding.howTo.join("\n")}` : "",
      phase === "failed" ? "La solution déjà tentée n'a pas résolu le problème, propose une alternative." : "",
    ]
      .filter(Boolean)
      .join("\n");

    const question = "Comment résoudre ce problème étape par étape, avec les commandes exactes à lancer ?";
    const bubbleId = nextBubbleId();
    setBubbles((prev) => [...prev, { id: bubbleId, from: "ai", text: "" }]);

    try {
      await streamOllamaChat([{ role: "user", content: question }], context, (token) => {
        setBubbles((prev) => prev.map((b) => (b.id === bubbleId ? { ...b, text: b.text + token } : b)));
      });
    } catch (err) {
      setBubbles((prev) =>
        prev.map((b) =>
          b.id === bubbleId
            ? { ...b, kind: "error", text: err instanceof Error ? err.message : "Erreur de l'assistant IA." }
            : b
        )
      );
    } finally {
      setAiLoading(false);
    }
  }

  function markOutcome(status: "resolved" | "failed" | "skipped") {
    if (!finding) return;
    setOutcomes((prev) => ({ ...prev, [finding.id]: status }));
  }

  function skip() {
    markOutcome("skipped");
    addBubble({ from: "result", kind: "info", text: "Problème passé pour cette session (pas ignoré définitivement)." });
    setPhase("skipped");
  }

  function next() {
    setStepIndex((i) => i + 1);
    setPhase("idle");
  }

  const finished = steps.length === 0 || stepIndex >= steps.length;
  const resolvedCount = Object.values(outcomes).filter((o) => o === "resolved").length;
  const skippedOrFailedCount = Object.values(outcomes).filter((o) => o !== "resolved").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[85vh] w-full max-w-2xl flex-col rounded border border-neutral-700 bg-neutral-950">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">Guide de résolution — {host.hostName}</h2>
            <p className="text-xs text-neutral-500">
              {finished ? "Terminé" : `Problème ${stepIndex + 1} sur ${steps.length}`}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
            ✕
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {bubbles.map((b) => (
            <div
              key={b.id}
              className={`max-w-[90%] rounded border p-3 text-sm whitespace-pre-wrap ${
                b.from === "guide"
                  ? "border-neutral-700 bg-neutral-900 text-neutral-200"
                  : b.from === "ai"
                    ? "ml-auto border-purple-900 bg-purple-950/30 text-purple-100"
                    : b.kind === "success"
                      ? "border-emerald-900 bg-emerald-950/30 text-emerald-300"
                      : b.kind === "error"
                        ? "border-red-900 bg-red-950/30 text-red-300"
                        : "border-neutral-700 bg-neutral-900 text-neutral-300"
              }`}
            >
              {b.from === "ai" && <div className="mb-1 text-[10px] uppercase tracking-wide text-purple-400">Assistant IA</div>}
              {b.text || (b.from === "ai" ? "…" : "")}
            </div>
          ))}

          {!finished && finding?.howTo && finding.howTo.length > 0 && showHowTo && (
            <pre className="overflow-x-auto rounded border border-neutral-800 bg-black p-3 text-[11px] text-neutral-300">
              {finding.howTo.join("\n")}
            </pre>
          )}

          {!finished && finding?.fixWarning && phase === "idle" && (
            <p className="rounded border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-300">
              ⚠ {finding.fixWarning}
            </p>
          )}

          {finished && (
            <div className="rounded border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-200">
              {steps.length === 0
                ? "Aucun problème actif à résoudre sur cette machine."
                : `Parcours terminé : ${resolvedCount} problème${resolvedCount > 1 ? "s" : ""} résolu${resolvedCount > 1 ? "s" : ""}${
                    skippedOrFailedCount > 0
                      ? `, ${skippedOrFailedCount} restant${skippedOrFailedCount > 1 ? "s" : ""} (passé${skippedOrFailedCount > 1 ? "s" : ""} ou toujours en échec)`
                      : ""
                  }.`}
            </div>
          )}
        </div>

        {!finished && (
          <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 p-3">
            {phase === "idle" && finding?.fixId && (
              <button
                onClick={applyAutoFix}
                className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-900/60"
              >
                {finding.fixLabel || "Corriger automatiquement"}
              </button>
            )}
            {phase === "idle" && finding?.fixId && (
              <button
                onClick={() => setShowHowTo((s) => !s)}
                className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                {showHowTo ? "Masquer les instructions manuelles" : "Voir les instructions manuelles"}
              </button>
            )}
            {(phase === "idle" || phase === "failed") && !finding?.fixId && (
              <button
                onClick={verifyManualFix}
                className="rounded border border-blue-700 bg-blue-900/40 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-900/60"
              >
                J&apos;ai fait ça, vérifier
              </button>
            )}
            {phase === "failed" && finding?.fixId && (
              <button
                onClick={applyAutoFix}
                className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Réessayer
              </button>
            )}
            {phase === "working" && <span className="text-xs text-neutral-500">Vérification en cours (SSH)...</span>}

            {aiConfigured && (phase === "idle" || phase === "failed") && (
              <button
                onClick={askAi}
                disabled={aiLoading}
                className="rounded border border-purple-800 bg-purple-950/40 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-950/70 disabled:opacity-50"
              >
                {aiLoading ? "L'IA réfléchit..." : "Demander à l'IA"}
              </button>
            )}
            {aiConfigured === false && (
              <span className="text-[11px] text-neutral-600">
                Assistant IA non configuré (section Assistant IA (Ollama) plus bas).
              </span>
            )}

            {(phase === "idle" || phase === "failed") && (
              <button onClick={skip} className="ml-auto text-xs text-neutral-500 hover:text-neutral-300">
                Passer ce problème
              </button>
            )}
            {(phase === "resolved" || phase === "skipped") && (
              <button
                onClick={next}
                className="ml-auto rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-900/60"
              >
                Suivant →
              </button>
            )}
          </div>
        )}

        {finished && (
          <div className="flex justify-end border-t border-neutral-800 p-3">
            <button
              onClick={onClose}
              className="rounded border border-neutral-600 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
            >
              Fermer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
