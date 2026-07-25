import { Calendar, Pencil, Trash2, Users, X } from "lucide-react";
import { useEffect, useState } from "react";

import { ContactMultiSelect } from "@/components/ContactMultiSelect";
import { Markdown } from "@/components/Markdown";
import { CallNote, cleanError, nowIso } from "@/lib/crm";
import { useCrmStore } from "@/store/crm-store";

type Tab = "notes" | "transcript";

/**
 * Views, edits, and composes a call note. `isNew` notes are drafts built by the
 * caller — they open straight into edit mode and aren't persisted until saved,
 * so cancelling leaves nothing behind.
 */
export function CallNoteViewer({
  note,
  isNew = false,
  onClose,
}: {
  note: CallNote;
  isNew?: boolean;
  onClose: () => void;
}) {
  const { contacts, saveCallNote, deleteCallNote, loadTranscript, saveTranscript } =
    useCrmStore();

  const [tab, setTab] = useState<Tab>("notes");
  const [editing, setEditing] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const [title, setTitle] = useState(note.title);
  const [date, setDate] = useState(() => toDateInput(note.date));
  const [contactIds, setContactIds] = useState(note.contactIds ?? []);
  const [notes, setNotes] = useState(note.notesMarkdown);

  // Attendees read as the people the note is attached to; the raw string from
  // Granola is the fallback for imports whose attendees never matched a contact.
  const attending = contactIds
    .map((id) => contacts.find((c) => c.id === id)?.name)
    .filter(Boolean)
    .join(", ");
  const subAttendees = attending || note.attendees;

  // null = not loaded yet. Editing needs the body in hand, so the load is
  // triggered by opening the transcript tab *or* by entering edit mode.
  const [transcript, setTranscript] = useState<string | null>(
    isNew || !note.hasTranscript ? "" : null,
  );
  const [loading, setLoading] = useState(false);

  const wants = tab === "transcript" || editing;
  useEffect(() => {
    if (!wants || transcript !== null) return;
    let live = true;
    setLoading(true);
    loadTranscript(note.meetingId)
      .then((text) => live && setTranscript(text ?? ""))
      .catch(() => live && setTranscript(""))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [wants, transcript, note.meetingId, loadTranscript]);

  async function save() {
    const body = transcript ?? "";
    setSaving(true);
    setError(undefined);
    try {
      await saveTranscript(note.meetingId, body);
      await saveCallNote({
        ...note,
        title: title.trim() || "Untitled meeting",
        date: fromDateInput(date, note.date),
        contactIds,
        notesMarkdown: notes,
        hasTranscript: body.trim().length > 0,
        updatedAt: nowIso(),
      });
      if (isNew) onClose();
      else setEditing(false);
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await deleteCallNote(note);
      onClose();
    } catch (e) {
      setError(cleanError(e));
      setSaving(false);
    }
  }

  function cancel() {
    if (isNew) {
      onClose();
      return;
    }
    // Drop edits by restoring from the saved note; transcript reloads on demand.
    setTitle(note.title);
    setDate(toDateInput(note.date));
    setContactIds(note.contactIds ?? []);
    setNotes(note.notesMarkdown);
    setTranscript(note.hasTranscript ? null : "");
    setError(undefined);
    setEditing(false);
  }

  const showTabs = editing || note.hasTranscript;

  return (
    <div
      className="overlay notelayer"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (!editing) onClose();
      }}
    >
      <div className="notemodal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="notehead">
          <div className="ttl">
            {editing ? (
              <input
                className="input notettl"
                value={title}
                placeholder="Meeting title"
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
              />
            ) : (
              <h3>{note.title}</h3>
            )}

            {editing ? (
              <div className="notemeta">
                <input
                  className="input"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <ContactMultiSelect
                  value={contactIds}
                  onChange={setContactIds}
                  companyId={note.companyId}
                />
              </div>
            ) : (
              <div className="notesub">
                <span className="notesub-i">
                  <Calendar size={13} />
                  {new Date(note.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                {subAttendees ? (
                  <span className="notesub-i">
                    <Users size={13} />
                    <span className="notesub-people">{subAttendees}</span>
                  </span>
                ) : null}
              </div>
            )}
          </div>

          {editing ? null : (
            <>
              <button
                className="iconbtn"
                aria-label="Edit note"
                title="Edit"
                onClick={() => setEditing(true)}
              >
                <Pencil />
              </button>
              <button
                className="iconbtn"
                aria-label="Delete note"
                title="Delete"
                onClick={remove}
                disabled={saving}
              >
                <Trash2 />
              </button>
            </>
          )}
          <button className="iconbtn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>

        {showTabs ? (
          <div className="notetabs">
            <button
              className={`notetab${tab === "notes" ? " active" : ""}`}
              onClick={() => setTab("notes")}
            >
              Notes
            </button>
            <button
              className={`notetab${tab === "transcript" ? " active" : ""}`}
              onClick={() => setTab("transcript")}
            >
              Transcript
            </button>
          </div>
        ) : null}

        <div className="notebody">
          {tab === "notes" ? (
            editing ? (
              <textarea
                className="textarea notefield"
                value={notes}
                placeholder="Paste or type the meeting notes. Markdown works."
                onChange={(e) => setNotes(e.target.value)}
              />
            ) : note.notesMarkdown ? (
              <Markdown text={note.notesMarkdown} />
            ) : (
              <div className="notemuted">No notes on this meeting.</div>
            )
          ) : loading ? (
            <div className="notemuted">Loading transcript…</div>
          ) : editing ? (
            <textarea
              className="textarea notefield mono"
              value={transcript ?? ""}
              placeholder="Paste the transcript here."
              onChange={(e) => setTranscript(e.target.value)}
            />
          ) : transcript ? (
            <pre className="transcript">{transcript}</pre>
          ) : (
            <div className="notemuted">No transcript on this meeting.</div>
          )}
        </div>

        {editing ? (
          <div className="notefoot">
            {error ? <span className="noteerr">{error}</span> : null}
            <span className="spacer" />
            <button className="btn ghost sm" onClick={cancel} disabled={saving}>
              Cancel
            </button>
            <button className="btn sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : isNew ? "Create note" : "Save"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// <input type="date"> speaks yyyy-mm-dd in local time; going through
// toISOString() here would shift the day for anyone west of UTC.
function toDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Anchors at local noon so the stored date can't slide across a timezone. */
function fromDateInput(value: string, fallback: string): string {
  if (!value) return fallback;
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}
