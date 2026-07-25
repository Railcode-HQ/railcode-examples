import { CalendarClock, Check, CloudDownload, RefreshCw, Search, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { formatDay, formatDateTime, relativeTime } from "@/lib/proposals";
import { useProposalStore } from "@/store/proposal-store";

function ElapsedTicker({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return (
    <span className="tick tab">
      {mm}:{String(ss).padStart(2, "0")}
    </span>
  );
}

export function Meetings() {
  const {
    meetings,
    materials,
    proposals,
    context,
    meetingQuery,
    job,
    importing,
    cronState,
    setContext,
    setMeetingQuery,
    refreshMeetings,
    importMeetings,
    draftFromMeeting,
    draftFromQuery,
    selectProposal,
  } = useProposalStore();

  const busy = job !== null;
  const noMaterials = materials.length === 0;
  const undrafted = meetings.filter((m) => !m.drafted);
  const drafted = meetings.filter((m) => m.drafted);

  return (
    <>
      <div className="phead">
        <div>
          <h1>Meetings</h1>
          <p>
            Pick a client call and draft a proposal from it — or let the nightly run do it for
            you.
          </p>
        </div>
        <div className="phead-actions">
          <button
            className="btn ghost sm"
            disabled={importing}
            onClick={() => void refreshMeetings()}
          >
            <RefreshCw size={14} className={importing ? "icon-spin" : undefined} />
            {importing ? "Checking…" : "Refresh from Granola"}
          </button>
        </div>
      </div>

      {cronState?.lastRunAt ? (
        <div className="cronline">
          Last automatic run {relativeTime(cronState.lastRunAt)}
          {cronState.drafted?.length
            ? ` · drafted ${cronState.drafted.length}`
            : " · nothing new to draft"}
          {cronState.skipped?.length ? ` · skipped ${cronState.skipped.length}` : ""}
        </div>
      ) : null}

      {busy ? (
        <div className="run-status col">
          <div className="rs-top">
            <span className="spin" />
            <span>{job?.label}</span>
            {job ? <ElapsedTicker since={job.startedAt} /> : null}
          </div>
          {job?.kind === "draft" ? (
            // Deliberately not a live step tracker: the run API reports status
            // only, so claiming to know the current phase would be invented.
            <div className="rs-sub">
              It reads the meeting notes, then your materials, then writes and renders the
              document. Usually one to three minutes — you can leave this page.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="sect">
        <div className="sh">
          <h2>Draft from a specific meeting</h2>
          <span className="hint">{undrafted.length} without a proposal</span>
        </div>
        <div style={{ padding: 18 }}>
          <div className="field">
            <span className="l">Focus for this proposal (optional)</span>
            <textarea
              className="textarea"
              placeholder="e.g. Lead with the migration timeline, use the enterprise rate card, keep phase 2 out of scope…"
              value={context}
              disabled={busy}
              onChange={(e) => setContext(e.target.value)}
            />
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <span className="l">Can&apos;t see the meeting below?</span>
            <div className="inline-form">
              <div className="input-icon">
                <Search size={14} />
                <input
                  className="input"
                  placeholder="Describe it — “the Acme call this morning”"
                  value={meetingQuery}
                  disabled={busy}
                  onChange={(e) => setMeetingQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && meetingQuery.trim() && !noMaterials) {
                      void draftFromQuery();
                    }
                  }}
                />
              </div>
              <button
                className="btn sm"
                disabled={busy || noMaterials || !meetingQuery.trim()}
                onClick={() => void draftFromQuery()}
              >
                <Sparkles size={14} />
                Draft
              </button>
            </div>
          </div>

          {noMaterials ? (
            <p className="faint" style={{ marginTop: 10 }}>
              Upload at least one company material first — a proposal with no company context
              isn&apos;t worth sending.
            </p>
          ) : null}
        </div>
      </div>

      <div className="sect" style={{ marginTop: 18 }}>
        <div className="sh">
          <h2>Recent meetings</h2>
          <span className="hint">{meetings.length}</span>
        </div>

        {meetings.length === 0 ? (
          <div className="empty">
            <CalendarClock />
            <div className="et">No meetings yet</div>
            <div className="es">
              Import your Granola history to get started — it only reads your notes.
            </div>
            <button
              className="btn"
              style={{ marginTop: 14 }}
              disabled={importing}
              onClick={() => void importMeetings("last_30_days")}
            >
              <CloudDownload size={15} />
              Import last 30 days
            </button>
          </div>
        ) : (
          <div className="meeting-list">
            {[...undrafted, ...drafted].map((m) => {
              const proposal = proposals.find((p) => p.meetingId === m.id);
              return (
                <div key={m.id} className="crow">
                  <div className="body">
                    <div className="cname">{m.title}</div>
                    <div className="meta">
                      {formatDay(m.date)} · {formatDateTime(m.date).split(", ").pop()}
                      {m.attendees?.length ? ` · ${m.attendees.length} attendees` : ""}
                    </div>
                  </div>
                  {m.drafted && proposal ? (
                    <button
                      className="btn ghost sm"
                      onClick={() => selectProposal(proposal.id)}
                    >
                      <Check size={14} />
                      View proposal
                    </button>
                  ) : (
                    <button
                      className="btn sm"
                      disabled={busy || noMaterials}
                      onClick={() => void draftFromMeeting(m.id)}
                    >
                      <Sparkles size={14} />
                      Draft proposal
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
