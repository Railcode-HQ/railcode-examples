import { create } from "zustand";

import {
  cleanError,
  DOCX_MIME,
  ProposalRecord,
  ScoutState,
} from "@/lib/proposals";

/**
 * The app never invokes the agent — the cron schedule is the only trigger, and
 * the app manifest grants no `agents:` access at all. So there is no run
 * polling, no job state, and no failure-code handling here: this store loads
 * what the agent left behind and saves edits back.
 */
type ProposalState = {
  identity: Me | null;
  loaded: boolean;
  error: string | null;
  notice: string | null;

  proposals: ProposalRecord[];
  scout: ScoutState | null;
  selectedId: string | null;
  navOpen: boolean;
  saving: boolean;
  refreshing: boolean;

  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (id: string) => void;
  setNavOpen: (open: boolean) => void;
  saveEditedDocx: (proposalId: string, blob: Blob) => Promise<void>;
  clearError: () => void;
  clearNotice: () => void;
};

const proposalsCol = () => db.collection<ProposalRecord>("proposals");
const stateCol = () => db.collection<ScoutState>("state");

async function loadProposals(): Promise<ProposalRecord[]> {
  const rows = await proposalsCol().query().orderBy("createdAt", "desc").page(1, 200);
  return rows.map((r) => r.value);
}

export const useProposalStore = create<ProposalState>((set, get) => ({
  identity: null,
  loaded: false,
  error: null,
  notice: null,

  proposals: [],
  scout: null,
  selectedId: null,
  navOpen: false,
  saving: false,
  refreshing: false,

  async bootstrap() {
    try {
      const [identity, proposals, scout] = await Promise.all([
        me(),
        loadProposals(),
        stateCol().get("scout"),
      ]);
      set({
        identity,
        proposals,
        scout,
        selectedId: proposals[0]?.id ?? null,
        loaded: true,
      });
    } catch (error) {
      set({ error: cleanError(error), loaded: true });
    }
  },

  /**
   * Proposals arrive while the page is open — the agent is on a 30-minute cycle
   * and nothing pushes to the browser — so re-reading is the only way a waiting
   * tab ever sees one.
   */
  async refresh() {
    if (get().refreshing) return;
    set({ refreshing: true });
    try {
      const [proposals, scout] = await Promise.all([loadProposals(), stateCol().get("scout")]);
      set((s) => ({
        proposals,
        scout,
        // Keep the open document selected; fall back to the newest.
        selectedId:
          s.selectedId && proposals.some((p) => p.id === s.selectedId)
            ? s.selectedId
            : (proposals[0]?.id ?? null),
      }));
    } catch (error) {
      set({ error: cleanError(error) });
    } finally {
      set({ refreshing: false });
    }
  },

  select: (id) => set({ selectedId: id, navOpen: false }),
  setNavOpen: (navOpen) => set({ navOpen }),

  /**
   * The editor exports the edited document as a .docx Blob; writing it back
   * under the same file name keeps one canonical document per proposal rather
   * than accumulating near-identical copies.
   */
  async saveEditedDocx(proposalId, blob) {
    const record = get().proposals.find((p) => p.id === proposalId);
    if (!record) return;
    set({ saving: true, error: null });
    try {
      await files.upload(record.fileName, blob, DOCX_MIME);
      const next: ProposalRecord = {
        ...record,
        edited: true,
        editedAt: new Date().toISOString(),
        editedBy: get().identity?.user.name ?? undefined,
      };
      await proposalsCol().put(record.id, next);
      set((s) => ({
        proposals: s.proposals.map((p) => (p.id === proposalId ? next : p)),
        notice: "Saved.",
      }));
    } catch (error) {
      set({ error: cleanError(error) });
    } finally {
      set({ saving: false });
    }
  },

  clearError: () => set({ error: null }),
  clearNotice: () => set({ notice: null }),
}));
