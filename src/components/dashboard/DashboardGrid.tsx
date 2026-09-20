"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  WIDGET_CATALOG,
  getWidgetDef,
  type DashboardBlock,
  type WidgetCategory,
  type WidgetSize,
} from "@/lib/dashboardWidgets";
import { WIDGET_COMPONENTS } from "./registry";
import { WidgetFrame, SeparatorFrame } from "./WidgetFrame";
import { ColumnDropZone } from "./ColumnDropZone";
import { useDashboardLayout } from "./useDashboardLayout";

const CATEGORY_ORDER: WidgetCategory[] = ["Ressources", "Sécurité", "Fiabilité", "Réseau", "Autres"];
const COLUMN_GRID_CLASS: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
};

function findColumnIndexOfBlock(columns: DashboardBlock[][], blockId: string): number {
  return columns.findIndex((col) => col.some((b) => b.id === blockId));
}

function findColumnIndexFromOverId(columns: DashboardBlock[][], overId: string): number {
  const direct = findColumnIndexOfBlock(columns, overId);
  if (direct !== -1) return direct;
  const match = /^col-placeholder-(\d+)$/.exec(overId);
  return match ? Number(match[1]) : -1;
}

export function DashboardGrid() {
  const { layout, setLayout, loading } = useDashboardLayout();
  const [editing, setEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    // Functional update: dnd-kit can fire several onDragOver calls in quick succession (a fast
    // mouse move covers many intermediate positions) before React has re-rendered in between —
    // reading `layout` from the closure would then have every one of those calls compute its move
    // from the same stale snapshot, so only the last call's result "wins" and earlier moves in the
    // same batch are silently discarded. Deriving from the updater's own `prev` avoids that.
    setLayout((prev) => {
      if (!prev) return prev;
      const fromCol = findColumnIndexOfBlock(prev.columns, activeId);
      const toCol = findColumnIndexFromOverId(prev.columns, overId);
      if (fromCol === -1 || toCol === -1 || fromCol === toCol) return prev;

      const columns = prev.columns.map((c) => [...c]);
      const fromIndex = columns[fromCol].findIndex((b) => b.id === activeId);
      const [moved] = columns[fromCol].splice(fromIndex, 1);
      const overIndex = columns[toCol].findIndex((b) => b.id === overId);
      if (overIndex === -1) columns[toCol].push(moved);
      else columns[toCol].splice(overIndex, 0, moved);
      return { ...prev, columns };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Same functional-update reasoning as handleDragOver.
    setLayout((prev) => {
      if (!prev) return prev;
      const col = findColumnIndexOfBlock(prev.columns, activeId);
      if (col === -1) return prev;
      const overCol = findColumnIndexOfBlock(prev.columns, overId);
      if (overCol !== col || activeId === overId) return prev;
      const oldIndex = prev.columns[col].findIndex((b) => b.id === activeId);
      const newIndex = prev.columns[col].findIndex((b) => b.id === overId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const columns = prev.columns.map((c) => [...c]);
      columns[col] = arrayMove(columns[col], oldIndex, newIndex);
      return { ...prev, columns };
    });
  }

  function updateBlock(blockId: string, patch: Partial<DashboardBlock>) {
    setLayout((prev) => {
      if (!prev) return prev;
      const columns = prev.columns.map((col) => col.map((b) => (b.id === blockId ? ({ ...b, ...patch } as DashboardBlock) : b)));
      return { ...prev, columns };
    });
  }

  function removeBlock(blockId: string) {
    setLayout((prev) => {
      if (!prev) return prev;
      const columns = prev.columns.map((col) => col.filter((b) => b.id !== blockId));
      return { ...prev, columns };
    });
  }

  function addWidget(widgetId: string) {
    setLayout((prev) => {
      if (!prev) return prev;
      const columns = prev.columns.map((c) => [...c]);
      columns[0] = [...columns[0], { kind: "widget", id: widgetId, widgetId, size: "md" }];
      return { ...prev, columns };
    });
  }

  function addSeparator() {
    setLayout((prev) => {
      if (!prev) return prev;
      const columns = prev.columns.map((c) => [...c]);
      // Not crypto.randomUUID(): that API is only exposed in "secure contexts" (HTTPS, or
      // literally "localhost") — an instance reached over plain HTTP by IP (a raw LAN address,
      // 0.0.0.0 in a test) would throw here. This only needs to be unique within one board, not
      // unguessable.
      const id = `sep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      columns[0] = [...columns[0], { kind: "separator", id, label: "" }];
      return { ...prev, columns };
    });
  }

  function setColumnCount(count: 1 | 2 | 3) {
    setLayout((prev) => {
      if (!prev || prev.columnCount === count) return prev;
      const columns = prev.columns.map((c) => [...c]);
      if (count > columns.length) {
        while (columns.length < count) columns.push([]);
      } else {
        // Losing columns: their blocks move to the last surviving column rather than disappearing.
        const overflow = columns.splice(count).flat();
        columns[count - 1] = [...columns[count - 1], ...overflow];
      }
      return { columnCount: count, columns };
    });
  }

  const placedWidgetIds = useMemo(() => new Set(layout?.columns.flat().filter((b) => b.kind === "widget").map((b) => (b as { widgetId: string }).widgetId) ?? []), [layout]);
  const availableByCategory = useMemo(() => {
    const map = new Map<WidgetCategory, typeof WIDGET_CATALOG>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const w of WIDGET_CATALOG) if (!placedWidgetIds.has(w.id)) map.get(w.category)?.push(w);
    return map;
  }, [placedWidgetIds]);
  const availableCount = WIDGET_CATALOG.length - placedWidgetIds.size;

  const activeBlock = activeId && layout ? layout.columns.flat().find((b) => b.id === activeId) : null;

  if (loading || !layout) return <p className="text-sm text-neutral-500">Chargement du tableau de bord...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing && (
          <>
            <div className="flex items-center gap-1.5 text-xs text-neutral-500">
              Colonnes :
              <div className="flex overflow-hidden rounded border border-neutral-700">
                {([1, 2, 3] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => setColumnCount(n)}
                    className={`px-2.5 py-1.5 ${n === layout.columnCount ? "bg-blue-600 text-white" : "hover:bg-neutral-800"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => setShowPicker((s) => !s)}
              className="rounded border border-neutral-700 px-3 py-1.5 text-xs font-medium hover:bg-neutral-800"
            >
              + Ajouter
            </button>
          </>
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
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-600">Mise en page</div>
            <button onClick={addSeparator} className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs hover:border-blue-600 hover:text-blue-500">
              + Séparateur
            </button>
          </div>
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
          {availableCount === 0 && <p className="text-xs text-neutral-500">Tous les widgets disponibles sont déjà affichés.</p>}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className={`grid gap-4 ${COLUMN_GRID_CLASS[layout.columnCount]}`}>
          {layout.columns.map((column, colIndex) => (
            <ColumnDropZone key={colIndex} columnIndex={colIndex} blockIds={column.map((b) => b.id)} editing={editing}>
              {column.map((block) =>
                block.kind === "separator" ? (
                  <SeparatorFrame
                    key={block.id}
                    blockId={block.id}
                    label={block.label}
                    editing={editing}
                    onRemove={() => removeBlock(block.id)}
                    onLabelChange={(label) => updateBlock(block.id, { label })}
                  />
                ) : (
                  (() => {
                    const def = getWidgetDef(block.widgetId);
                    const Widget = WIDGET_COMPONENTS[block.widgetId];
                    if (!def || !Widget) return null;
                    return (
                      <WidgetFrame
                        key={block.id}
                        blockId={block.id}
                        def={def}
                        size={block.size}
                        editing={editing}
                        onRemove={() => removeBlock(block.id)}
                        onSizeChange={(size: WidgetSize) => updateBlock(block.id, { size })}
                      >
                        <Widget />
                      </WidgetFrame>
                    );
                  })()
                )
              )}
            </ColumnDropZone>
          ))}
        </div>
        <DragOverlay>
          {activeBlock ? (
            <div className="card p-4 opacity-90 shadow-lg">
              <span className="text-sm font-semibold">
                {activeBlock.kind === "separator" ? activeBlock.label || "Séparateur" : getWidgetDef(activeBlock.widgetId)?.title}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {layout.columns.every((c) => c.length === 0) && (
        <p className="text-sm text-neutral-500">
          Aucun widget affiché.{" "}
          <button
            onClick={() => {
              setEditing(true);
              setShowPicker(true);
            }}
            className="text-blue-600 hover:underline"
          >
            Ajoutes-en un
          </button>
          .
        </p>
      )}
    </div>
  );
}
