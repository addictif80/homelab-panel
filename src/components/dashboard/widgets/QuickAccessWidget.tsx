"use client";

import { useEffect, useState } from "react";
import { CHIP_COLORS } from "../shared";
import { NAV_SECTIONS, NavIcon, type IconName } from "@/components/Sidebar";

type QuickAccessItem = { label: string; href: string; icon: IconName };

const COLOR_CYCLE: (keyof typeof CHIP_COLORS)[] = ["accent", "success", "accent2", "warning"];

const DEFAULT_ITEMS: QuickAccessItem[] = [
  { label: "Serveurs physiques", href: "/servers", icon: "server-rack" },
  { label: "Serveurs VM", href: "/proxmox", icon: "vm" },
  { label: "Docker", href: "/docker", icon: "docker" },
  { label: "Terminal SSH", href: "/ssh", icon: "terminal" },
  { label: "Mises à jour", href: "/updates", icon: "clock" },
  { label: "Explorateur de fichiers", href: "/files", icon: "files" },
  { label: "Tailscale", href: "/tailscale", icon: "tailscale" },
  { label: "Inventaire & topologie", href: "/inventory", icon: "topology" },
];

// Every page the sidebar itself can link to, flattened — the picker below offers exactly this set
// so a shortcut always points somewhere real, without hand-maintaining a second list.
const AVAILABLE = NAV_SECTIONS.flatMap((s) => s.items);

export function QuickAccessWidget() {
  const [items, setItems] = useState<QuickAccessItem[]>(DEFAULT_ITEMS);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    fetch("/api/dashboard/quick-access")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.items) && d.items.length > 0) setItems(d.items);
      })
      .finally(() => setLoaded(true));
  }, []);

  function persist(next: QuickAccessItem[]) {
    setItems(next);
    fetch("/api/dashboard/quick-access", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: next }),
    }).catch(() => {});
  }

  function updateHref(i: number, href: string) {
    const found = AVAILABLE.find((n) => n.href === href);
    if (!found) return;
    persist(items.map((it, idx) => (idx === i ? { label: found.label, href: found.href, icon: found.icon } : it)));
  }

  function removeItem(i: number) {
    persist(items.filter((_, idx) => idx !== i));
  }

  function moveItem(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  }

  function addItem() {
    const used = new Set(items.map((it) => it.href));
    const next = AVAILABLE.find((n) => !used.has(n.href));
    if (!next) return;
    persist([...items, { label: next.label, href: next.href, icon: next.icon }]);
  }

  if (!loaded) return <div className="h-24" />;

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-end gap-3">
        {editing && (
          <button onClick={() => persist(DEFAULT_ITEMS)} className="text-xs text-neutral-500 hover:text-neutral-300">
            Réinitialiser
          </button>
        )}
        <button onClick={() => setEditing((v) => !v)} className="text-xs font-medium text-neutral-400 hover:text-neutral-200">
          {editing ? "Terminé" : "Modifier"}
        </button>
      </div>

      {editing ? (
        <div className="space-y-1.5">
          {items.map((item, i) => (
            <div key={`${item.href}-${i}`} className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950 p-1.5">
              <span
                className="icon-chip h-7 w-7 shrink-0"
                style={{ background: CHIP_COLORS[COLOR_CYCLE[i % COLOR_CYCLE.length]].bg, color: CHIP_COLORS[COLOR_CYCLE[i % COLOR_CYCLE.length]].fg }}
              >
                <NavIcon name={item.icon} />
              </span>
              <select
                value={item.href}
                onChange={(e) => updateHref(i, e.target.value)}
                className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 text-xs text-neutral-100"
              >
                {AVAILABLE.map((n) => (
                  <option key={n.href} value={n.href}>
                    {n.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => moveItem(i, -1)}
                disabled={i === 0}
                className="rounded px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
                title="Monter"
              >
                ↑
              </button>
              <button
                onClick={() => moveItem(i, 1)}
                disabled={i === items.length - 1}
                className="rounded px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
                title="Descendre"
              >
                ↓
              </button>
              <button
                onClick={() => removeItem(i)}
                className="rounded px-1.5 py-1 text-xs text-red-400 hover:bg-red-950/40"
                title="Retirer"
              >
                ✕
              </button>
            </div>
          ))}
          {items.length < AVAILABLE.length && (
            <button
              onClick={addItem}
              className="w-full rounded-lg border border-dashed border-neutral-700 py-2 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
            >
              + Ajouter un raccourci
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 @sm:grid-cols-4">
          {items.map((m, i) => (
            <a
              key={`${m.href}-${i}`}
              href={m.href}
              className="card flex flex-col gap-2.5 p-3.5 transition-transform hover:-translate-y-0.5 hover:border-neutral-700"
            >
              <span
                className="icon-chip h-8 w-8"
                style={{ background: CHIP_COLORS[COLOR_CYCLE[i % COLOR_CYCLE.length]].bg, color: CHIP_COLORS[COLOR_CYCLE[i % COLOR_CYCLE.length]].fg }}
              >
                <NavIcon name={m.icon} />
              </span>
              <span className="text-[13px] font-semibold">{m.label}</span>
            </a>
          ))}
          {items.length === 0 && (
            <p className="col-span-full text-sm text-neutral-600">
              Aucun raccourci — clique sur « Modifier » pour en ajouter.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
