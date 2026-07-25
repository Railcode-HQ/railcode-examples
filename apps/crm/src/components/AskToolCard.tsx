// One tool call in the transcript, plus the approval gate for writes.
//
// Showing the call and its result is the difference between "the assistant said
// 12" and "the assistant ran this and got 12" — the person can audit an answer
// without leaving the chat. Reads collapse by default so a long answer stays
// readable; failures and anything waiting on a decision start open.

import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronRight,
  PenLine,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

import { RecordChips } from "@/components/AskViz";
import { AskStep, Approval, toolMeta } from "@/lib/ask";
import { useAskStore } from "@/store/ask-store";

export function AskToolCard({ step }: { step: AskStep }) {
  const approval = useAskStore((s) =>
    step.approvalId ? s.approvals.find((a) => a.id === step.approvalId) ?? null : null,
  );
  const [open, setOpen] = useState(step.status === "error");

  // A display tool's whole point is what it painted, which is rendered on its
  // own above — the call itself isn't worth a card.
  if (step.kind === "display" && step.status === "ok") return null;

  if (approval && approval.status === "pending") {
    return <ApprovalPanel approval={approval} />;
  }

  const meta = toolMeta(step.tool);
  const outcome = step.outcome;
  const declined = Boolean(outcome?.rejected);
  // The SDK settles the step a beat after the person approves; until it does,
  // the call really is running.
  const status = step.status === "awaiting" ? "running" : step.status;

  const summary = (() => {
    if (declined) return "declined";
    if (status === "running") return "running…";
    if (status === "error") return "failed";
    return outcome?.summary ?? "done";
  })();

  const detail = describeArgs(step.args);

  return (
    <div className={`askstep ${declined ? "declined" : status} k-${step.kind}`}>
      <button className="askstep-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`askstep-chev${open ? " open" : ""}`}>
          <ChevronRight size={13} />
        </span>
        <span className="askstep-icon">
          <KindIcon kind={step.kind} tool={step.tool} />
        </span>
        <span className="askstep-name">{meta.label}</span>
        {status === "running" ? (
          <span className="spin sm" />
        ) : (
          <span className={`led ${ledTone(status, declined)}`} />
        )}
        <span className="askstep-sum">{summary}</span>
        {/* A gated write's elapsed time is mostly however long the person took
            to decide, which says nothing about the app — so don't report it. */}
        {step.ms !== null && status === "ok" && !step.approvalId ? (
          <span className="askstep-ms tab">{step.ms}ms</span>
        ) : null}
      </button>

      {open ? (
        <div className="askstep-body">
          {detail ? <div className="askstep-args mono">{detail}</div> : null}

          {step.error ? <div className="askstep-err">{step.error}</div> : null}

          {outcome?.links?.length ? <RecordChips links={outcome.links} /> : null}

          {outcome?.data !== undefined ? (
            <pre className="askstep-data mono">
              <code>{preview(outcome.data)}</code>
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The gate. Nothing has been written when this renders — the tool's `run` is
 *  sitting on the promise these buttons resolve. */
export function ApprovalPanel({ approval }: { approval: Approval }) {
  const decide = useAskStore((s) => s.decide);
  const approveAll = useAskStore((s) => s.approveAll);
  const pendingCount = useAskStore(
    (s) => s.approvals.filter((a) => a.status === "pending").length,
  );

  return (
    <div className={`askapproval${approval.destructive ? " danger" : ""}`}>
      <div className="askapproval-top">
        <span className="askapproval-icon">
          {approval.destructive ? <Trash2 size={14} /> : <PenLine size={14} />}
        </span>
        <div className="askapproval-ttl">
          <div className="t">{approval.title}</div>
          <div className="s">{approval.subject}</div>
        </div>
        <span className="askapproval-tag">Needs your approval</span>
      </div>

      {approval.fields.length ? (
        <div className="askapproval-fields">
          {approval.fields.map((field, i) => (
            <div className="askapproval-row" key={i}>
              <span className="k">{field.label}</span>
              <span className="v">{field.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {approval.destructive ? (
        <div className="askapproval-warn">
          <AlertTriangle size={13} />
          This can't be undone.
        </div>
      ) : null}

      <div className="askapproval-acts">
        {pendingCount > 1 ? (
          <button className="btn ghost sm" onClick={approveAll}>
            Approve all {pendingCount}
          </button>
        ) : null}
        <div className="spacer" />
        <button className="btn ghost sm" onClick={() => decide(approval.id, false)}>
          <X size={14} />
          Reject
        </button>
        <button
          className={`btn sm${approval.destructive ? " danger" : ""}`}
          onClick={() => decide(approval.id, true)}
          autoFocus
        >
          <Check size={14} />
          {approval.destructive ? "Delete" : "Approve"}
        </button>
      </div>
    </div>
  );
}

function KindIcon({ kind, tool }: { kind: AskStep["kind"]; tool: string }) {
  if (kind === "write") {
    return tool === "delete_record" ? <Trash2 size={13} /> : <PenLine size={13} />;
  }
  if (kind === "display") return <BarChart3 size={13} />;
  return <Search size={13} />;
}

function ledTone(status: string, declined: boolean): string {
  if (declined) return "dim";
  if (status === "error") return "red";
  if (status === "ok") return "green";
  return "amber";
}

/** The call's arguments as one readable line: `stage: closing · limit: 10`. */
function describeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      parts.push(`${key}: [${value.length}]`);
      continue;
    }
    if (typeof value === "object") continue;
    const text = String(value);
    parts.push(`${key}: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`);
  }
  return parts.join("  ·  ");
}

const PREVIEW_CHARS = 4000;

function preview(data: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(data, null, 2) ?? String(data);
  } catch {
    text = String(data);
  }
  return text.length > PREVIEW_CHARS
    ? `${text.slice(0, PREVIEW_CHARS)}\n… truncated`
    : text;
}
