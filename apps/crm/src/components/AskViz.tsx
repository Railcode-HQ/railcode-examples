// What the agent draws in the chat.
//
// Deliberately built from the same primitives as the rest of the CRM — the
// funnel bars from Home, the data table from Contacts, the stat tiles from the
// design system — so a generated answer looks like part of the app rather than
// a chat widget bolted on.

import { useRef } from "react";

import { EntityType, Tone, formatMoney, priorityMeta, stage } from "@/lib/crm";
import { RecordLink, TableFormat, Viz, VizChart, VizStats, VizTable } from "@/lib/ask";
import { View, useCrmStore } from "@/store/crm-store";

/** Opening a record from the chat also switches the active list, so the
 *  sidebar, the breadcrumb and the record's own back link all agree about
 *  where you are. The conversation itself is kept in its own store, so coming
 *  back to Ask AI resumes exactly where you left it. */
const PARENT_VIEW: Record<EntityType, View> = {
  company: "companies",
  contact: "contacts",
  deal: "pipeline",
};

function useOpenRecord(): (link: { type: EntityType; id: string }) => void {
  const setView = useCrmStore((s) => s.setView);
  const openRecord = useCrmStore((s) => s.openRecord);
  return (link) => {
    setView(PARENT_VIEW[link.type]);
    openRecord(link.type, link.id);
  };
}

export function AskViz({ viz }: { viz: Viz }) {
  if (viz.kind === "table") return <AskTable viz={viz} />;
  if (viz.kind === "chart") return <AskChart viz={viz} />;
  return <AskStats viz={viz} />;
}

// --- table -----------------------------------------------------------------

const NUMERIC: TableFormat[] = ["money", "number"];

