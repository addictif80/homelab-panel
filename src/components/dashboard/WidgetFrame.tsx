"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { WidgetDef, WidgetSize } from "@/lib/dashboardWidgets";

const SIZE_LABEL: Record<WidgetSize, string> = { sm: "Compact", md: "Normal", lg: "Grand" };
const SIZE_STYLE: Record<WidgetSize, string> = {
  sm: "max-h-[180px] overflow-y-auto",
  md: "",
  lg: "min-h-[420px]",
};

function DragHandle(props: React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      aria-label="Déplacer"
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
  );
}

function RemoveButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      aria-label="Retirer"
      title="Retirer"
      className="rounded p-1 text-neutral-500 hover:bg-red-500/10 hover:text-red-400"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function WidgetFrame({
  blockId,
  def,
  size,
  editing,
  onRemove,
  onSizeChange,
  children,
}: {
  blockId: string;
  def: WidgetDef;
  size: WidgetSize;
  editing: boolean;
  onRemove: () => void;
  onSizeChange: (size: WidgetSize) => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: blockId });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
      <section className="card flex h-full flex-col p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{def.title}</h2>
          {editing && (
            <div className="flex items-center gap-1.5">
              <div className="flex overflow-hidden rounded border border-neutral-700 text-[10px]">
                {(["sm", "md", "lg"] as WidgetSize[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => onSizeChange(s)}
                    title={SIZE_LABEL[s]}
                    className={`px-1.5 py-1 ${s === size ? "bg-blue-600 text-white" : "text-neutral-500 hover:bg-neutral-800"}`}
                  >
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>
              <DragHandle {...attributes} {...listeners} />
              <RemoveButton onClick={onRemove} />
            </div>
          )}
        </div>
        <div className={`@container flex-1 ${SIZE_STYLE[size]}`}>{children}</div>
      </section>
    </div>
  );
}

export function SeparatorFrame({
  blockId,
  label,
  editing,
  onRemove,
  onLabelChange,
}: {
  blockId: string;
  label: string;
  editing: boolean;
  onRemove: () => void;
  onLabelChange: (label: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: blockId });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
      <div className="flex items-center gap-3 py-1">
        {editing ? (
          <input
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="Titre du séparateur (optionnel)"
            className="min-w-0 flex-1 border-b border-dashed border-neutral-700 bg-transparent px-1 py-1 text-xs font-semibold uppercase tracking-wider text-neutral-500 placeholder:text-neutral-600 placeholder:normal-case focus:border-blue-600 focus:outline-none"
          />
        ) : label ? (
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</span>
        ) : null}
        <span className="h-px flex-1 bg-neutral-800" />
        {editing && (
          <div className="flex shrink-0 items-center gap-1.5">
            <DragHandle {...attributes} {...listeners} />
            <RemoveButton onClick={onRemove} />
          </div>
        )}
      </div>
    </div>
  );
}
