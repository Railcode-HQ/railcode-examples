// One turn in the transcript.
//
// Steps render in the order the model made them, so the reasoning reads
// top-down: the lookups it ran, anything it drew, then the written answer. The
// prompt asks for render_* calls before the prose, which puts the table or
// chart directly above the sentence interpreting it.

import { AlertTriangle } from "lucide-react";

import { ApprovalPanel, AskToolCard } from "@/components/AskToolCard";
import { AskViz } from "@/components/AskViz";
import { Markdown } from "@/components/Markdown";
import { AskMessage as AskMessageType, AskStep, Approval } from "@/lib/ask";

export function AskTurn({
  message,
  streaming = false,
  orphanApprovals = [],
}: {
  message: AskMessageType;
  streaming?: boolean;
  /** Parked writes the SDK hasn't reported a step for yet — rare, but the
   *  decision must never be invisible. */
  orphanApprovals?: Approval[];
}) {
  if (message.role === "user") {
    return (
      <div className="askturn user">
        <div className="askbubble">{message.content}</div>
      </div>
    );
  }

  // A running tool shows its own spinner and streamed prose shows a caret; this
  // covers the dead air between — the model thinking before the first step, and
  // composing the next tool call (e.g. a big table) or the answer after one.
  const tail = message.steps[message.steps.length - 1];
  const tailBusy = !!tail && (tail.status === "running" || tail.status === "awaiting");
  const awaiting =
    orphanApprovals.length > 0 || message.steps.some((s) => s.status === "awaiting");
  const showActivity = streaming && !tailBusy && !awaiting && !message.content.trim();

  return (
    <div className="askturn ai">
      {message.steps.map((step) => (
        <StepBlock key={step.id} step={step} />
      ))}

      {orphanApprovals.map((approval) => (
        <ApprovalPanel key={approval.id} approval={approval} />
      ))}

      {message.content.trim() ? (
        <div className="askprose">
          <Markdown text={message.content} />
          {streaming ? <span className="askcaret" /> : null}
        </div>
      ) : null}

      {showActivity ? (
        <div className="askthinking">
          <span className="spin sm" />
          {message.steps.length ? "Working…" : "Thinking…"}
        </div>
      ) : null}

      {message.error ? (
        <div className="askerror">
          <AlertTriangle size={14} />
          <span>{message.error}</span>
        </div>
      ) : null}

      {message.note ? <div className="asknote">{message.note}</div> : null}
    </div>
  );
}

function StepBlock({ step }: { step: AskStep }) {
  const viz = step.outcome?.viz;
  if (viz && step.status === "ok") return <AskViz viz={viz} />;
  return <AskToolCard step={step} />;
}
