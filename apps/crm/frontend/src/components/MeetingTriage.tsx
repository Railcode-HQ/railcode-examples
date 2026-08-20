import { CalendarClock, Check, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { TRIAGE_WINDOW_DAYS } from "@/lib/automations";
import { useCrmStore } from "@/store/crm-store";
import { useGranolaStore } from "@/store/granola-store";
import { useTriageStore } from "@/store/triage-store";

/**
 * The front door: recent meetings that aren't in the CRM yet, each one a click away
 * from becoming a deal or being dismissed for good.
 *
 * These come straight from Granola rather than from the CRM's call notes, and that's
 * the point — the background sync only imports meetings whose attendees already match
 * a known contact, so a first conversation with a new prospect never lands anywhere.
 * Those are exactly the ones worth triaging.
 */
/** Meetings shown before the list collapses behind "Show all". */
const TRIAGE_PREVIEW = 5;

export function MeetingTriage() {
  const { connected, openConnect } = useGranolaStore();
  const { callNotes } = useCrmStore();
  const {
    meetings,
    loading,
    loaded,
    notice,
    triage,
    bootstrap,
    refresh,
    dismiss,
    undoDismiss,
    openProposal,
    clearNotice,
  } = useTriageStore();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void (async () => {
      await bootstrap();
      await refresh();
    })();
  }, [bootstrap, refresh]);

  if (connected === false) {
    return (
      <div className="sect">
        <div className="sh">
          <h2>Recent meetings</h2>
        </div>
        <p className="faint" style={{ fontSize: 12.5 }}>
          <button className="link" onClick={openConnect}>
            Connect Granola
          </button>{" "}
          to turn your calls into deals from here.
        </p>
      </div>
    );
  }

  const lastDismissed = notice
    ? Object.values(triage)
        .filter((t) => t.status === "dismissed")
        .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1))[0]
    : undefined;

  const inCrm = new Set(callNotes.map((n) => n.meetingId));
  const visible = showAll ? meetings : meetings.slice(0, TRIAGE_PREVIEW);

  return (
    <div className="sect">
      <div className="sh">
        <h2>Recent meetings</h2>
        <span className="hint">Last {TRIAGE_WINDOW_DAYS} days</span>
        <div className="spacer" style={{ flex: 1 }} />
        <button
          className={`iconbtn sm${loading ? " spinning" : ""}`}
          title="Check for new meetings"
          aria-label="Check for new meetings"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {notice ? (
        <div className="notice">
          <span>{notice}</span>
          {lastDismissed ? (
            <button
              className="link"
              onClick={() => void undoDismiss(lastDismissed.meetingId)}
            >
              Undo
            </button>
          ) : (
            <button className="link" onClick={clearNotice}>
              Dismiss
            </button>
          )}
        </div>
      ) : null}

      {!loaded || (loading && meetings.length === 0) ? (
        <TriageSkeleton />
      ) : meetings.length === 0 ? (
        <p className="faint" style={{ fontSize: 12.5 }}>
          Nothing new to triage. Meetings you dismiss don't come back.
        </p>
      ) : (
        <>
          <div className="rows triagerows">
            {visible.map((m) => (
              <div className="crow triagerow" key={m.id}>
                <span className="glyph mtg" style={{ width: 30, height: 30 }}>
                  <CalendarClock size={15} />
                </span>
                <div className="body">
                  <div className="cname" style={{ fontSize: 13 }}>
                    {m.title}
                    {inCrm.has(m.id) ? (
                      <span className="badge" title="Already imported as a call note">
                        <Check size={11} />
                        In CRM
                      </span>
                    ) : null}
                  </div>
                  <div className="meta">
                    {new Date(m.date).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                    {m.attendees ? ` · ${m.attendees}` : ""}
                  </div>
                </div>
                <div className="triageacts">
                  <button className="btn sm" onClick={() => void openProposal(m.id)}>
                    Create deal
                  </button>
                  <button
                    className="btn sm ghost"
                    title="Dismiss — won't come back"
                    aria-label={`Dismiss ${m.title}`}
                    onClick={() => void dismiss(m.id)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>

          {meetings.length > TRIAGE_PREVIEW ? (
            <button
              type="button"
              className={`cardmore${showAll ? " open" : ""}`}
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show fewer" : `Show all ${meetings.length}`}
              <ChevronDown size={13} />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The waiting state for the list above: the row drawn as placeholders rather
 * than a line of text, so the section holds the height it's about to fill and
 * meetings arrive into geometry the eye has already settled on.
 *
 * Three rows regardless of what lands — the count is a rhythm, not a promise,
 * and the widths vary so it reads as titles rather than a progress bar.
 */
function TriageSkeleton() {
  return (
    // The bars carry no text, so labelling the group is what a screen reader
    // has to go on.
    <div className="rows triageskel" role="status" aria-label="Looking for recent meetings">
      {[0, 1, 2].map((i) => (
        <div className="skelrow" key={i}>
          <span className="skelbar skelglyph" />
          <div className="body">
            <span className="skelbar skeltitle" />
            <span className="skelbar skelmeta" />
          </div>
          <div className="triageacts">
            <span className="skelbar skelbtn" />
            <span className="skelbar skelbtn ghost" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Shown while the extraction call is in flight, inside the proposal dialog. */
export function ProposalSpinner({ label }: { label: string }) {
  return (
    <div className="proposalwait">
      <Loader2 className="spinicon" size={18} />
      <span>{label}</span>
    </div>
  );
}
