import {
  CalendarClock,
  CloudDownload,
  CornerDownLeft,
  FileText,
  Files,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatDay, relativeTime } from "@/lib/proposals";
import { useProposalStore } from "@/store/proposal-store";

type Command = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: typeof Search;
  disabled?: boolean;
  run: () => void;
};

/** Subsequence match — "acm mig" finds "Acme — Data Platform Migration". */
function matches(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const words = needle.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => h.includes(w));
}

export function CommandBar() {
  const {
    commandOpen,
    setCommandOpen,
    meetings,
    proposals,
    materials,
    job,
    importing,
    setView,
    selectProposal,
    draftFromMeeting,
    importMeetings,
    refreshMeetings,
  } = useProposalStore();

  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const busy = job !== null;
  const noMaterials = materials.length === 0;

  // Global ⌘K / Ctrl+K, and Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(!commandOpen);
      }
      if (e.key === "Escape" && commandOpen) setCommandOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandOpen, setCommandOpen]);

  useEffect(() => {
    if (commandOpen) {
      setQ("");
      setActive(0);
      // Focus after paint, or the input isn't mounted yet.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [commandOpen]);

  const commands = useMemo<Command[]>(() => {
    const close = (fn: () => void) => () => {
      setCommandOpen(false);
      fn();
    };

    const nav: Command[] = [
      {
        id: "nav-meetings",
        label: "Go to Meetings",
        group: "Navigate",
        icon: CalendarClock,
        run: close(() => setView("meetings")),
      },
      {
        id: "nav-proposals",
        label: "Go to Proposals",
        group: "Navigate",
        icon: FileText,
        run: close(() => setView("proposal")),
      },
      {
        id: "nav-materials",
        label: "Go to Materials",
        group: "Navigate",
        icon: Files,
        run: close(() => setView("materials")),
      },
      {
        id: "nav-setup",
        label: "Open setup guide",
        group: "Navigate",
        icon: Wand2,
        run: close(() => setView("setup")),
      },
      {
        id: "nav-settings",
        label: "Go to Settings",
        group: "Navigate",
        icon: Settings2,
        run: close(() => setView("settings")),
      },
    ];

    const actions: Command[] = [
      {
        id: "act-refresh",
        label: "Check Granola for new meetings",
        hint: importing ? "already checking" : undefined,
        group: "Actions",
        icon: RefreshCw,
        disabled: importing,
        run: close(() => void refreshMeetings()),
      },
      {
        id: "act-import",
        label: "Import last 30 days of meetings",
        hint: importing ? "already importing" : undefined,
        group: "Actions",
        icon: CloudDownload,
        disabled: importing,
        run: close(() => void importMeetings("last_30_days")),
      },
    ];

    const draftable: Command[] = meetings
      .filter((m) => !m.drafted)
      .slice(0, 8)
      .map((m) => ({
        id: `draft-${m.id}`,
        label: `Draft proposal from “${m.title}”`,
        hint: noMaterials ? "add materials first" : formatDay(m.date),
        group: "Draft from a meeting",
        icon: Sparkles,
        disabled: busy || noMaterials,
        run: close(() => void draftFromMeeting(m.id)),
      }));

    const open: Command[] = proposals.slice(0, 8).map((p) => ({
      id: `open-${p.id}`,
      label: p.title || p.client,
      hint: relativeTime(p.createdAt),
      group: "Open a proposal",
      icon: FileText,
      run: close(() => selectProposal(p.id)),
    }));

    return [...actions, ...draftable, ...open, ...nav];
  }, [
    busy,
    importing,
    draftFromMeeting,
    importMeetings,
    meetings,
    noMaterials,
    proposals,
    refreshMeetings,
    selectProposal,
    setCommandOpen,
    setView,
  ]);

  const filtered = useMemo(
    () => commands.filter((c) => matches(`${c.label} ${c.group}`, q)),
    [commands, q],
  );

  useEffect(() => {
    setActive(0);
  }, [q]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!commandOpen) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[active];
      if (cmd && !cmd.disabled) cmd.run();
    }
  }

  let lastGroup = "";

  return (
    <div className="cmd-scrim" onClick={() => setCommandOpen(false)}>
      <div className="cmd" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-input">
          <Search size={16} />
          <input
            ref={inputRef}
            placeholder="Search meetings and proposals, or run a command…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>esc</kbd>
        </div>

        <div className="cmd-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="cmd-empty">Nothing matches “{q}”.</div>
          ) : (
            filtered.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              const Icon = c.icon;
              return (
                <div key={c.id}>
                  {header ? <div className="cmd-group">{header}</div> : null}
                  <button
                    data-idx={i}
                    className={`cmd-row${i === active ? " active" : ""}`}
                    disabled={c.disabled}
                    onMouseMove={() => setActive(i)}
                    onClick={() => c.run()}
                  >
                    <Icon size={15} />
                    <span className="cmd-label">{c.label}</span>
                    {c.hint ? <span className="cmd-hint">{c.hint}</span> : null}
                    {i === active ? (
                      <span className="cmd-enter">
                        <CornerDownLeft size={13} />
                      </span>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
