import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconChevron } from "./icons";

export interface SelectOption {
  value: string;
  label: ReactNode; // shown in the dropdown row
  triggerLabel?: ReactNode; // optional override for how the value reads in the trigger
  lead?: ReactNode; // optional leading element in the row (dot / badge)
}

// Custom single-select that replaces a native <select>. Matches the app's
// combobox look (.select-pop / .select-opt) and keyboard model (↑/↓, Enter,
// Esc, Home/End, Tab). The dropdown is portaled to <body> with fixed
// positioning so it never clips inside a scrolling modal body or list row.
export function SelectMenu({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  lead,
  placeholder,
  align = "left",
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string; // extra classes for the trigger button
  lead?: ReactNode; // leading icon inside the trigger (e.g. calendar)
  placeholder?: ReactNode; // shown when no option matches value
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];

  const openMenu = () => {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    setHighlight(selectedIndex);
    setOpen(true);
  };
  const choose = (i: number) => {
    const opt = options[i];
    if (opt) onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  // While open: keep positioned, and close on outside click / scroll / resize.
  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => setOpen(false);
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !popRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    // capture:true so we also catch scrolls inside ancestors (modal body, list)
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openMenu();
      else setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openMenu();
      else setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) openMenu();
      else choose(highlight);
    } else if (e.key === "Escape") {
      if (open) {
        // Close just the menu, not any surrounding modal.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    } else if (e.key === "Home") {
      if (open) {
        e.preventDefault();
        setHighlight(0);
      }
    } else if (e.key === "End") {
      if (open) {
        e.preventDefault();
        setHighlight(options.length - 1);
      }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`select-trigger${open ? " open" : ""}${className ? ` ${className}` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={onKeyDown}
      >
        {lead && <span className="select-lead">{lead}</span>}
        <span className="select-trigger-label">
          {selected ? (selected.triggerLabel ?? selected.label) : placeholder}
        </span>
        <IconChevron className="select-chev" />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={popRef}
            className="select-pop select-pop--float"
            role="listbox"
            style={{
              position: "fixed",
              top: rect.bottom + 4,
              left: align === "left" ? rect.left : undefined,
              right:
                align === "right" ? window.innerWidth - rect.right : undefined,
              minWidth: rect.width,
              zIndex: 1000,
            }}
          >
            {options.map((o, i) => (
              <div
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={`select-opt${i === highlight ? " hl" : ""}${o.value === value ? " on" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  // keep focus on the trigger; select on press
                  e.preventDefault();
                  choose(i);
                }}
              >
                {o.lead}
                <span className="select-opt-name">{o.label}</span>
                {o.value === value && <IconCheck />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
