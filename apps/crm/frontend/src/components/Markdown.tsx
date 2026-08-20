// Minimal Markdown -> React renderer (headings, bold/italic, bullet lists,
// paragraphs). Builds React elements directly instead of dangerouslySetInnerHTML
// so content can never inject HTML — call notes are shared org-wide, so this is
// untrusted input as far as other viewers are concerned.

import { Fragment, ReactNode } from "react";

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "list"; items: ListItem[] }
  | { type: "paragraph"; text: string };

type ListItem = { text: string; ordered: boolean; children: ListItem[] };

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  if (!blocks.length) {
    return (
      <p className="faint" style={{ fontSize: 12.5 }}>
        No notes for this meeting.
      </p>
    );
  }
  return (
    <div className="md">
      {blocks.map((b, i) => (
        <Fragment key={i}>{renderBlock(b)}</Fragment>
      ))}
    </div>
  );
}

function renderBlock(block: Block): ReactNode {
  if (block.type === "heading") {
    const Tag = (`h${Math.min(block.level + 2, 6)}` as unknown) as "h3" | "h4" | "h5" | "h6";
    return <Tag>{renderInline(block.text)}</Tag>;
  }
  if (block.type === "list") {
    return <List items={block.items} />;
  }
  return <p>{renderInline(block.text)}</p>;
}

function List({ items }: { items: ListItem[] }) {
  // Sibling items share a marker type; the first one decides the tag.
  const Tag = items[0]?.ordered ? "ol" : "ul";
  return (
    <Tag>
      {items.map((item, i) => (
        <li key={i}>
          {renderInline(item.text)}
          {item.children.length ? <List items={item.children} /> : null}
        </li>
      ))}
    </Tag>
  );
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  // stack of open list items by indent level, deepest last
  let listStack: { indent: number; item: ListItem }[] = [];
  let rootItems: ListItem[] = [];

  function flushParagraph() {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  }
  function flushList() {
    if (rootItems.length) blocks.push({ type: "list", items: rootItems });
    listStack = [];
    rootItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^(#{1,6})\s+(.*)/);
    // A bullet ("- "/"* ") or an ordered marker ("1." / "2)").
    const bullet = line.match(/^(\s*)([-*]|\d+[.)])\s+(.*)/);

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    if (bullet) {
      flushParagraph();
      const indent = bullet[1].length;
      const ordered = /\d/.test(bullet[2]);
      const item: ListItem = { text: bullet[3].trim(), ordered, children: [] };
      while (listStack.length && listStack[listStack.length - 1].indent >= indent) {
        listStack.pop();
      }
      if (listStack.length) {
        listStack[listStack.length - 1].item.children.push(item);
      } else {
        rootItems.push(item);
      }
      listStack.push({ indent, item });
      continue;
    }

    // Indented continuation line: append to the deepest open list item if any,
    // otherwise treat as a normal paragraph line.
    if (listStack.length && /^\s+\S/.test(rawLine)) {
      const top = listStack[listStack.length - 1].item;
      top.text = `${top.text} ${line.trim()}`;
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/**
 * Only http(s) and same-origin relative paths become anchors.
 *
 * This renderer also draws call notes, which are shared org-wide and therefore
 * untrusted as far as any other viewer is concerned — a `javascript:` href would be
 * a stored XSS with a friendly label on it. Anything else falls back to plain text.
 */
function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^\/[^/]/.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function renderInline(text: string): ReactNode[] {
  // Links are resolved before emphasis so a URL containing * or _ can't be
  // mangled into italics halfway through.
  const out: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const at = match.index ?? 0;
    if (at > cursor) out.push(...renderEmphasis(text.slice(cursor, at), `t${key}`));
    const href = safeHref(match[2]);
    out.push(
      href ? (
        <a key={`a${key}`} className="mdlink" href={href} target="_blank" rel="noreferrer">
          {match[1]}
        </a>
      ) : (
        <Fragment key={`a${key}`}>{match[0]}</Fragment>
      ),
    );
    cursor = at + match[0].length;
    key += 1;
  }
  if (cursor < text.length) out.push(...renderEmphasis(text.slice(cursor), `t${key}`));
  return out;
}

function renderEmphasis(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.flatMap((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return [<strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>];
    }
    return part.split(/(\*[^*]+\*)/g).map((sub, j) => {
      if (sub.startsWith("*") && sub.endsWith("*") && sub.length > 2) {
        return <em key={`${keyBase}-${i}-${j}`}>{sub.slice(1, -1)}</em>;
      }
      return <Fragment key={`${keyBase}-${i}-${j}`}>{sub}</Fragment>;
    });
  });
}
