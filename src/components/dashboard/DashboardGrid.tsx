"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { DEFAULT_LAYOUT, WIDGET_CATALOG, getWidgetDef, type WidgetCategory } from "@/lib/dashboardWidgets";
import { WIDGET_COMPONENTS } from "./registry";
import { WidgetFrame } from "./WidgetFrame";

const CATEGORY_ORDER: WidgetCategory[] = ["Ressources", "Sécurité", "Fiabilité", "Réseau", "Autres"];

export function DashboardGrid() {
  const [layout, setLayout] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/layout")
      .then((r) => r.json())
      .then((d) => setLayout(d.layout ?? DEFAULT_LAYOUT));
  }, []);

  const persist = useCallback((next: string[]) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      fetch("/api/dashboard/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: next }),
      });
    }, 400);
  }, []);

  function updateLayout(next: string[]) {
    setLayout(next);
    persist(next);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !layout) return;
    const oldIndex = layout.indexOf(String(active.id));
    const newIndex = layout.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    updateLayout(arrayMove(layout, oldIndex, newIndex));
  }

  function removeWidget(id: string) {
    if (!layout) return;
    updateLayout(layout.filter((w) => w !== id));
  }

  function addWidget(id: string) {
    if (!layout || layout.includes(id)) return;
    updateLayout([...layout, id]);
  }

  const available = useMemo(() => WIDGET_CATALOG.filter((w) => !layout?.includes(w.id)), [layout]);
  const availableByCategory = useMemo(() => {
    const map = new Map<WidgetCategory, typeof WIDGET_CATALOG>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const w of available) map.get(w.category)?.push(w);
    return map;
  }, [available]);

  if (!layout) return <p className="text-sm text-neutral-500">Chargement du tableau de bord...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        {editing && (
          <button
            onClick={() => setShowPicker((s) => !s)}
            className="rounded border border-neutral-700 px-3 py-1.5 text-xs font-medium hover:bg-neutral-800"
          >
            + Ajouter un widget
          </button>
        )}
        <button
          onClick={() => {
            setEditing((e) => !e);
            setShowPicker(false);
          }}
          className={`rounded px-3 py-1.5 text-xs font-medium ${
            editing ? "bg-blue-600 text-white hover:bg-blue-500" : "border border-neutral-700 hover:bg-neutral-800"
          }`}
        >
          {editing ? "Terminer" : "Personnaliser"}
        </button>
      </div>

      {showPicker && (
        <div className="card space-y-3 p-4">
          {CATEGORY_ORDER.map((cat) => {
            const items = availableByCategory.get(cat) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-600">{cat}</div>
                <div className="flex flex-wrap gap-2">
                  {items.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => addWidget(w.id)}
                      title={w.description}
                      className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs hover:border-blue-600 hover:text-blue-500"
                    >
                      + {w.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {available.length === 0 && <p className="text-xs text-neutral-500">Tous les widgets disponibles sont déjà affichés.</p>}
        </div>
      )}

      {layout.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Aucun widget affiché.{" "}
          <button onClick={() => { setEditing(true); setShowPicker(true); }} className="text-blue-600 hover:underline">
            Ajoutes-en un
          </button>
          .
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={layout} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {layout.map((id) => {
                const def = getWidgetDef(id);
                const Widget = WIDGET_COMPONENTS[id];
                if (!def || !Widget) return null;
                return (
                  <WidgetFrame key={id} def={def} editing={editing} onRemove={() => removeWidget(id)}>
                    <Widget />
                  </WidgetFrame>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
