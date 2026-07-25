import { AlertTriangle, Clock, Loader2, Play, ScanLine } from "lucide-react";

import { formatDateTime, isStale, relativeTime, ScoutState } from "@/lib/proposals";
import { useProposalStore } from "@/store/proposal-store";

/**
 * Run now.
 *
 * The schedule is still what normally triggers the agent; this is for the wait,
 * which can be 30 minutes and is worst exactly when you care — you have just got
 * off the call that asked for the proposal. It lives in this panel rather than
 * the toolbar because this is where "when did it last look?" is answered, and
 * "look again" is the reply to that question.
 *
 * It is disabled for a run started in ANY tab, not just this one. Two runs
 * overlapping is the one duplicate the agent's ledger can't prevent.
 */
function RunNow() {
  const { manualRun, starting, runNow } = useProposalStore();
  const busy = starting || Boolean(manualRun);

  return (
    <button
      className="btn ghost sm rs-run"
      disabled={busy}
      onClick={() => void runNow()}
      title={busy ? "A run is already going" : "Check for new meetings now"}
    >
      {busy ? <Loader2 size={14} className="icon-spin" /> : <Play size={14} />}
      {busy ? "Checking…" : "Run now"}
    </button>
  );
}

/** What a run in flight is actually doing, for the person who is now waiting on it. */
function RunningNote() {
  const { manualRun, identity } = useProposalStore();
  if (!manualRun) return null;

  const other =
    manualRun.startedBy && manualRun.startedBy !== identity?.user.name
      ? `${manualRun.startedBy} started a check. `
      : "";

  return (
    <div className="rs-sub">
      {other}Reading your recent meetings and drafting at most one proposal — a couple of minutes,
      and it finishes whether or not this tab stays open.
    </div>
  );
}

/**
 * The agent's heartbeat.
 *
 * A scheduled agent is invisible by default: an empty screen means "nothing
 * qualified" and "the schedule was never created" look exactly alike. This
 * panel is the difference, so it renders on every run outcome — including the
 * quiet ones — rather than only when something happened.
 */
export function AgentStatus({ scout }: { scout: ScoutState | null }) {
  if (!scout?.lastRunAt) {
    return (
      <div className="run-status col">
        <div className="rs-top">
          <Clock size={15} />
          <span>The agent hasn&apos;t run yet</span>
          <RunNow />
        </div>
        <div className="rs-sub">
          Its first run marks every existing meeting as already handled, then watches for new
          ones. Nothing is drafted from your back catalogue.
        </div>
        <RunningNote />
      </div>
    );
  }

  const stale = isStale(scout);
  const failed = scout.outcome === "error";
  const skipped = scout.skipped ?? [];

  return (
    <div className={`run-status col${failed ? " error" : ""}`}>
      <div className="rs-top">
        {failed ? <AlertTriangle size={15} /> : <ScanLine size={15} />}
        <span>
          {failed ? "Last run failed" : "Checked"} {relativeTime(scout.lastRunAt)}
          {typeof scout.scanned === "number" && !failed ? (
            <span className="tick">
              {" "}
              · {scout.scanned} meeting{scout.scanned === 1 ? "" : "s"} scanned
            </span>
          ) : null}
          {scout.pending ? <span className="tick"> · {scout.pending} queued</span> : null}
        </span>
        <RunNow />
      </div>

      {failed && scout.error ? <div className="rs-sub">{scout.error}</div> : null}

      {scout.outcome === "bootstrap" && scout.bootstrappedAt ? (
        <div className="rs-sub">
          Watching from {formatDateTime(scout.bootstrappedAt)}. Meetings from before then were
          marked as already handled, so nothing old gets drafted.
        </div>
      ) : null}

      {/* Why nothing was drafted is the question this panel exists to answer. */}
      {!failed && skipped.length ? (
        <div className="rs-sub">
          Passed over: {skipped.map((s) => `${s.title} (${s.reason})`).join(" · ")}
        </div>
      ) : null}

      {scout.pending ? (
        <div className="rs-sub">
          One proposal per run keeps each inside its time limit — Run now, or the next check,
          picks up the next meeting.
        </div>
      ) : null}

      {stale && !failed ? (
        <div className="rs-sub">
          That&apos;s longer ago than the 30-minute schedule implies. Check the agent&apos;s
          schedule with <span className="mono">railcode agent schedule show proposal-writer</span>.
        </div>
      ) : null}

      <RunningNote />
    </div>
  );
}
