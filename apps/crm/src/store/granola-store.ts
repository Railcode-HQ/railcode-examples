import { create } from "zustand";

import { CallNote, cleanError, nowIso } from "@/lib/crm";
import {
  GRANOLA_MAX_IMPORT_PER_SYNC,
  GranolaMeetingStub,
  connectGranola,
  fetchMeetingDetailResilient,
  fetchMeetingTranscript,
  isGranolaConnected,
  listRecentMeetings,
  matchContactsByEmail,
} from "@/lib/granola";
import { useCrmStore } from "@/store/crm-store";
import { useTriageStore } from "@/store/triage-store";

/**
 * A granola-sourced note's key is derived from its meeting id rather than random,
 * so `put` is an upsert and re-importing the same meeting can never fan out into
 * duplicate notes.
 *
 * This replaced a per-user "already imported" ledger, which was a real bug on a
 * shared CRM: the ledger lived in the caller's own private scope while the notes it
 * guarded were shared, so the second person to open the app re-imported every
 * meeting the first person had already brought in. The shared notes are now the
 * only source of truth for what has been imported.
 */
export function granolaNoteId(meetingId: string): string {
  return `cn_g_${meetingId}`;
}

export type GranolaStep =
  | "connect"
  | "connecting"
  | "manualLoading"
  | "manual"
  | "importing"
  | "done";

/**
 * A recent meeting offered for manual import. `contactIds` are the people the
 * user has chosen to attach it to (pre-filled with any email matches).
 */
export type GranolaManualItem = {
  meetingId: string;
  title: string;
  date: string;
  attendees: string;
  contactIds: string[];
};

type GranolaState = {
  connected: boolean | null; // null = not checked yet
  /** Whether this Granola plan includes transcripts; null until an import tells us. */
  transcripts: boolean | null;
  syncing: boolean; // background / "Sync now" in flight — drives the sidebar spinner
  lastSyncError?: string; // last background-sync failure, surfaced quietly on the icon

  modalOpen: boolean;
  step: GranolaStep;
  error?: string;
  progress: { current: number; total: number; label: string };
  manualItems: GranolaManualItem[];
  summary?: { saved: number; skipped: number };
  connectPopup: Window | null;
  /** Bumped on every load/close so a stale in-flight run stops writing state. */
  syncToken: number;

  checkConnection: () => Promise<void>;
  openConnect: () => void;
  openManualImport: () => Promise<void>;
  closeModal: () => void;
  connect: () => Promise<void>;
  autoSync: (opts?: { silent?: boolean }) => Promise<void>;
  setManualContacts: (meetingId: string, contactIds: string[]) => void;
  confirmManualImport: () => Promise<void>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForConnection(popup: Window | null): Promise<boolean> {
  const timeoutMs = 180_000;
  const intervalMs = 1500;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(intervalMs);
    if (await isGranolaConnected()) return true;
    if (popup?.closed) return isGranolaConnected();
  }
  return false;
}

/**
 * Pulls the verbatim transcript for a meeting and stores it beside the note.
 * Transcripts are a paid-tier Granola feature: the first time we learn this
 * account doesn't have them, `transcripts` latches to false and we stop asking
 * on every subsequent meeting. Returns whether one was actually saved.
 */
async function importTranscript(meetingId: string): Promise<boolean> {
  const result = await fetchMeetingTranscript(meetingId);

  if (result.status === "tierLocked") {
    useGranolaStore.setState({ transcripts: false });
    return false;
  }
  // A transient failure proves nothing either way — leave the latch alone so
  // the next meeting tries again.
  if (result.status === "failed") return false;

  // The tool answered, so this plan has transcripts — even if this particular
  // meeting (a typed note with no recording) has no body of its own.
  useGranolaStore.setState({ transcripts: true });
  if (result.status !== "ok") return false;

  await useCrmStore.getState().saveTranscript(meetingId, result.text);
  return true;
}

/** Downloads one meeting's body, saves it as a call note, and marks it imported. */
async function importMeeting(
  stub: GranolaMeetingStub,
  contactIds: string[],
  importedBy?: string,
): Promise<void> {
  const detail = await fetchMeetingDetailResilient(stub);
  const ts = nowIso();

  // Fetched before the note is written so the note lands with its final shape;
  // a transcript failure must never cost us the note, hence the catch.
  const hasTranscript =
    useGranolaStore.getState().transcripts === false
      ? false
      : await importTranscript(stub.id).catch(() => false);

  // An existing note keeps its own id: a re-import refreshes the body rather than
  // stranding the original under a different key.
  const existing = useCrmStore
    .getState()
    .callNotes.find((n) => n.meetingId === stub.id);

  const note: CallNote = {
    id: existing?.id ?? granolaNoteId(stub.id),
    contactIds,
    meetingId: stub.id,
    title: detail.title,
    date: detail.date,
    attendees: detail.attendees,
    notesMarkdown: detail.notesMarkdown,
    createdAt: existing?.createdAt ?? ts,
    importedBy: existing?.importedBy ?? importedBy,
    source: "granola",
    ...(hasTranscript ? { hasTranscript: true } : {}),
  };
  await useCrmStore.getState().saveCallNote(note);
}

/**
 * Recent meetings that aren't in the CRM yet, capped per sync.
 *
 * "Not yet in the CRM" comes from the shared call notes, so every user sees the
 * same answer. Meetings someone dismissed on Home are excluded too — a dismissal
 * is a decision that this meeting isn't CRM material, and re-importing it on the
 * next sync would quietly overrule that.
 */
