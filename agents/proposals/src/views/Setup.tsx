import {
  ArrowRight,
  Check,
  CloudDownload,
  FileText,
  Loader2,
  Paperclip,
  Sparkles,
  Upload,
} from "lucide-react";
import { DragEvent, useRef, useState } from "react";

import { formatDay } from "@/lib/proposals";
import { useProposalStore } from "@/store/proposal-store";

/**
 * The pipeline, stated once in plain language. People are about to hand this
 * thing their client calls — they should understand what it does with them
 * before the first draft, not after.
 */
function HowItWorks() {
  return (
    <div className="how">
      <div className="how-step">
        <span className="how-ic">
          <CloudDownload size={15} />
        </span>
        <div>
          <b>Your meeting</b>
          <span>Granola notes, attendees, what the client actually asked for</span>
        </div>
      </div>
      <span className="how-plus">+</span>
      <div className="how-step">
        <span className="how-ic">
          <Paperclip size={15} />
        </span>
        <div>
          <b>Your materials</b>
          <span>Past proposals, rate cards, case studies you upload here</span>
        </div>
      </div>
      <span className="how-arrow">
        <ArrowRight size={15} />
      </span>
      <div className="how-step">
        <span className="how-ic accent">
          <FileText size={15} />
        </span>
        <div>
          <b>An editable draft</b>
          <span>A .docx you edit right here, then download and send</span>
        </div>
      </div>
    </div>
  );
}

type StepProps = {
  n: number;
  title: string;
  done: boolean;
  active: boolean;
  children: React.ReactNode;
};

function Step({ n, title, done, active, children }: StepProps) {
  return (
    <div className={`step${done ? " done" : ""}${active ? " active" : ""}`}>
      <div className="step-n">{done ? <Check size={14} strokeWidth={3} /> : n}</div>
      <div className="step-body">
        <div className="step-title">{title}</div>
        {done && !active ? null : <div className="step-content">{children}</div>}
      </div>
    </div>
  );
}

export function Setup() {
  const {
    meetings,
    materials,
    proposals,
    job,
    importing,
    uploading,
    addFiles,
    importMeetings,
    draftFromMeeting,
    dismissOnboarding,
    setView,
  } = useProposalStore();

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const busy = job !== null;
  const hasMeetings = meetings.length > 0;
  const hasMaterials = materials.length > 0;
  const hasProposal = proposals.length > 0;
  const allDone = hasMeetings && hasMaterials && hasProposal;

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
  }

  // Most recent first — the call you just walked out of is the one you want.
  const suggested = meetings.filter((m) => !m.drafted).slice(0, 5);

  return (
    <>
      <div className="phead">
        <div>
          <h1>{allDone ? "You're set up" : "Let's get you set up"}</h1>
          <p>
            Three steps, about two minutes. You&apos;ll end up with a real proposal drafted from
            a real meeting.
          </p>
        </div>
        {allDone ? (
          <div className="phead-actions">
            <button className="btn" onClick={() => void dismissOnboarding()}>
              Go to my meetings
              <ArrowRight size={14} />
            </button>
          </div>
        ) : null}
      </div>

      <HowItWorks />

      <div className="steps">
        <Step n={1} title="Import your meetings" done={hasMeetings} active={!hasMeetings}>
          <p>
            We&apos;ll read your Granola history and build a list you can draft from. This reads
            your notes directly — it&apos;s instant, and nothing is written or sent.
          </p>
          <div className="step-actions">
            <button
              className="btn"
              disabled={importing}
              onClick={() => void importMeetings("last_30_days")}
            >
              {importing ? (
                <Loader2 size={15} className="icon-spin" />
              ) : (
                <CloudDownload size={15} />
              )}
              {importing ? "Importing…" : "Import last 30 days"}
            </button>
            {hasMeetings ? (
              <span className="faint">{meetings.length} meetings imported</span>
            ) : null}
          </div>
        </Step>

        <Step
          n={2}
          title="Add your company materials"
          done={hasMaterials}
          active={hasMeetings && !hasMaterials}
        >
          <p>
            This is what makes drafts sound like you instead of like a template. Past proposals
            teach it your structure and tone; a rate card keeps pricing real. Anything it
            can&apos;t find here becomes a{" "}
            <span className="mono">[ADD: …]</span> placeholder rather than an invented number.
          </p>
          <div
            className={`dropzone compact${dragging ? " drag" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {uploading ? <span className="spin" /> : <Upload />}
            <div className="dz-title">
              {uploading ? "Uploading…" : "Drop files here, or click to browse"}
            </div>
            <div className="dz-sub">A couple of past proposals is plenty to start</div>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="file-input-hidden"
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {hasMaterials ? (
            <div className="chips">
              {materials.slice(0, 6).map((m) => (
                <span key={m.fileName} className="chip">
                  <FileText size={12} />
                  {m.name}
                </span>
              ))}
              {materials.length > 6 ? (
                <span className="chip faint">+{materials.length - 6} more</span>
              ) : null}
            </div>
          ) : null}
        </Step>

        <Step
          n={3}
          title="Draft your first proposal"
          done={hasProposal}
          active={hasMeetings && hasMaterials && !hasProposal}
        >
          <p>
            Pick a client call. It takes a couple of minutes — it reads the notes, reads your
            materials, writes the proposal, and renders a .docx you can edit here.
          </p>
          {suggested.length ? (
            <div className="pick-list">
              {suggested.map((m) => (
                <button
                  key={m.id}
                  className="pick"
                  disabled={busy || !hasMaterials}
                  onClick={() => void draftFromMeeting(m.id)}
                >
                  <div className="body">
                    <div className="cname">{m.title}</div>
                    <div className="meta">{formatDay(m.date)}</div>
                  </div>
                  <span className="go">
                    <Sparkles size={14} />
                    Draft
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="faint">Import your meetings first and they&apos;ll show up here.</p>
          )}
        </Step>
      </div>

      <div className="setup-foot">
        <button className="link" onClick={() => setView("meetings")}>
          Skip for now
        </button>
        <span className="faint">
          You can always reopen this from the sidebar. Press{" "}
          <kbd>⌘</kbd>
          <kbd>K</kbd> anywhere to jump around.
        </span>
      </div>
    </>
  );
}
