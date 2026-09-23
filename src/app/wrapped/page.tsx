"use client";

import { useEffect, useState } from "react";

type Card = { id: string; kicker: string; value: string; subtitle: string; color: string };

export default function WrappedPage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    fetch("/api/wrapped")
      .then((r) => r.json())
      .then((d) => setCards(d.cards ?? []));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!cards) return;
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, cards.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cards]);

  if (!cards) {
    return <p className="text-sm text-neutral-500">Génération du récap...</p>;
  }

  const card = cards[index];

  return (
    <div className="flex flex-col items-center gap-5 py-6">
      <div>
        <h1 className="text-center text-2xl font-semibold text-neutral-100">Ton année en homelab</h1>
        <p className="text-center text-sm text-neutral-500">Construit uniquement à partir de ce que le panel a réellement enregistré.</p>
      </div>

      <div
        className={`flex aspect-[9/14] w-full max-w-sm flex-col items-center justify-center gap-4 rounded-2xl bg-gradient-to-br p-8 text-center shadow-2xl ${card.color}`}
      >
        <p className="text-sm font-medium uppercase tracking-wide text-white/80">{card.kicker}</p>
        <p className="text-5xl font-bold text-white">{card.value}</p>
        <p className="text-sm text-white/90">{card.subtitle}</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
          disabled={index === 0}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-30"
        >
          ← Précédent
        </button>
        <span className="text-xs text-neutral-500">
          {index + 1} / {cards.length}
        </span>
        <button
          onClick={() => setIndex((i) => Math.min(i + 1, cards.length - 1))}
          disabled={index === cards.length - 1}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-30"
        >
          Suivant →
        </button>
      </div>

      <div className="flex gap-1.5">
        {cards.map((c, i) => (
          <button
            key={c.id}
            onClick={() => setIndex(i)}
            aria-label={`Aller à la carte ${i + 1}`}
            className={`h-1.5 w-6 rounded-full transition-colors ${i === index ? "bg-neutral-200" : "bg-neutral-800"}`}
          />
        ))}
      </div>
    </div>
  );
}
