import { useState } from "react";

/** Renders a tool's result rows. Postgres and PostHog results are both reshaped
 *  into row objects upstream, so one table serves both. */

const INITIAL_ROWS = 8;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  // ISO timestamps are the common case in this dataset and are unreadable at
  // full precision in a dense table.
  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(text);
  return iso ? `${iso[1]} ${iso[2]}` : text;
}

/** Postgres returns `numeric`/`bigint` as strings to preserve precision, so a
 *  column of averages arrives as "0.47" and would left-align next to integer
 *  counts. Align on what the value *is*, not on its JS type. */
function isNumeric(value: unknown): boolean {
  if (typeof value === "number") return true;
  if (typeof value === "string") return /^-?\d+(\.\d+)?$/.test(value.trim());
  return false;
}

export function DataTable({
  rows,
  columns,
}: {
  rows: Record<string, unknown>[];
  columns: string[] | null;
}) {
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) {
    return <div className="tool-empty">No rows returned.</div>;
  }

  const cols = columns && columns.length > 0 ? columns : Object.keys(rows[0]);
  const visible = expanded ? rows : rows.slice(0, INITIAL_ROWS);
  const hidden = rows.length - visible.length;

  return (
    <div className="table-block">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {cols.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={index}>
                {cols.map((col) => (
                  <td key={col} className={isNumeric(row[col]) ? "num tab" : undefined}>
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? (
        <button type="button" className="table-more" onClick={() => setExpanded(true)}>
          Show {hidden} more {hidden === 1 ? "row" : "rows"}
        </button>
      ) : null}
      {expanded && rows.length > INITIAL_ROWS ? (
        <button type="button" className="table-more" onClick={() => setExpanded(false)}>
          Collapse
        </button>
      ) : null}
    </div>
  );
}
