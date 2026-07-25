import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import type { AssigneeOption } from "../types";
import { IconChevron, IconCheck } from "./icons";

// uuid -> assignee lookup for resolving names on cards.
export function useAssigneeMap(): Record<string, AssigneeOption> {
  const assignees = useStore((s) => s.assignees);
  return useMemo(
    () => Object.fromEntries(assignees.map((a) => [a.uuid, a])),
    [assignees],
  );
}

export function initials(name: string): string {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Small round initials badge for a card's assignee. Renders nothing when
// unassigned, so it's safe to drop straight into a flex row.
export function AssigneeAvatar({
  uuid,
  size = "sm",
}: {
  uuid: string | null;
  size?: "xs" | "sm";
}) {
  const map = useAssigneeMap();
  if (!uuid) return null;
  const name = map[uuid]?.name ?? "Unknown";
  return (
    <span className={`avatar ${size}`} title={name}>
      {initials(name) || "?"}
    </span>
  );
}

// Searchable single-select of assignable org members. "Unassigned" is
// always the first option so it's reachable even while a search is active.
export function AssigneeSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (uuid: string | null) => void;
}) {
  const assignees = useStore((s) => s.assignees);
  const loading = useStore((s) => s.assigneesLoading);
  const error = useStore((s) => s.assigneesError);
  const map = useAssigneeMap();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? assignees.filter((a) => a.name.toLowerCase().includes(q)) : assignees;
  }, [assignees, query]);

  // index 0 is always "Unassigned"; the rest map 1:1 onto `filtered`.
  const options: (AssigneeOption | null)[] = useMemo(
    () => [null, ...filtered],
    [filtered],
  );

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const choose = (opt: AssigneeOption | null) => {
    onChange(opt ? opt.uuid : null);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      if (open) {
        e.preventDefault();
        choose(options[highlight] ?? null);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQuery("");
      }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const current = value ? map[value] : null;

  return (
    <div className="picker-select">
      {current && (
        <div className="picker-chips selected">
          <span className="picker-chip removable">
            <span className="avatar xs">{initials(current.name)}</span>
            {current.name}
            <button
              type="button"
              className="chip-x"
              aria-label="Unassign"
              onClick={() => choose(null)}
            >
              ×
            </button>
          </span>
        </div>
      )}

      {loading ? (
        <div className="picker-note">Loading people…</div>
      ) : error ? (
        <div className="picker-note">Couldn’t load people ({error}).</div>
      ) : assignees.length === 0 ? (
        <div className="picker-note">No assignable people found.</div>
      ) : (
        <div className="combo">
          <input
            ref={inputRef}
            className="modal-input combo-input"
            role="combobox"
            aria-expanded={open}
            value={query}
            placeholder={current ? "Reassign…" : "Assign to…"}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onBlur={() => window.setTimeout(() => setOpen(false), 100)}
            onKeyDown={onKeyDown}
          />
          <IconChevron className="combo-chev" />
          {open && (
            <div className="select-pop" ref={listRef}>
              <div
                data-i={0}
                role="option"
                aria-selected={!value}
                className={`select-opt${highlight === 0 ? " hl" : ""}${!value ? " on" : ""}`}
                onMouseEnter={() => setHighlight(0)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(null);
                }}
              >
                <span className="select-opt-name muted">Unassigned</span>
                {!value && <IconCheck />}
              </div>
              {filtered.map((a, i) => {
                const on = value === a.uuid;
                return (
                  <div
                    key={a.uuid}
                    data-i={i + 1}
                    role="option"
                    aria-selected={on}
                    className={`select-opt${i + 1 === highlight ? " hl" : ""}${on ? " on" : ""}`}
                    onMouseEnter={() => setHighlight(i + 1)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(a);
                    }}
                  >
                    <span className="avatar xs">{initials(a.name)}</span>
                    <span className="select-opt-name">{a.name}</span>
                    {on && <IconCheck />}
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="select-empty">No one matches “{query}”.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
