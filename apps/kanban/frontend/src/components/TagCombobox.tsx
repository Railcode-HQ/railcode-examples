import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeTag } from "../lib/parse";
import { tagTone } from "../lib/cards";
import { TagChip } from "./bits";
import { IconChevron } from "./icons";

// A single searchable tag control: type to filter tags that already exist on
// other cards, ↑/↓ to move, Enter to add the highlighted one. When what you
// type matches no existing tag, a "Create" row lets you add it as new. Mirrors
// AssigneeSelect's combobox behavior (Esc closes just the dropdown, Tab moves on).
export function TagCombobox({
  tags,
  suggestions,
  onAdd,
  onRemove,
  inputId,
}: {
  tags: string[]; // currently selected tags
  suggestions: string[]; // tag names already used across cards
  onAdd: (raw: string) => void;
  onRemove: (tag: string) => void;
  inputId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = normalizeTag(query);

  // Existing tags not yet on this card, filtered by the typed query.
  const matches = useMemo(() => {
    const available = suggestions.filter((t) => !tags.includes(t));
    return q ? available.filter((t) => t.includes(q)) : available;
  }, [suggestions, tags, q]);

  // Offer "Create" only when the typed value is genuinely new.
  const canCreate = q.length > 0 && !suggestions.includes(q) && !tags.includes(q);
  const total = matches.length + (canCreate ? 1 : 0);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const add = (raw: string) => {
    onAdd(raw);
    setQuery("");
    setHighlight(0);
    setOpen(true);
    inputRef.current?.focus();
  };

  // Commit whatever row is highlighted: an existing match, or the create row.
  const commitAt = (i: number) => {
    if (i < matches.length) add(matches[i]);
    else if (canCreate) add(query);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(total - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if ((e.key === "Enter" || e.key === ",") && !e.metaKey && !e.ctrlKey) {
      // Enter/comma add the highlighted row; ⌘/Ctrl+Enter falls through so the
      // surrounding modal can submit.
      if (total > 0) {
        e.preventDefault();
        e.stopPropagation();
        commitAt(Math.min(highlight, total - 1));
      } else if (e.key === ",") {
        e.preventDefault();
      }
    } else if (e.key === "Escape") {
      if (open) {
        // Close just the dropdown, not the surrounding modal.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQuery("");
      }
    } else if (e.key === "Tab") {
      setOpen(false); // let focus move on naturally
    } else if (e.key === "Backspace" && !query && tags.length) {
      onRemove(tags[tags.length - 1]);
    }
  };

  return (
    <div className="tag-combo">
      {tags.length > 0 && (
        <div className="drawer-tags">
          {tags.map((t) => (
            <TagChip key={t} tag={t} removable onRemove={() => onRemove(t)} />
          ))}
        </div>
      )}

      <div className="combo">
        <input
          id={inputId}
          ref={inputRef}
          className="tag-input combo-input"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          placeholder={tags.length ? "Add another tag…" : "Search or add a tag…"}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)}
          onKeyDown={onKeyDown}
        />
        <IconChevron className="combo-chev" />
        {open && total > 0 && (
          <div className="select-pop" ref={listRef}>
            {matches.map((t, i) => (
              <div
                key={t}
                data-i={i}
                role="option"
                aria-selected={i === highlight}
                className={`select-opt${i === highlight ? " hl" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  // keep focus in the input so the list stays open
                  e.preventDefault();
                  add(t);
                }}
              >
                <span className={`led ${tagTone(t)}`} />
                <span className="select-opt-name">{t}</span>
              </div>
            ))}
            {canCreate && (
              <div
                data-i={matches.length}
                role="option"
                aria-selected={highlight === matches.length}
                className={`select-opt create${highlight === matches.length ? " hl" : ""}`}
                onMouseEnter={() => setHighlight(matches.length)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(query);
                }}
              >
                <span className={`led ${tagTone(q)}`} />
                <span className="select-opt-name">
                  Create “{q}”
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
