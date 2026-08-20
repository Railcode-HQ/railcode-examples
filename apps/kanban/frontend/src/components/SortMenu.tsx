import { useEffect, useRef, useState } from "react";
import { SORT_OPTIONS, type SortKey, type Status } from "../types";
import { IconCheck, IconSort } from "./icons";

// Per-column sort control: an icon button that opens a small popover of the
// sort options valid for this column ("Recently done" only shows on Done).
export function SortMenu({
  status,
  value,
  onChange,
}: {
  status: Status;
  value: SortKey;
  onChange: (sort: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = SORT_OPTIONS.filter(
    (o) => o.key !== "done_desc" || status === "done",
  );
  const active = options.find((o) => o.key === value) ?? options[0];

  return (
    <div className="sortmenu" ref={ref}>
      <button
        className={`icon-btn col-sort${value !== "manual" ? " on" : ""}`}
        title={`Sort: ${active.label}`}
        aria-label="Sort column"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <IconSort />
      </button>
      {open && (
        <div className="menu-pop" onClick={(e) => e.stopPropagation()}>
          <div className="menu-label">Sort by</div>
          {options.map((o) => (
            <button
              key={o.key}
              className={`menu-item${o.key === value ? " on" : ""}`}
              onClick={() => {
                onChange(o.key);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.key === value && <IconCheck />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
