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
import { TagChip, formatBytes, fullDate } from "./bits";
import { AssigneeSelect } from "./AssigneeControls";
import { tagTone } from "../lib/cards";
import { IconClose, IconPaperclip, IconTrash } from "./icons";

export function CardDrawer() {
  const id = useStore((s) => s.drawerCardId);
  const card = useStore((s) => (id ? s.cards[id] : null));
  const close = useStore((s) => s.closeDrawer);
  const updateCard = useStore((s) => s.updateCard);
  const userUuid = useStore((s) => s.userUuid);
  const setCardStatus = useStore((s) => s.setCardStatus);
  const deleteCard = useStore((s) => s.deleteCard);
  const addAttachment = useStore((s) => s.addAttachment);
  const removeAttachment = useStore((s) => s.removeAttachment);
  const allCards = useStore((s) => s.cards);

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (card) {
      setTitle(card.title);
      setDesc(card.description);
      setTagInput("");
      setConfirming(false);
      setUploadError(null);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape to close.
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, close]);

  const suggestions = useMemo(() => {
    if (!card) return [];
    const counts = new Map<string, number>();
    for (const c of Object.values(allCards)) {
      for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const q = normalizeTag(tagInput);
    return [...counts.keys()]
      .filter((t) => !card.tags.includes(t))
      .filter((t) => !q || t.includes(q))
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
      .slice(0, 8);
  }, [allCards, card, tagInput]);

  if (!id || !card) return null;

  const commitTitle = () => {
    const t = title.trim();
    if (t && t !== card.title) updateCard(card.id, { title: t });
    else if (!t) setTitle(card.title);
  };
  const commitDesc = () => {
    if (desc !== card.description) updateCard(card.id, { description: desc });
  };

  const addTag = (raw: string) => {
    const tag = normalizeTag(raw);
    if (!tag || card.tags.includes(tag)) {
      setTagInput("");
      return;
    }
    updateCard(card.id, { tags: [...card.tags, tag] });
    setTagInput("");
  };
  const removeTag = (tag: string) =>
    updateCard(card.id, { tags: card.tags.filter((t) => t !== tag) });

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(fileList)) {
        await addAttachment(card.id, file);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="overlay drawer-overlay" onMouseDown={close}>
      <div
        className="drawer"
        role="dialog"
        aria-label="Card details"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <span className={`col-dot ${card.status}`} />
          <span className="drawer-head-label">Card details</span>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <IconClose />
          </button>
        </div>

        <div className="drawer-body">
          <textarea
            className="drawer-title"
            value={title}
            rows={1}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            placeholder="Card title"
          />

          <div className="field">
            <div className="field-label">Status</div>
            <div className="segmented">
              {STATUSES.map((s) => (
                <button
                  key={s.key}
                  className={`seg${card.status === s.key ? " on" : ""} seg-${s.key}`}
                  onClick={() => setCardStatus(card.id, s.key as Status)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="field-label">Priority</div>
            <div className="segmented pri-seg">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  className={`seg${card.priority === p ? ` on t-${PRIORITY_META[p].tone}` : ""}`}
                  onClick={() => updateCard(card.id, { priority: p as Priority })}
                >
                  {PRIORITY_META[p].label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="field-label-row">
              <span className="field-label">Assignee</span>
              {userUuid && card.assignee !== userUuid && (
                <button
                  className="link-btn"
                  onClick={() => updateCard(card.id, { assignee: userUuid })}
                >
                  Assign to me
                </button>
              )}
            </div>
            <AssigneeSelect
              value={card.assignee}
              onChange={(uuid) => updateCard(card.id, { assignee: uuid })}
            />
          </div>

          <div className="field">
            <div className="field-label">Description</div>
            <textarea
              className="drawer-desc"
              value={desc}
              rows={4}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={commitDesc}
              placeholder="Add more detail…"
            />
          </div>

          <div className="field">
            <div className="field-label">Tags</div>
            {card.tags.length > 0 && (
              <div className="drawer-tags">
                {card.tags.map((t) => (
                  <TagChip
                    key={t}
                    tag={t}
                    removable
                    onRemove={() => removeTag(t)}
                  />
                ))}
              </div>
            )}
            <input
              className="tag-input"
              value={tagInput}
              placeholder="Add a tag, press Enter"
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagInput);
                } else if (e.key === "Backspace" && !tagInput && card.tags.length) {
                  removeTag(card.tags[card.tags.length - 1]);
                }
              }}
            />
            {suggestions.length > 0 && (
              <div className="tag-suggest">
                {suggestions.map((t) => (
                  <button
                    key={t}
                    className={`chip t-${tagTone(t)} click`}
                    onClick={() => addTag(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <div className="field-label">Attachments</div>
            {card.attachments.length > 0 && (
              <div className="attach-list">
                {card.attachments.map((a) => (
                  <div className="attach-row" key={a.id}>
                    <IconPaperclip className="attach-icon" />
                    <a
                      className="attach-name"
                      href={files.url(a.id)}
                      target="_blank"
                      rel="noreferrer"
                      download={a.name}
                      title={a.name}
                    >
                      {a.name}
                    </a>
                    <span className="attach-size">{formatBytes(a.size)}</span>
                    <button
                      className="icon-btn"
                      aria-label={`Remove ${a.name}`}
                      onClick={() => removeAttachment(card.id, a.id)}
                    >
                      <IconClose />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              className="btn ghost sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <IconPaperclip />
              {uploading ? "Uploading…" : "Add file"}
            </button>
            {uploadError && <div className="attach-error">{uploadError}</div>}
          </div>

          <div className="meta-grid">
            <div>
              <div className="field-label">Created</div>
              <div className="meta-val">{fullDate(card.created_at)}</div>
            </div>
            <div>
              <div className="field-label">Completed</div>
              <div className="meta-val">{fullDate(card.done_at)}</div>
            </div>
          </div>
        </div>

        <div className="drawer-foot">
          {confirming ? (
            <div className="confirm-row">
              <span>Delete this card?</span>
              <button className="btn ghost sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="btn danger sm" onClick={() => deleteCard(card.id)}>
                Delete
              </button>
            </div>
          ) : (
            <button className="btn ghost sm danger-ghost" onClick={() => setConfirming(true)}>
              <IconTrash />
              Delete card
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
