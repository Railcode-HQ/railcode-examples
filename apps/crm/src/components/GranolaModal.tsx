import { Check, X } from "lucide-react";

import granolaLogo from "@/assets/granola-logo.png";
import { ContactMultiSelect } from "@/components/ContactMultiSelect";
import { GranolaManualItem, GranolaStep, useGranolaStore } from "@/store/granola-store";

const SUBTITLES: Record<GranolaStep, string> = {
  connect: "Connect your account",
  connecting: "Connecting…",
  manualLoading: "Loading meetings",
  manual: "Import meetings",
  importing: "Importing",
  done: "Done",
};

export function GranolaModal() {
  const {
    modalOpen,
    step,
    error,
    progress,
    manualItems,
    summary,
    closeModal,
    connect,
    setManualContacts,
    confirmManualImport,
  } = useGranolaStore();
  if (!modalOpen) return null;

  const assignedCount = manualItems.filter((i) => i.contactIds.length).length;

  return (
    <div className="cmdoverlay" onMouseDown={closeModal}>
      <div className="granola" onMouseDown={(e) => e.stopPropagation()}>
        <div className="granolahead">
          <img src={granolaLogo} alt="" />
          <div className="ttl">
            <h3>Granola</h3>
            <div className="sub">{SUBTITLES[step]}</div>
          </div>
          <button className="iconbtn" aria-label="Close" onClick={closeModal}>
            <X />
          </button>
        </div>

        <div className="granolabody">
          {error ? <div className="banner">{error}</div> : null}

          {step === "connect" ? (
            <Intro
              title="Connect your Granola account"
              body="Import your meeting notes and attach them to the people in your CRM."
              action="Connect"
              onAction={connect}
            />
          ) : null}

          {step === "connecting" ? (
            <Intro spinning body="Waiting for you to finish connecting in the popup window…" />
          ) : null}

          {step === "manualLoading" ? (
            <Intro spinning body="Looking for recent meetings…" />
          ) : null}

          {step === "manual" ? (
            <Manual items={manualItems} onSetContacts={setManualContacts} />
          ) : null}

          {step === "importing" ? (
            <Intro
              spinning
              body={
                progress.total
                  ? `Importing ${progress.current} of ${progress.total}`
                  : "Importing…"
              }
            >
              {progress.total ? (
                <>
                  <div className="granolabar">
                    <div
                      className="granolabar-fill"
                      style={{
                        width: `${Math.round((progress.current / progress.total) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="granolabar-label">{progress.label}</div>
                </>
              ) : null}
            </Intro>
          ) : null}

          {step === "done" ? (
            <Intro
              icon={<Check size={22} />}
              body={
                [
                  `Imported ${summary?.saved ?? 0} meeting${summary?.saved === 1 ? "" : "s"}.`,
                  summary?.skipped
                    ? `Left ${summary.skipped} unassigned — they'll show up again next time.`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              }
              action="Done"
              onAction={closeModal}
            />
          ) : null}
        </div>

        {step === "manual" && manualItems.length ? (
          <div className="granolafoot">
            <span className="hint">
              {assignedCount} of {manualItems.length} assigned
            </span>
            <div className="spacer" />
            <button className="btn ghost" onClick={closeModal}>
              Cancel
            </button>
            <button
              className="btn"
              onClick={confirmManualImport}
              disabled={assignedCount === 0}
            >
              Import {assignedCount || ""}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Manual({
  items,
  onSetContacts,
}: {
  items: GranolaManualItem[];
  onSetContacts: (meetingId: string, contactIds: string[]) => void;
}) {
  if (!items.length) {
    return (
      <div className="granolaintro">
        <Check size={22} />
        <p>You're all caught up — no new meetings to import.</p>
      </div>
    );
  }

  return (
    <div className="granolareview">
      <p className="hint">
        Attach each meeting to the people it was with — type an email to find a contact.
        Meetings you leave empty aren't imported.
      </p>
      <div className="granolarows">
        {items.map((item) => (
          <div className="granolaitem" key={item.meetingId}>
            <div className="granolaitem-head">
              <div className="nm">{item.title}</div>
              <div className="meta">
                {new Date(item.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            </div>
            <ContactMultiSelect
              value={item.contactIds}
              onChange={(ids) => onSetContacts(item.meetingId, ids)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Intro({
  title,
  body,
  action,
  onAction,
  spinning,
  icon,
  children,
}: {
  title?: string;
  body: string;
  action?: string;
  onAction?: () => void;
  spinning?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="granolaintro">
      {spinning ? <span className="spin" /> : icon}
      {title ? <h4>{title}</h4> : null}
      <p>{body}</p>
      {children}
      {action ? (
        <button className="btn granolabtn" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
