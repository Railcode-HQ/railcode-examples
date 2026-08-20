import { create } from "zustand";

import { api, ApiError, type Me, type RunStatus } from "@/lib/api";
import {
  agentCallError,
  cleanError,
  isRunStale,
  ManualRun,
  ProposalRecord,
  runFailureMessage,
  runOutcomeNotice,
  ScoutState,
} from "@/lib/proposals";

/**
 * The store is still mostly a reader: the agent's cron schedule is its normal
 * trigger, and everything on screen was written by a run this app didn't ask
 * for. The one exception is Run now, which starts a run for someone who doesn't
 * want to wait up to 30 minutes — and that is where the run state, the polling
 * and the failure-code handling below come from.
 *
 * Nothing here talks to the platform. The worker does, and it answers the whole
 * page in one call (`api.state`) rather than the three the v1 page made.
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
  /** A run in flight, started here or in anyone else's tab. */
  manualRun: ManualRun | null;
  /** The gap between pressing the button and having a request id to show. */
  starting: boolean;

  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;
  runNow: () => Promise<void>;
  select: (id: string) => void;
  setNavOpen: (open: boolean) => void;
  saveEditedDocx: (proposalId: string, blob: Blob) => Promise<void>;
  clearError: () => void;
  clearNotice: () => void;
};

/** Fast enough to feel live against a run that usually takes minutes, not seconds. */
const RUN_POLL_MS = 3000;

function terminal(status: string): boolean {
  return status !== "queued" && status !== "running";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const useProposalStore = create<ProposalState>((set, get) => {
  /** Request ids already being polled, so resuming on load and pressing the
   *  button can't leave two loops watching the same run. */
  const watching = new Set<string>();

  async function clearManualRun() {
    set({ manualRun: null });
    // Advisory: if the delete fails the marker ages out via isRunStale instead.
    await api.clearRun().catch(() => undefined);
  }

  /**
   * Polls one run to a terminal status and reports what it did.
   *
   * The run writes its own `state/scout` record whatever the outcome — that is
   * how the scheduled runs stay visible — so success here is just a matter of
   * re-reading what it left and saying it out loud.
   */
  async function watch(requestId: string) {
    if (watching.has(requestId)) return;
    watching.add(requestId);
    try {
      let run: RunStatus = await api.runStatus(requestId);
      while (!terminal(run.status)) {
        await sleep(RUN_POLL_MS);
        run = await api.runStatus(requestId);
        // A colleague's run: the shared marker says one is going, but a run
        // belongs to (app, caller) so its status is not ours to read. Watch the
        // marker instead — it disappears when their tab finishes the run.
        if (!run.mine) {
          await get().refresh();
          if (!get().manualRun) break;
        }
      }

      if (!run.mine) return;

      await clearManualRun();
      await get().refresh();

      const scout = get().scout;
      if (run.status !== "success") {
        set({ error: runFailureMessage({ status: run.status, error_code: run.errorCode, error_message: run.errorMessage }) });
      } else if (scout?.outcome === "error") {
        set({ error: scout.error || "The run reported an error." });
      } else set({ notice: runOutcomeNotice(scout) });
    } catch (error) {
      // A lost poll (tab slept, network blipped) is not a failed run: the agent
      // is off doing its work regardless and writes its own records at the end.
      // Deliberately leave the in-flight marker alone — clearing it here is
      // exactly what would let a second run start on top of a live one. The
      // staleness cutoff releases it instead.
      set({ error: cleanError(error) });
    } finally {
      watching.delete(requestId);
    }
  }

  return {
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
    manualRun: null,
    starting: false,

    async bootstrap() {
      try {
        const [identity, state] = await Promise.all([api.me(), api.state()]);
        const live = isRunStale(state.manualRun) ? null : state.manualRun;
        set({
          identity,
          proposals: state.proposals,
          scout: state.scout,
          manualRun: live,
          selectedId: state.proposals[0]?.id ?? null,
          loaded: true,
        });
        // A run started before this tab existed is still worth following: it is
        // what greys the button out, and its result is what fills this page.
        if (live) void watch(live.requestId);
        else if (state.manualRun) void clearManualRun();
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
        const state = await api.state();
        const live = isRunStale(state.manualRun) ? null : state.manualRun;
        set((s) => ({
          proposals: state.proposals,
          scout: state.scout,
          manualRun: live,
          // Keep the open document selected; fall back to the newest.
          selectedId:
            s.selectedId && state.proposals.some((p) => p.id === s.selectedId)
              ? s.selectedId
              : (state.proposals[0]?.id ?? null),
        }));
        // Someone else's tab started this one; follow it so this tab's button
        // comes back at the right moment rather than on the next poll.
        if (live) void watch(live.requestId);
      } catch (error) {
        set({ error: cleanError(error) });
      } finally {
        set({ refreshing: false });
      }
    },

    /**
     * Starts a run and returns as soon as it is queued.
     *
     * The worker calls `agents.start`, not `agents.invoke`: a run is allowed 300
     * seconds and invoke would spend the invocation's subrequest budget polling
     * for all of them. A manual run is the same run the schedule would do, just
     * sooner.
     */
    async runNow() {
      if (get().starting || get().manualRun) return;
      set({ starting: true, error: null });
      try {
        const live = await api.startRun();
        set({
          manualRun: live,
          notice: "Checking your meetings. This keeps going if you close the tab.",
        });
        void watch(live.requestId);
      } catch (error) {
        set({ error: agentCallError(error) });
      } finally {
        set({ starting: false });
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
  };
});

// Re-exported so views keep a single import for run errors.
export { ApiError };
