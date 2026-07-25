import { AlertTriangle, Clock, ScanLine } from "lucide-react";

import { formatDateTime, isStale, relativeTime, ScoutState } from "@/lib/proposals";

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
        </div>
        <div className="rs-sub">
          Its first run marks every existing meeting as already handled, then watches for new
          ones. Nothing is drafted from your back catalogue.
        </div>
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
          One proposal per run keeps each inside its time limit — the next check picks up the
          next meeting.
        </div>
      ) : null}

      {stale && !failed ? (
        <div className="rs-sub">
          That&apos;s longer ago than the 30-minute schedule implies. Check the agent&apos;s
          schedule with <span className="mono">railcode agent schedule show proposal-writer</span>.
        </div>
      ) : null}
    </div>
  );
}
