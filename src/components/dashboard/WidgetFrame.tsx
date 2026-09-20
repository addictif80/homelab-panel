"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { WidgetDef } from "@/lib/dashboardWidgets";

export function WidgetFrame({
  def,
  editing,
  onRemove,
  children,
}: {
  def: WidgetDef;
  editing: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: def.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={def.size === "lg" ? "col-span-full" : ""}
    >
      <section className="card flex h-full flex-col p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{def.title}</h2>
          {editing && (
            <div className="flex items-center gap-1.5">
              <button
                {...attributes}
                {...listeners}
                aria-label="Déplacer le widget"
                title="Déplacer"
                className="cursor-grab rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 active:cursor-grabbing"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="9" cy="6" r="1.5" fill="currentColor" />
                  <circle cx="15" cy="6" r="1.5" fill="currentColor" />
                  <circle cx="9" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="15" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="9" cy="18" r="1.5" fill="currentColor" />
                  <circle cx="15" cy="18" r="1.5" fill="currentColor" />
                </svg>
              </button>
              <button
                onClick={onRemove}
                aria-label="Retirer le widget"
                title="Retirer"
                className="rounded p-1 text-neutral-500 hover:bg-red-500/10 hover:text-red-400"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}
        </div>
        <div className="flex-1">{children}</div>
      </section>
    </div>
  );
}
