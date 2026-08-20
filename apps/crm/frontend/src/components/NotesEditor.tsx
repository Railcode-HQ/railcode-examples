import { useLayoutEffect, useRef, useState } from "react";

/**
 * The notes field on a record: a Markdown editor that styles what you type as
 * you type it. Write `# ` and the line is a heading from that keystroke on;
 * `- ` makes a bullet, `> ` a quote.
 *
 * It's a live-preview editor, not a rich-text one — the Markdown stays in the
 * text, so what's stored is exactly what's on screen and nothing has to be
 * serialised back out. Long notes collapse behind Show all.
 *
 * How the caret survives: the element is uncontrolled while you type. React
 * renders it empty and never owns its children; typing mutates the DOM the
 * browser already manages, and `onInput` only ever rewrites each line's
 * *class*. Class changes don't touch text nodes, so the caret never moves.
 * Content is repainted from `value` only when the change came from elsewhere.
 */

/** Height a collapsed note is cut off at, in px — roughly ten lines. */
const COLLAPSED_MAX = 240;

/**
 * `plaintext-only` is what keeps a browser from turning ⌘B and pasted HTML into
 * markup we'd have to strip back out. Everything current supports it; the
 * fallback is a plain editable box, which the paste handler covers anyway.
 */
const PLAINTEXT_ONLY = (() => {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("div");
  probe.setAttribute("contenteditable", "plaintext-only");
  return probe.contentEditable === "plaintext-only";
})();

type LineKind =
  | "h1"
  | "h2"
  | "h3"
  | "quote"
  | "task"
  | "bullet"
  | "ordered"
  | "code"
  | "rule"
  | "text";

/** What a line looks like it wants to be, from its Markdown prefix alone. */
function kindOf(line: string): LineKind {
  if (/^#\s/.test(line)) return "h1";
  if (/^##\s/.test(line)) return "h2";
  if (/^#{3,6}\s/.test(line)) return "h3";
  if (/^\s*>\s?/.test(line)) return "quote";
  if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(line)) return "task";
  if (/^\s*[-*+]\s/.test(line)) return "bullet";
  if (/^\s*\d+[.)]\s/.test(line)) return "ordered";
  if (/^\s*(```|~~~)/.test(line)) return "code";
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return "rule";
  return "text";
}

function linesOf(value: string): string[] {
  const text = value.replace(/\r\n/g, "\n");
  return text.length ? text.split("\n") : [""];
}

/** One line of the document. Empty lines need the <br> or they collapse flat. */
function lineElement(text: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `mdline ${kindOf(text)}`;
  if (text) div.textContent = text;
  else div.appendChild(document.createElement("br"));
  return div;
}

/**
 * Re-labels every line in place. Touches classes only — never text, never the
 * caret. Anything the browser left outside a line element (a bare <br>, a loose
 * text node) is skipped: it still reads correctly, it just isn't styled until
 * the next repaint tidies it up.
 */
function paintLines(host: HTMLElement) {
  for (const child of Array.from(host.children)) {
    if (!(child instanceof HTMLElement) || child.tagName === "BR") continue;
    const next = `mdline ${kindOf(child.textContent ?? "")}`;
    if (child.className !== next) child.className = next;
  }
}

export function NotesEditor({
  value,
  placeholder,
  onChange,
  ariaLabel = "Notes",
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [tall, setTall] = useState(false);

  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    // Only repaint the text when `value` came from somewhere other than this
    // editor — a repaint mid-keystroke would drop the caret to the start. An
    // empty note still needs its one line element, or the first character typed
    // lands in a bare text node with no line to style.
    if (host.innerText !== value || !host.firstElementChild) {
      host.replaceChildren(...linesOf(value).map(lineElement));
    }
    paintLines(host);
    setTall(host.scrollHeight > COLLAPSED_MAX + 8);
  }, [value]);

  function onInput() {
    const host = ref.current;
    if (!host) return;
    paintLines(host);
    onChange(host.innerText);
  }

  /** Paste arrives as text, and as one undoable step — hence execCommand. */
  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    document.execCommand(
      "insertText",
      false,
      e.clipboardData.getData("text/plain"),
    );
  }

  const collapsed = tall && !expanded;

  return (
    <div className={`mdedit-wrap${collapsed ? " collapsed" : ""}`}>
      {value.trim() ? null : <div className="mdedit-ph">{placeholder}</div>}

      <div
        ref={ref}
        className="mdedit"
        contentEditable={PLAINTEXT_ONLY ? "plaintext-only" : true}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        spellCheck
        style={collapsed ? { maxHeight: COLLAPSED_MAX } : undefined}
        // Editing something you can't see is worse than a long page.
        onFocus={() => setExpanded(true)}
        onInput={onInput}
        onPaste={onPaste}
      />

      {tall ? (
        <button
          type="button"
          className="link mdedit-more"
          onClick={() => {
            if (expanded) ref.current?.blur();
            setExpanded((e) => !e);
          }}
        >
          {expanded ? "Show less" : "Show all"}
        </button>
      ) : null}
    </div>
  );
}