function AskTable({ viz }: { viz: VizTable }) {
  const open = useOpenRecord();

  return (
    <div className="askviz">
      {viz.title ? <div className="askviz-h">{viz.title}</div> : null}
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              {viz.columns.map((col, i) => (
                <th key={i} className={NUMERIC.includes(col.format ?? "text") ? "num" : undefined}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {viz.rows.map((row, r) => (
              <TableRow key={r} row={row} columns={viz.columns} onOpen={open} />
            ))}
          </tbody>
        </table>
      </div>
      {viz.rows.length === 0 ? <div className="askviz-empty">No rows.</div> : null}
      {viz.note ? <div className="askviz-note">{viz.note}</div> : null}
    </div>
  );
}

/** A table row that opens its record on click — but never at the cost of
 *  selecting text: a drag- or double-click selection wins over navigation, so
 *  cell values stay copyable. */
function TableRow({
  row,
  columns,
  onOpen,
}: {
  row: VizTable["rows"][number];
  columns: VizTable["columns"];
  onOpen: (link: RecordLink) => void;
}) {
  const timer = useRef<number>(0);
  const link = row.link;

  const activate = link
    ? {
        onClick: () => {
          // A range selection means the user is copying, not navigating.
          if ((window.getSelection()?.toString().length ?? 0) > 0) return;
          // Defer so a double-click (selecting a word) can cancel the open.
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => onOpen(link), 200);
        },
        onDoubleClick: () => window.clearTimeout(timer.current),
      }
    : {};

  return (
    <tr className={link ? undefined : "static"} {...activate}>
      {row.cells.map((cell, c) => (
        <Cell key={c} value={cell} format={columns[c]?.format ?? "text"} lead={c === 0} />
      ))}
    </tr>
  );
}

function Cell({
  value,
  format,
  lead,
}: {
  value: string;
  format: TableFormat;
  lead: boolean;
}) {
  if (format === "stage") {
    const meta = stage(normalizeStage(value));
    return (
      <td>
        <span className="mode">
          <span className={`led ${meta.tone}`} />
          {meta.label}
        </span>
      </td>
    );
  }

  if (format === "priority") {
    const meta = priorityMeta(normalizePriority(value));
    return (
      <td>
        <span className={`pbadge t-${meta.tone}`}>{meta.label}</span>
      </td>
    );
  }

  if (format === "money") {
    // The model is asked for plain numbers, but it often sends "$40,000"
    // already formatted — reformat what parses, pass through what doesn't.
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    return (
      <td className="num tab">
        {value === "" ? "—" : Number.isFinite(parsed) ? formatMoney(parsed) : value}
      </td>
    );
  }

  if (format === "number") {
    return <td className="num tab">{value === "" ? "—" : value}</td>;
  }

  if (format === "date") {
    return <td className="muted tab">{value || "—"}</td>;
  }

  return (
    <td className={lead ? "askviz-lead" : "muted"}>{value === "" ? "—" : value}</td>
  );
}

function normalizeStage(value: string) {
  const key = value.trim().toLowerCase();
  return (["new", "qualified", "demo", "closing", "won", "lost"].includes(key)
    ? key
    : "new") as Parameters<typeof stage>[0];
}

function normalizePriority(value: string) {
  const match = value.trim().toLowerCase().match(/p?([0-4])/);
  return (match ? `p${match[1]}` : "p2") as Parameters<typeof priorityMeta>[0];
}

// --- chart -----------------------------------------------------------------

/** Tones cycle when the model doesn't pick them, so a chart is never one flat
 *  colour and never a rainbow either. */
const CYCLE: Tone[] = ["accent", "violet", "amber", "green", "red", "dim"];

function AskChart({ viz }: { viz: VizChart }) {
  const max = Math.max(1, ...viz.series.map((p) => Math.abs(p.value)));
  const format = (value: number) =>
    viz.format === "money" ? formatMoney(value) : value.toLocaleString("en-US");

  return (
    <div className="askviz">
      {viz.title ? <div className="askviz-h">{viz.title}</div> : null}
      <div className="funnel askviz-chart">
        {viz.series.map((point, i) => {
          const tone = point.tone ?? CYCLE[i % CYCLE.length];
          return (
            <div className="funrow" key={i}>
              <span className="funlabel" title={point.label}>
                <span className={`led ${tone}`} />
                {point.label}
              </span>
              <div className="funtrack">
                <div
                  className={`funfill ${tone}`}
                  style={{ width: `${(Math.abs(point.value) / max) * 100}%` }}
                />
              </div>
              <span className="funval tab">{format(point.value)}</span>
            </div>
          );
        })}
      </div>
      {viz.note ? <div className="askviz-note">{viz.note}</div> : null}
    </div>
  );
}

// --- stats -----------------------------------------------------------------

function AskStats({ viz }: { viz: VizStats }) {
  return (
    <div className="askviz">
      {viz.title ? <div className="askviz-h">{viz.title}</div> : null}
      <div className="stats askviz-stats">
        {viz.stats.map((item, i) => (
          <div className="stat" key={i}>
            <div className="top">
              <span className="lbl">{item.label}</span>
              {item.tone ? <span className={`led ${item.tone}`} /> : null}
            </div>
            <div className="num">{item.value}</div>
            {item.hint ? <div className="delta">{item.hint}</div> : null}
          </div>
        ))}
      </div>
      {viz.note ? <div className="askviz-note">{viz.note}</div> : null}
    </div>
  );
}

// --- record chips ----------------------------------------------------------

/** The clickable records a tool touched or found. Turning an id into a link is
 *  what keeps the agent honest: the person can go check. */
export function RecordChips({ links }: { links: RecordLink[] }) {
  const open = useOpenRecord();
  if (!links.length) return null;
  return (
    <div className="askchips">
      {links.map((link) => (
        <button
          key={`${link.type}-${link.id}`}
          className={`askchip ${link.type}`}
          onClick={() => open(link)}
          title={`Open ${link.label}`}
        >
          {link.label}
        </button>
      ))}
    </div>
  );
}
