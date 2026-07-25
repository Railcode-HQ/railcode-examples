import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { searchCards } from "../lib/cards";
import { parseLooseInput } from "../lib/parse";
import { STATUS_LABEL, type Priority } from "../types";
import { PriorityBadge, TagChip } from "./bits";
import { IconCornerReturn, IconPlus, IconSearch } from "./icons";
import type { Card } from "../types";

type Item = { kind: "card"; card: Card } | { kind: "create" };

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const close = useStore((s) => s.closePalette);
  const cards = useStore((s) => s.cards);
  const openCreate = useStore((s) => s.openCreate);
  const openDrawer = useStore((s) => s.openDrawer);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => Object.values(cards), [cards]);
  const parsed = useMemo(() => parseLooseInput(query), [query]);
  const hasQuery = query.trim().length > 0;
  const canCreate = parsed.title.length > 0;

  const results = useMemo(
    () => (hasQuery ? searchCards(all, query, 6) : []),
    [all, query, hasQuery],
  );

  // Recent cards when the field is empty, so ⌘K doubles as a quick jump.
  const recent = useMemo(() => {
    if (hasQuery) return [];
    return [...all]
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .slice(0, 6);
  }, [all, hasQuery]);

  const items: Item[] = useMemo(() => {
    if (!hasQuery) return recent.map((card) => ({ kind: "card", card }));
    const list: Item[] = results.map((card) => ({ kind: "card", card }));
    list.push({ kind: "create" });
    return list;
  }, [hasQuery, recent, results]);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      // focus after paint
      const t = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  // Keep selection in range as items change; default to first item.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Scroll selection into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected, items.length]);

  if (!open) return null;

  const doCreate = () => {
    if (!canCreate) return;
    // Hand the parsed values to the create modal to finish + confirm.
    openCreate({
      title: parsed.title,
      tags: parsed.tags,
      priority: parsed.priority,
    });
  };

  const activate = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "card") {
      openDrawer(item.card.id);
      close();
    } else {
      doCreate();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // ⌘/Ctrl+Enter always creates.
      if ((e.metaKey || e.ctrlKey) && canCreate) doCreate();
      else activate(items[selected]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      e.preventDefault();
      setSelected((s) =>
        e.shiftKey ? Math.max(0, s - 1) : Math.min(items.length - 1, s + 1),
      );
    }
  };

  const previewPriority = (parsed.priority ?? 2) as Priority;

  return (
    <div className="overlay pal-overlay" onMouseDown={close}>
      <div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pal-input">
          <IconSearch />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search cards, or type a new one…"
            spellCheck={false}
          />
          <kbd className="kbd">esc</kbd>
        </div>

        <div className="pal-list" ref={listRef}>
          {items.length === 0 && (
            <div className="pal-empty">
              {hasQuery
                ? "No matches — keep typing to create a card."
                : "No cards yet. Type a title to add your first one."}
            </div>
          )}

          {items.map((item, i) => {
            const active = i === selected;
            if (item.kind === "card") {
              const c = item.card;
              return (
                <button
                  key={c.id}
                  data-i={i}
                  className={`pal-row${active ? " active" : ""}`}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => activate(item)}
                >
                  <PriorityBadge priority={c.priority} />
                  <span className="pal-row-title">{c.title}</span>
                  <span className="pal-row-tags">
                    {c.tags.slice(0, 3).map((t) => (
                      <TagChip key={t} tag={t} />
                    ))}
                  </span>
                  <span className={`pal-row-status s-${c.status}`}>
                    {STATUS_LABEL[c.status]}
                  </span>
                </button>
              );
            }
            return (
              <button
                key="create"
                data-i={i}
                className={`pal-row pal-create${active ? " active" : ""}${
                  canCreate ? "" : " disabled"
                }`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => activate(item)}
                disabled={!canCreate}
              >
                <span className="pal-create-ic">
                  <IconPlus />
                </span>
                {canCreate ? (
                  <>
                    <span className="pal-row-title">
                      Add card: <strong>{parsed.title}</strong>
                    </span>
                    <span className="pal-create-preview">
                      <PriorityBadge priority={previewPriority} />
                      {parsed.tags.map((t) => (
                        <TagChip key={t} tag={t} />
                      ))}
                    </span>
                    <span className="pal-row-hint">
                      <IconCornerReturn />
                    </span>
                  </>
                ) : (
                  <span className="pal-row-title muted">
                    Type a title to create a card
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="pal-foot">
          <span className="pal-hint-grp">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> navigate
          </span>
          <span className="pal-hint-grp">
            <kbd className="kbd">↵</kbd>{" "}
            {hasQuery ? "open / add" : "open"}
          </span>
          <span className="pal-hint-grp">
            <kbd className="kbd">⌘↵</kbd> add card
          </span>
          <span className="pal-hint-spacer" />
          <span className="pal-hint-tip">
            e.g. <code>fix login p1 #auth</code>
          </span>
        </div>
      </div>
    </div>
  );
}
