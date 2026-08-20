import type { ReactNode } from "react";

/** A small markdown renderer.
 *
 *  Deliberately dependency-free: the model emits a predictable subset (headings,
 *  lists, tables, code, emphasis, links) and pulling a full CommonMark parser
 *  plus a sanitiser into a template app is a lot of weight for that. Everything
 *  is rendered as React elements — no `dangerouslySetInnerHTML` anywhere — so
 *  model output cannot inject markup. */

let keySeed = 0;
const nextKey = () => `md_${(keySeed += 1)}`;

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const parts = text.split(INLINE);

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      nodes.push(<strong key={nextKey()}>{part.slice(2, -2)}</strong>);
      continue;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      nodes.push(
        <code className="md-code" key={nextKey()}>
          {part.slice(1, -1)}
        </code>,
      );
      continue;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      nodes.push(<em key={nextKey()}>{part.slice(1, -1)}</em>);
      continue;
    }

    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = link[2];
      // Only http(s) — a model-authored `javascript:` URL must never become a
      // live link.
      if (/^https?:\/\//i.test(href)) {
        nodes.push(
          <a key={nextKey()} href={href} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(link[1]);
      }
      continue;
    }

    nodes.push(part);
  }

  return nodes;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const isTableDivider = (line: string) => /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.includes("-");

export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre className="md-pre" key={nextKey()} data-lang={lang || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Table: a header row followed by a --- divider
    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div className="md-table-wrap" key={nextKey()}>
          <table className="md-table">
            <thead>
              <tr>
                {header.map((cell) => (
                  <th key={nextKey()}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={nextKey()}>
                  {row.map((cell) => (
                    <td key={nextKey()}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = (["h3", "h3", "h4", "h5"] as const)[level - 1];
      blocks.push(
        <Tag className="md-h" key={nextKey()}>
          {renderInline(heading[2])}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\S]*$/.test(line) && line.trim().length >= 3) {
      blocks.push(<hr className="md-hr" key={nextKey()} />);
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote className="md-quote" key={nextKey()}>
          {renderInline(quote.join(" "))}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul className="md-list" key={nextKey()}>
          {items.map((item) => (
            <li key={nextKey()}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol className="md-list" key={nextKey()}>
          {items.map((item) => (
            <li key={nextKey()}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph — consume until a blank line or the start of another block.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p className="md-p" key={nextKey()}>
        {renderInline(para.join(" "))}
      </p>,
    );
  }

  return blocks;
}
