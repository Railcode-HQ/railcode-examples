import { useMemo, useState } from "react";
import { useStore } from "../store";
import { buildColumns, type Filters } from "../lib/cards";
import { STATUSES, type Card, type Status } from "../types";
import { Column } from "./Column";

export function Board() {
  const cards = useStore((s) => s.cards);
  const sorts = useStore((s) => s.sorts);
  const search = useStore((s) => s.search);
  const tagFilter = useStore((s) => s.tagFilter);
  const priorityFilter = useStore((s) => s.priorityFilter);
  const assigneeFilter = useStore((s) => s.assigneeFilter);
  const doneFilter = useStore((s) => s.doneFilter);
  const collapsed = useStore((s) => s.collapsed);
  const toggleCollapse = useStore((s) => s.toggleCollapse);
  const reorderCard = useStore((s) => s.reorderCard);
  const setCardStatus = useStore((s) => s.setCardStatus);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ status: Status; index: number } | null>(null);

  const cols = useMemo(() => {
    const filters: Filters = {
      search,
      tags: tagFilter,
      priorities: priorityFilter,
      assignees: assigneeFilter,
      done: doneFilter,
      now: new Date(),
    };
    return buildColumns(Object.values(cards), filters, sorts);
  }, [cards, sorts, search, tagFilter, priorityFilter, assigneeFilter, doneFilter]);

  const onDrop = (status: Status) => {
    const id = draggingId;
    setDropTarget(null);
    setDraggingId(null);
    if (!id) return;
    const dragged = cards[id];
    if (!dragged) return;

    // A collapsed column has no rendered cards to index against — just move it
    // into that status (dropped card stays hidden under the collapsed rail).
    if (collapsed[status]) {
      if (status !== dragged.status) setCardStatus(id, status);
      return;
    }

    if (sorts[status] === "manual") {
      const list = cols[status].filter((c) => c.id !== id);
      const index = dropTarget && dropTarget.status === status ? dropTarget.index : list.length;
      const before: Card | undefined = list[index - 1];
      const after: Card | undefined = list[index];
      let order: number;
      if (!before && !after) order = 0;
      else if (!before) order = after.order - 1;
      else if (!after) order = before.order + 1;
      else order = (before.order + after.order) / 2;
      reorderCard(id, status, order);
    } else if (status !== dragged.status) {
      // Under a sort, position is derived — just change the column.
      setCardStatus(id, status);
    }
  };

  return (
    <div className="board">
      {STATUSES.map(({ key }) => (
        <Column
          key={key}
          status={key}
          cards={cols[key]}
          draggingId={draggingId}
          dropIndex={dropTarget && dropTarget.status === key ? dropTarget.index : null}
          collapsed={collapsed[key]}
          onToggleCollapse={() => toggleCollapse(key)}
          onDragStartCard={(card, e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", card.id);
            // Defer removing the source node so the browser captures the drag
            // image first — removing it synchronously can abort the drag.
            const cardId = card.id;
            window.setTimeout(() => setDraggingId(cardId), 0);
          }}
          onDragEndCard={() => {
            setDraggingId(null);
            setDropTarget(null);
          }}
          onDragOverList={(status, index) => setDropTarget({ status, index })}
          onDropList={onDrop}
          onDragLeaveList={(status) =>
            setDropTarget((prev) => (prev && prev.status === status ? null : prev))
          }
        />
      ))}
    </div>
  );
}
