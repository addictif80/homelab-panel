"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

/** One dashboard column: a `useDroppable` container (so dropping onto empty space — including an
 * entirely empty column — resolves to this column) wrapping a `SortableContext` for its own
 * blocks (so reordering within the column, and dnd-kit resolving drops onto a specific block,
 * both work). This is the standard dnd-kit "sortable across multiple containers" shape. */
export function ColumnDropZone({
  columnIndex,
  blockIds,
  editing,
  children,
}: {
  columnIndex: number;
  blockIds: string[];
  editing: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-placeholder-${columnIndex}` });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[80px] flex-col gap-4 rounded-lg ${
        editing ? `border-2 border-dashed ${isOver ? "border-blue-600 bg-blue-500/5" : "border-neutral-800"} p-2` : ""
      }`}
    >
      <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
        {children}
        {blockIds.length === 0 && editing && (
          <p className="p-2 text-center text-xs text-neutral-600">Dépose un widget ici</p>
        )}
      </SortableContext>
    </div>
  );
}
