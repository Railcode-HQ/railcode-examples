import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { normalizeTag } from "../lib/parse";
import {
  PRIORITIES,
  PRIORITY_META,
  STATUSES,
  type Priority,
  type Status,
} from "../types";
import { TagCombobox } from "./TagCombobox";
import { SelectMenu } from "./SelectMenu";
import { AssigneeSelect } from "./AssigneeControls";
import { IconClose } from "./icons";

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
}

export function CreateCardModal() {
  const seed = useStore((s) => s.createSeed);
  const close = useStore((s) => s.closeCreate);
  const addCard = useStore((s) => s.addCard);
  const flash = useStore((s) => s.flash);
  const allCards = useStore((s) => s.cards);
  const userUuid = useStore((s) => s.userUuid);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("todo");
  const [priority, setPriority] = useState<Priority>(2);
  const [tags, setTags] = useState<string[]>([]);
  const [assignee, setAssignee] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Seed the form each time the modal opens, then land focus on the
  // description so the user can start typing detail immediately.
  useEffect(() => {
    if (!seed) return;
    setTitle(seed.title);
    setDescription("");
    setStatus("todo");
    setPriority((seed.priority ?? 2) as Priority);
    setTags(seed.tags);
    setAssignee(null);
    const t = window.setTimeout(() => descRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [seed]);

  // Every tag already used across cards, most-used first. Feeds the tag
  // combobox's suggestion list. Computed before the early return so the hook
  // order stays stable across renders.
  const allTagNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of Object.values(allCards)) {
      for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.keys()].sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0),
    );
  }, [allCards]);

  if (!seed) return null;

  const addTag = (raw: string) => {
    const tag = normalizeTag(raw);
    if (tag && !tags.includes(tag)) setTags((prev) => [...prev, tag]);
  };
  const removeTag = (tag: string) =>
    setTags((prev) => prev.filter((t) => t !== tag));

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      titleRef.current?.focus();
      return;
    }
    const id = await addCard({ title: t, description, tags, assignee, priority, status });
    flash(id);
    window.setTimeout(() => flash(null), 900);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }
    // Keep Tab cycling inside the dialog.
    if (e.key === "Tab") {
      const items = focusables(modalRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="overlay create-overlay" onMouseDown={close}>
      <div
        className="create-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create card"
        ref={modalRef}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="modal-head">
          <span className="modal-title">New card</span>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <IconClose />
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label className="field-label" htmlFor="cc-title">
              Title
            </label>
            <input
              id="cc-title"
              ref={titleRef}
              className="modal-input"
              value={title}
              placeholder="Card title"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  descRef.current?.focus();
                }
              }}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="cc-desc">
              Description
            </label>
            <textarea
              id="cc-desc"
              ref={descRef}
              className="drawer-desc"
              rows={4}
              value={description}
              placeholder="Add more detail…"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="fgrid2">
            <div className="field">
              <div className="field-label">Status</div>
              <SelectMenu
                ariaLabel="Status"
                value={status}
                onChange={(v) => setStatus(v as Status)}
                options={STATUSES.map((s) => ({ value: s.key, label: s.label }))}
              />
            </div>
            <div className="field">
              <div className="field-label">Priority</div>
              <SelectMenu
                ariaLabel="Priority"
                value={String(priority)}
                onChange={(v) => setPriority(Number(v) as Priority)}
                options={PRIORITIES.map((p) => ({
                  value: String(p),
                  label: PRIORITY_META[p].label,
                }))}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="cc-tags">
              Tags
            </label>
            <TagCombobox
              inputId="cc-tags"
              tags={tags}
              suggestions={allTagNames}
              onAdd={addTag}
              onRemove={removeTag}
            />
          </div>

          <div className="field">
            <div className="field-label-row">
              <span className="field-label">Assignee</span>
              {userUuid && assignee !== userUuid && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setAssignee(userUuid)}
                >
                  Assign to me
                </button>
              )}
            </div>
            <AssigneeSelect value={assignee} onChange={setAssignee} />
          </div>
        </div>

        <div className="modal-foot">
          <span className="modal-hint">
            <kbd className="kbd">⌘↵</kbd> to create
          </span>
          <span className="modal-foot-spacer" />
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn" onClick={submit}>
            Create card
          </button>
        </div>
      </div>
    </div>
  );
}
