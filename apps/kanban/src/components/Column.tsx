import { useRef, useState } from "react";
import { useStore } from "../store";
import type { Card, Status } from "../types";
import { STATUS_LABEL } from "../types";
import { parseLooseInput } from "../lib/parse";
import { CardTile } from "./CardTile";
import { SortMenu } from "./SortMenu";
import { IconChevronsLeft, IconPlus } from "./icons";

export function Column({
  status,
  cards,
  draggingId,
  dropIndex,
  collapsed,
  onToggleCollapse,
  onDragStartCard,
  onDragEndCard,
  onDragOverList,
  onDropList,
  onDragLeaveList,
}: {
  status: Status;
  cards: Card[];
  draggingId: string | null;
  dropIndex: number | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onDragStartCard: (card: Card, e: React.DragEvent) => void;
  onDragEndCard: () => void;
  onDragOverList: (status: Status, index: number) => void;
  onDropList: (status: Status) => void;
  onDragLeaveList: (status: Status) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const addCard = useStore((s) => s.addCard);
  const flash = useStore((s) => s.flash);
  const sort = useStore((s) => s.sorts[status]);
  const setSort = useStore((s) => s.setSort);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");

  const visible = cards.filter((c) => c.id !== draggingId);

  const computeIndex = (e: React.DragEvent): number => {
    const el = listRef.current;
    if (!el) return visible.length;
    const items = [...el.querySelectorAll<HTMLElement>("[data-card-id]")];
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return i;
    }
    return items.length;
  };

  const submitAdd = async () => {
    const parsed = parseLooseInput(text);
    if (!parsed.title) {
      setText("");
      setAdding(false);
      return;
    }
    const id = await addCard({
      title: parsed.title,
      tags: parsed.tags,
      priority: parsed.priority,
      status,
    });
    setText("");
    flash(id);
    window.setTimeout(() => flash(null), 900);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className={`column collapsed${dropIndex !== null ? " drop-active" : ""}`}
        onClick={onToggleCollapse}
        title={`Expand ${STATUS_LABEL[status]}`}
        onDragOver={(e) => {
          if (!draggingId) return;
          e.preventDefault();
          onDragOverList(status, 0);
        }}
        onDrop={(e) => {
          if (!draggingId) return;
          e.preventDefault();
          onDropList(status);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            onDragLeaveList(status);
          }
        }}
      >
        <span className="col-rail-top">
          <span className={`col-dot ${status}`} />
          <span className="col-count tab">{cards.length}</span>
        </span>
        <span className="col-rail-title">{STATUS_LABEL[status]}</span>
        <span className="col-rail-ic">
          <IconChevronsLeft style={{ transform: "rotate(180deg)" }} />
        </span>
      </button>
    );
  }

  return (
    <section
      className={`column${dropIndex !== null ? " drop-active" : ""}`}
      onDragOver={(e) => {
        if (!draggingId) return;
        e.preventDefault();
        onDragOverList(status, computeIndex(e));
      }}
      onDrop={(e) => {
        if (!draggingId) return;
        e.preventDefault();
        onDropList(status);
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the column entirely.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          onDragLeaveList(status);
        }
      }}
    >
      <div className="col-head">
        <span className={`col-dot ${status}`} />
        <span className="col-title">{STATUS_LABEL[status]}</span>
        <span className="col-count tab">{cards.length}</span>
        <span className="col-spacer" />
        <SortMenu
          status={status}
          value={sort}
          onChange={(s) => setSort(status, s)}
        />
        <button
          className="icon-btn col-add"
          aria-label={`Add card to ${STATUS_LABEL[status]}`}
          onClick={() => setAdding(true)}
        >
          <IconPlus />
        </button>
        <button
          className="icon-btn col-collapse"
          aria-label={`Collapse ${STATUS_LABEL[status]}`}
          title="Collapse column"
          onClick={onToggleCollapse}
        >
          <IconChevronsLeft />
        </button>
      </div>

      <div className="col-body" ref={listRef}>
        {adding && (
          <div className="quick-add">
            <input
              autoFocus
              value={text}
              placeholder="Title… (try p1 #bug)"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAdd();
                if (e.key === "Escape") {
                  setText("");
                  setAdding(false);
                }
              }}
              onBlur={() => {
                if (!text.trim()) setAdding(false);
              }}
            />
          </div>
        )}

        {visible.map((card, i) => (
          <div key={card.id} data-card-id={card.id}>
            {dropIndex === i && <div className="drop-line" />}
            <CardTile
              card={card}
              dragging={false}
              onDragStart={(e) => onDragStartCard(card, e)}
              onDragEnd={onDragEndCard}
            />
          </div>
        ))}
        {dropIndex === visible.length && <div className="drop-line" />}

        {visible.length === 0 && !adding && (
          <button className="col-empty" onClick={() => setAdding(true)}>
            <IconPlus />
            <span>Add a card</span>
          </button>
        )}
      </div>
    </section>
  );
}
