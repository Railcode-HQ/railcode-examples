import { useState } from "react";
import { DataTable } from "./DataTable";
import { ChartIcon, ChevronIcon, DatabaseIcon } from "./Icons";
import { TOOL_LABELS } from "@/lib/tools";
import type { ToolStep } from "@/lib/types";

/** A single tool invocation, shown inline in the transcript.
 *
 *  Showing the exact query and its result is the difference between "the model
 *  said 3" and "the model ran this and got 3" — the user can audit the answer
 *  without leaving the chat. Successful steps collapse by default so a long
 *  answer stays readable; failures start open because they need attention. */

export function ToolCard({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(step.status === "error");
  const isPostgres = step.tool === "query_postgres";

  const summary = (() => {
    if (step.status === "running") return "running…";
    if (step.status === "error") return "failed";
    if (step.rowcount !== null) {
      return `${step.rowcount} ${step.rowcount === 1 ? "row" : "rows"}`;
    }
    return "done";
  })();

  return (
    <div className={`tool-card ${step.status}`}>
      <button
        type="button"
        className="tool-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`tool-chevron${open ? " open" : ""}`}>
          <ChevronIcon size={13} />
        </span>
        <span className="tool-icon">
          {isPostgres ? <DatabaseIcon size={14} /> : <ChartIcon size={14} />}
        </span>
        <span className="tool-name">{TOOL_LABELS[step.tool]}</span>
        <span className={`led ${step.status}`} aria-hidden="true" />
        <span className="tool-summary">{summary}</span>
        {step.ms !== null ? <span className="tool-ms mono tab">{step.ms}ms</span> : null}
      </button>

      {open ? (
        <div className="tool-body">
          {step.thought ? <p className="tool-thought">{step.thought}</p> : null}

          {step.detail ? (
            <pre className="tool-detail mono">
              <code>{step.detail}</code>
            </pre>
          ) : null}

          {step.status === "error" && step.error ? (
            <div className="tool-error">{step.error}</div>
          ) : null}

          {step.rows ? <DataTable rows={step.rows} columns={step.columns} /> : null}

          {!step.rows && step.raw ? (
            <pre className="tool-raw mono">
              <code>{step.raw}</code>
            </pre>
          ) : null}

          {step.truncated ? (
            <div className="tool-note">
              The database truncated this result set — add a tighter filter for the full picture.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
