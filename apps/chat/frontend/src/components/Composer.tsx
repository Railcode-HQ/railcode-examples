import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { CloseIcon, FileIcon, PaperclipIcon, SendIcon, StopIcon } from "./Icons";
import { formatBytes } from "@/lib/attachments";
import { useChatStore } from "@/store/chat-store";

const MAX_TEXTAREA_PX = 200;

const COMPACT_QUERY = "(max-width: 560px)";

/** The textarea auto-sizes to its *content*, and browsers don't count the
 *  placeholder in `scrollHeight` — so a placeholder that wraps to two lines gets
 *  clipped in a one-line box. Shorten it instead of growing the empty composer. */
function useCompactPlaceholder(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia(COMPACT_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return compact;
}

export function Composer() {
  const [value, setValue] = useState("");
  const [dragging, setDragging] = useState(false);
  const compact = useCompactPlaceholder();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const busy = useChatStore((s) => s.busy);
  const pending = useChatStore((s) => s.pending);
  const uploading = useChatStore((s) => s.uploading);
  const activeId = useChatStore((s) => s.activeId);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const addFiles = useChatStore((s) => s.addFiles);
  const removePending = useChatStore((s) => s.removePending);

  // Grow with content up to a cap, then scroll internally.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [value]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeId]);

  const canSend = (value.trim().length > 0 || pending.length > 0) && !busy && !uploading;

  const submit = () => {
    if (!canSend) return;
    const text = value;
    setValue("");
    void send(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) void addFiles(event.target.files);
    event.target.value = "";
  };

  // Depth counting keeps the overlay stable while dragging over child elements,
  // which otherwise fire dragleave constantly.
  const onDragEnter = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (event.dataTransfer.files?.length) void addFiles(event.dataTransfer.files);
  };

  return (
    <div
      className={`composer${dragging ? " dragging" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging ? <div className="drop-veil">Drop files to attach</div> : null}

      {pending.length > 0 ? (
        <div className="pending-row">
          {pending.map((att) => (
            <span className="pending-chip" key={att.id}>
              <FileIcon size={13} />
              <span className="attach-name">{att.name}</span>
              <span className="attach-size mono">{formatBytes(att.size)}</span>
              <button
                type="button"
                className="chip-x"
                onClick={() => void removePending(att.id)}
                aria-label={`Remove ${att.name}`}
              >
                <CloseIcon size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="composer-box">
        <button
          type="button"
          className="icon-btn attach-btn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          aria-label="Attach files"
          title="Attach files"
        >
          <PaperclipIcon size={17} />
        </button>

        <input
          ref={fileRef}
          type="file"
          multiple
          className="file-input"
          onChange={onPick}
          aria-hidden="true"
          tabIndex={-1}
        />

        <textarea
          ref={textareaRef}
          className="composer-input"
          rows={1}
          placeholder={
            uploading
              ? "Uploading…"
              : compact
                ? "Ask about your data…"
                : "Ask about your customers, tickets, or product analytics…"
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const dropped = Array.from(e.clipboardData.files);
            if (dropped.length > 0) {
              e.preventDefault();
              void addFiles(dropped);
            }
          }}
        />

        {busy ? (
          <button type="button" className="send-btn stop" onClick={stop} title="Stop generating">
            <StopIcon size={15} />
          </button>
        ) : (
          <button
            type="button"
            className="send-btn"
            onClick={submit}
            disabled={!canSend}
            title="Send (Enter)"
            aria-label="Send"
          >
            <SendIcon size={16} />
          </button>
        )}
      </div>

      <div className="composer-hint">
        <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
      </div>
    </div>
  );
}
