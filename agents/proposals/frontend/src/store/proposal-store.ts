import { create } from "zustand";

import { api, type Me } from "@/lib/api";
import { cleanError, type ProposalRecord, type ScoutState } from "@/lib/proposals";

// The scheduled org agent is the sole producer. Refresh reads its shared
// results; it never starts a second run or edits a run-coordination marker.
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
      const [identity, state] = await Promise.all([api.me(), api.state()]);
      set({ identity, ...state, selectedId: state.proposals[0]?.id ?? null, loaded: true });
    } catch (error) {
      set({ error: cleanError(error), loaded: true });
    }
  },

  async refresh() {
    if (get().refreshing) return;
    set({ refreshing: true });
    try {
      const state = await api.state();
      set((current) => ({
        ...state,
        selectedId: state.proposals.some((p) => p.id === current.selectedId)
          ? current.selectedId : state.proposals[0]?.id ?? null,
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
   * The editor exports the edited document as a .docx Blob. The worker writes
   * it back under the RECORD's own file name — the browser never says where
   * the bytes land — so one canonical document per proposal, and no way for an
   * edit to become a write to something else.
   */
  async saveEditedDocx(proposalId, blob) {
    const record = get().proposals.find((p) => p.id === proposalId);
    if (!record) return;
    set({ saving: true, error: null });
    try {
      const next = await api.saveDocx(proposalId, blob);
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