async function unimportedMeetings(): Promise<GranolaMeetingStub[]> {
  const stubs = await listRecentMeetings();
  const imported = new Set(useCrmStore.getState().callNotes.map((n) => n.meetingId));
  const dismissed = useTriageStore.getState().dismissedIds();
  return stubs
    .filter((s) => !imported.has(s.id) && !dismissed.has(s.id))
    .slice(0, GRANOLA_MAX_IMPORT_PER_SYNC);
}

export const useGranolaStore = create<GranolaState>((set, get) => ({
  connected: null,
  transcripts: null,
  syncing: false,
  modalOpen: false,
  step: "connect",
  progress: { current: 0, total: 0, label: "" },
  manualItems: [],
  connectPopup: null,
  syncToken: 0,

  async checkConnection() {
    try {
      set({ connected: await isGranolaConnected() });
    } catch {
      // SDK unavailable or personal connectors disabled — treat as not connected.
      set({ connected: false });
    }
  },

  openConnect() {
    set({ modalOpen: true, step: "connect", error: undefined, summary: undefined });
  },

  closeModal() {
    get().connectPopup?.close();
    set((s) => ({ modalOpen: false, connectPopup: null, syncToken: s.syncToken + 1 }));
  },

  async connect() {
    set({ step: "connecting", error: undefined });
    try {
      const redirectUrl = await connectGranola();
      const popup = window.open(redirectUrl, "_blank", "width=520,height=680");
      set({ connectPopup: popup });
      const connected = await waitForConnection(popup);
      set({ connectPopup: null });
      if (!connected) {
        set({ step: "connect", error: "Didn't finish connecting — try again." });
        return;
      }
      // Connected — close the dialog and pull in whatever email-matches right away.
      set({ connected: true, modalOpen: false });
      void get().autoSync({ silent: true });
    } catch (error) {
      set({ step: "connect", error: cleanError(error), connectPopup: null });
    }
  },

  /**
   * Background sync (on load, every 10 min, and "Sync now"): lists recent
   * meetings and auto-imports the ones whose attendees include a known
   * contact's email, attaching each to all matching people. Meetings with no
   * email match are left untouched so they can be assigned by hand in the
   * manual importer. Idempotent via the ledger; safe to call repeatedly.
   */
  async autoSync(opts) {
    const silent = opts?.silent ?? false;
    if (get().syncing) return;

    let connected = get().connected;
    if (connected == null) {
      connected = await isGranolaConnected().catch(() => false);
      set({ connected });
    }
    if (!connected) return;

    set({ syncing: true, lastSyncError: undefined });
    try {
      const fresh = await unimportedMeetings();
      const contacts = useCrmStore
        .getState()
        .contacts.map((c) => ({ id: c.id, email: c.email }));
      const importedBy = useCrmStore.getState().identity?.user.name;

      for (const stub of fresh) {
        const contactIds = matchContactsByEmail(stub.attendees, contacts);
        if (!contactIds.length) continue; // no match → leave for manual import
        await importMeeting(stub, contactIds, importedBy);
      }
      set({ syncing: false });
    } catch (error) {
      const message = cleanError(error);
      set({ syncing: false, lastSyncError: message });
      if (!silent) set({ error: message });
    }
  },

  async openManualImport() {
    if (!get().connected) {
      get().openConnect();
      return;
    }
    const token = get().syncToken + 1;
    set({
      modalOpen: true,
      step: "manualLoading",
      error: undefined,
      summary: undefined,
      manualItems: [],
      syncToken: token,
    });
    const stale = () => get().syncToken !== token;

    try {
      const fresh = await unimportedMeetings();
      if (stale()) return;
      const contacts = useCrmStore
        .getState()
        .contacts.map((c) => ({ id: c.id, email: c.email }));
      set({
        step: "manual",
        manualItems: fresh.map((s) => ({
          meetingId: s.id,
          title: s.title,
          date: s.date,
          attendees: s.attendees,
          // Pre-fill any email matches; the user can add or remove people.
          contactIds: matchContactsByEmail(s.attendees, contacts),
        })),
      });
    } catch (error) {
      if (!stale()) set({ step: "manual", error: cleanError(error), manualItems: [] });
    }
  },

  setManualContacts(meetingId, contactIds) {
    set((s) => ({
      manualItems: s.manualItems.map((m) =>
        m.meetingId === meetingId ? { ...m, contactIds } : m,
      ),
    }));
  },

  /** Imports only the meetings the user attached to at least one person. */
  async confirmManualImport() {
    const items = get().manualItems.filter((m) => m.contactIds.length);
    const skipped = get().manualItems.length - items.length;

    const token = get().syncToken + 1;
    set({
      syncToken: token,
      step: "importing",
      error: undefined,
      progress: { current: 0, total: items.length, label: "Importing…" },
    });
    // Closing the modal mid-import bumps the token past ours; stop rather than
    // keep pulling notes for a screen the user has walked away from.
    const stale = () => get().syncToken !== token;

    try {
      const importedBy = useCrmStore.getState().identity?.user.name;
      let saved = 0;

      for (let i = 0; i < items.length; i++) {
        if (stale()) return;
        const item = items[i];
        set({ progress: { current: i + 1, total: items.length, label: item.title } });
        await importMeeting(
          {
            id: item.meetingId,
            title: item.title,
            date: item.date,
            attendees: item.attendees,
          },
          item.contactIds,
          importedBy,
        );
        saved += 1;
        if (i < items.length - 1) await sleep(400);
      }

      if (stale()) return;
      set({ step: "done", summary: { saved, skipped }, manualItems: [] });
    } catch (error) {
      if (!stale()) set({ step: "manual", error: cleanError(error) });
    }
  },
}));
