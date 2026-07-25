import { create } from "zustand";

import {
  agentCallError,
  AGENT_NAME,
  cleanError,
  DOCX_MIME,
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

const proposalsCol = () => db.collection<ProposalRecord>("proposals");
const stateCol = () => db.collection<ScoutState>("state");
/** The same `state` collection the agent writes `scout` into, under its own key. */
const runCol = () => db.collection<ManualRun>("state");

const RUN_KEY = "manualRun";

/** Fast enough to feel live against a run that usually takes minutes, not seconds. */
const RUN_POLL_MS = 3000;

async function loadProposals(): Promise<ProposalRecord[]> {
  const rows = await proposalsCol().query().orderBy("createdAt", "desc").page(1, 200);
  return rows.map((r) => r.value);
}

function terminal(run: AgentRun): boolean {
  return run.status !== "queued" && run.status !== "running";
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
    await runCol().delete(RUN_KEY).catch(() => undefined);
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
      let run = await agents.get(requestId);
      while (!terminal(run)) {
        await sleep(RUN_POLL_MS);
        run = await agents.get(requestId);
      }

      await clearManualRun();
      await get().refresh();

      const scout = get().scout;
      if (run.status !== "success") set({ error: runFailureMessage(run) });
      else if (scout?.outcome === "error") {
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
        const [identity, proposals, scout, stored] = await Promise.all([
          me(),
          loadProposals(),
          stateCol().get("scout"),
          runCol().get(RUN_KEY),
        ]);
        const live = isRunStale(stored) ? null : stored;
        set({
          identity,
          proposals,
          scout,
          manualRun: live,
          selectedId: proposals[0]?.id ?? null,
          loaded: true,
        });
        // A run started before this tab existed is still worth following: it is
        // what greys the button out, and its result is what fills this page.
        if (live) void watch(live.requestId);
        else if (stored) void clearManualRun();
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
        const [proposals, scout, stored] = await Promise.all([
          loadProposals(),
          stateCol().get("scout"),
          runCol().get(RUN_KEY),
        ]);
        const live = isRunStale(stored) ? null : stored;
        set((s) => ({
          proposals,
          scout,
          manualRun: live,
          // Keep the open document selected; fall back to the newest.
          selectedId:
            s.selectedId && proposals.some((p) => p.id === s.selectedId)
              ? s.selectedId
              : (proposals[0]?.id ?? null),
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
     * `agents.start` rather than `agents.invoke`: a run is allowed 300 seconds
     * and invoke would hold the request open for all of them. Nothing is passed
     * as input, and that is not an oversight — the agent declares no
     * `input_schema` (declaring one fails every scheduled run) and decides what
     * to do from its own ledger. A manual run is the same run, just sooner.
     */
    async runNow() {
      if (get().starting || get().manualRun) return;
      set({ starting: true, error: null });
      try {
        const started = await agents.start(AGENT_NAME);
        const live: ManualRun = {
          requestId: started.request_id,
          startedAt: new Date().toISOString(),
          startedBy: get().identity?.user.name,
        };
        set({
          manualRun: live,
          notice: "Checking your meetings. This keeps going if you close the tab.",
        });
        void watch(live.requestId);
        // Written after the run is safely started, and tolerated if it fails:
        // this marker is what other tabs read, so losing it costs them the
        // shared view of an in-flight run, not the run.
        await runCol().put(RUN_KEY, live).catch(() => undefined);
      } catch (error) {
        set({ error: agentCallError(error) });
      } finally {
        set({ starting: false });
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
  };
});
