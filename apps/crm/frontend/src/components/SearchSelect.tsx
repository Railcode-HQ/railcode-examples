import { Check, ChevronDown, Search } from "lucide-react";
import { useRef, useState } from "react";

import { Tone } from "@/lib/crm";

export type SearchOption = {
  value: string;
  label: string;
  sub?: string;
  /** Optional leading status dot (e.g. a deal stage's colour). */
  dot?: Tone;
};

/**
 * A single-select combobox: a control that opens a searchable list. Replaces
 * native <select> where the option set is an entity list worth filtering.
 * Pass `clearLabel: null` to make a value required (no clear row); `ghost` for
 * the borderless variant used inside the properties panel.
 */
export function SearchSelect({
  value,
  options,
  onChange,
  placeholder = "Select…",
  clearLabel = "— none —",
  ghost = false,
}: {
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  clearLabel?: string | null;
  ghost?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const controlRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) || o.sub?.toLowerCase().includes(q),
      )
    : options;

  function openMenu() {
    // Flip the menu above the control when there isn't room below it (e.g. in
    // the properties panel near the bottom of the scroll area).
    const rect = controlRef.current?.getBoundingClientRect();
    setDropUp(!!rect && window.innerHeight - rect.bottom < 300);
    setOpen(true);
    // Focus the search box once it has mounted.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="ss">
      <button
        ref={controlRef}
        type="button"
        className={`ss-control${ghost ? " ghost" : ""}${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        {selected?.dot ? <span className={`led ${selected.dot}`} /> : null}
        <span className={selected ? "ss-val" : "ss-ph"}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={15} />
      </button>

      {open ? (
        <div className={`ss-menu${dropUp ? " up" : ""}`}>
          <div className="ss-search">
            <Search size={14} />
            <input
              ref={inputRef}
              value={query}
              placeholder="Search…"
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => setOpen(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                else if (e.key === "Enter" && filtered[0]) {
                  e.preventDefault();
                  choose(filtered[0].value);
                }
              }}
            />
          </div>

          <div className="ss-list" role="listbox">
            {clearLabel ? (
              <button
                type="button"
                className={`ss-opt ss-clear${value === "" ? " sel" : ""}`}
                // mousedown fires before the input's blur, so the click registers
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose("");
                }}
              >
                <span className="ss-opt-body">
                  <span className="ss-opt-nm">{clearLabel}</span>
                </span>
                {value === "" ? <Check size={14} /> : null}
              </button>
            ) : null}

            {filtered.length ? (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`ss-opt${o.value === value ? " sel" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(o.value);
                  }}
                >
                  {o.dot ? <span className={`led ${o.dot}`} /> : null}
                  <span className="ss-opt-body">
                    <span className="ss-opt-nm">{o.label}</span>
                    {o.sub ? <span className="ss-opt-sub">{o.sub}</span> : null}
                  </span>
                  {o.value === value ? <Check size={14} /> : null}
                </button>
              ))
            ) : (
              <div className="ss-none">No matches</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
