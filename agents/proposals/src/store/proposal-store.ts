import { create } from "zustand";

import { domainOf, isExternal, listGranolaMeetings } from "@/lib/granola";
import {
  cleanError,
  CronState,
  DEFAULT_SETTINGS,
  formatBytes,
  MATERIALS_PREFIX,
  materialDisplayName,
  materialStorageName,
  MaterialFile,
  MAX_MATERIAL_BYTES,
  MeetingRecord,
  Onboarding,
  ProposalRecord,
  Settings,
  TimeRange,
} from "@/lib/proposals";

const AGENT_NAME = "proposal-writer";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type View = "setup" | "meetings" | "proposal" | "materials" | "settings";

/** What the agent is currently doing, so the UI can narrate a multi-minute run. */
export type AgentJob = {
  kind: "index" | "draft";
  label: string;
  startedAt: number;
} | null;

type ProposalState = {
  identity: Me | null;
  loaded: boolean;
  error: string | null;
  notice: string | null;

  view: View;
  navOpen: boolean;

  materials: MaterialFile[];
  proposals: ProposalRecord[];
  meetings: MeetingRecord[];
  settings: Settings;
  cronState: CronState | null;
  onboarding: Onboarding | null;
  selectedProposalId: string | null;

  context: string;
  meetingQuery: string;
  uploading: boolean;
  importing: boolean;
  job: AgentJob;
  saving: boolean;
  commandOpen: boolean;

  bootstrap: () => Promise<void>;
  setView: (view: View) => void;
  setNavOpen: (open: boolean) => void;
  setContext: (text: string) => void;
  setMeetingQuery: (text: string) => void;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeMaterial: (fileName: string) => Promise<void>;
  importMeetings: (range: TimeRange) => Promise<void>;
  refreshMeetings: () => Promise<void>;
  dismissOnboarding: () => Promise<void>;
  setCommandOpen: (open: boolean) => void;
  draftFromMeeting: (meetingId: string) => Promise<void>;
  draftFromQuery: () => Promise<void>;
  saveEditedDocx: (proposalId: string, blob: Blob) => Promise<void>;
  saveSettings: (next: Partial<Settings>) => Promise<void>;
  selectProposal: (id: string) => void;
  clearError: () => void;
  clearNotice: () => void;
};

const proposalsCol = () => db.collection<ProposalRecord>("proposals");
const meetingsCol = () => db.collection<MeetingRecord>("meetings");
const settingsCol = () => db.collection<Settings>("settings");
const stateCol = () => db.collection<CronState>("state");
const onboardingCol = () => db.collection<Onboarding>("onboarding");

async function refreshMaterials(): Promise<MaterialFile[]> {
  const all = await files.list();
  return all
    .filter((f) => f.name.startsWith(MATERIALS_PREFIX))
    .map((f) => ({
      name: materialDisplayName(f.name),
      fileName: f.name,
      contentType: f.content_type,
      size: f.size,
      updatedAt: f.updated_at,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

async function refreshProposals(): Promise<ProposalRecord[]> {
  const rows = await proposalsCol().query().orderBy("createdAt", "desc").page(1, 200);
  return rows.map((r) => r.value);
}

async function refreshMeetings(): Promise<MeetingRecord[]> {
  const rows = await meetingsCol().query().orderBy("date", "desc").page(1, 200);
  return rows.map((r) => r.value);
}

/**
 * A draft run reads every material, calls a frontier model, renders a .docx and
 * publishes it — minutes, not seconds. `agents.invoke` would hold one request
 * open for all of it, so we queue with `start` and poll instead.
 */
async function runAgent(input: unknown): Promise<AgentRun> {
  const started = await agents.start(AGENT_NAME, input);
  let run = started;
  while (run.status === "queued" || run.status === "running") {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    run = await agents.get(started.request_id);
  }
  // A run can end without succeeding for reasons other than "failed" — treating
  // anything non-success as success would report a proposal that doesn't exist.
  if (run.status !== "success") {
    throw new Error(runFailureMessage(run));
  }
  return run;
}

/**
 * Explanations for the failures a user can actually act on. Anything not listed
 * falls through to the platform's own error_message — never to a generic
 * "didn't finish", which tells the user nothing and hides a diagnosis the API
 * already handed us.
 *
 * Note the quota case arrives as status "failed" with this code — NOT as status
 * "limit_exceeded", which means the agent's own manifest limits (max_steps,
 * max_tokens_total, timeout_seconds) were hit instead.
 */
const FAILURE_HELP: Record<string, string> = {
  daily_token_limit_exceeded:
    "The daily LLM token limit for this model's provider is used up, so the run stopped before writing anything. The limit is per-provider and resets daily — nothing was lost, and the meeting is still queued.",
  invalid_input:
    "The request didn't match what the agent expects. This is a bug in the app rather than anything you did.",
  timeout:
    "The run hit its time limit before finishing. Proposals are capped at five minutes; trying again with fewer materials usually gets it through.",
};

function runFailureMessage(run: AgentRun): string {
  const code = run.error_code ?? undefined;
  const detail = run.error_message ?? undefined;

  if (code && FAILURE_HELP[code]) return FAILURE_HELP[code];
  if (run.status === "limit_exceeded") {
    return `The run exceeded the agent's own limits (steps, tokens or time) before finishing.${detail ? ` ${detail}` : ""}`;
  }
  if (run.status === "cancelled") return "The run was cancelled before it finished.";

  // Always show what the platform said, plus the code, so a bug report has
  // something to go on.
  if (detail) return code ? `${detail} (${code})` : detail;
  if (code) return `The run failed: ${code}`;
  return "The run didn't finish, and the platform reported no reason.";
}

export const useProposalStore = create<ProposalState>((set, get) => ({
  identity: null,
  loaded: false,
  error: null,
  notice: null,

  view: "meetings",
  navOpen: false,

  materials: [],
  proposals: [],
  meetings: [],
  settings: DEFAULT_SETTINGS,
  cronState: null,
  onboarding: null,
  selectedProposalId: null,

  context: "",
  meetingQuery: "",
  uploading: false,
  importing: false,
  job: null,
  saving: false,
  commandOpen: false,

  async bootstrap() {
    try {
      const [identity, materials, proposals, meetings, settings, cronState, onboarding] =
        await Promise.all([
          me(),
          refreshMaterials(),
          refreshProposals(),
          refreshMeetings(),
          settingsCol().get("config"),
          stateCol().get("cron"),
          onboardingCol().get("state"),
        ]);
      const needsSetup =
        !onboarding?.dismissed &&
        (meetings.length === 0 || materials.length === 0 || proposals.length === 0);
      set({
        identity,
        materials,
        proposals,
        meetings,
        settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
        cronState,
        onboarding,
        loaded: true,
        view: needsSetup ? "setup" : "meetings",
        selectedProposalId: proposals[0]?.id ?? null,
      });
    } catch (error) {
      set({ error: cleanError(error), loaded: true });
    }
  },

  setView: (view) => set({ view, navOpen: false }),
  setNavOpen: (navOpen) => set({ navOpen }),
  setContext: (context) => set({ context }),
  setMeetingQuery: (meetingQuery) => set({ meetingQuery }),

  async addFiles(fileList) {
    const list = Array.from(fileList);
    if (list.length === 0) return;
    set({ uploading: true, error: null });
    const failures: string[] = [];
    for (const file of list) {
      if (file.size > MAX_MATERIAL_BYTES) {
        failures.push(
          `${file.name} is ${formatBytes(file.size)} — materials are capped at ${formatBytes(MAX_MATERIAL_BYTES)} each.`,
        );
        continue;
      }
      try {
        await files.upload(
          materialStorageName(file.name),
          file,
          file.type || "application/octet-stream",
        );
      } catch (error) {
        failures.push(cleanError(error));
      }
    }
    try {
      const materials = await refreshMaterials();
      set({ materials, uploading: false, error: failures[0] || null });
    } catch (error) {
      set({ uploading: false, error: cleanError(error) });
    }
  },

  async removeMaterial(fileName) {
    try {
      await files.delete(fileName);
      set((s) => ({ materials: s.materials.filter((m) => m.fileName !== fileName) }));
    } catch (error) {
      set({ error: cleanError(error) });
    }
  },

  /**
   * Reads Granola directly through the personal connector and writes the
   * records itself. No agent, no LLM tokens — so importing still works when the
   * org's daily token budget is spent, which is exactly when a new user is most
   * likely to be trying the app for the first time.
   */
  async importMeetings(range) {
    if (get().importing) return;
    set({ importing: true, error: null });
    try {
      const [found, existing] = await Promise.all([
        listGranolaMeetings(range),
        refreshMeetings(),
      ]);
      const byId = new Map(existing.map((m) => [m.id, m]));
      const ownDomain = domainOf(get().identity?.user.email);

      let added = 0;
      for (const g of found) {
        const prior = byId.get(g.id);
        const record: MeetingRecord = {
          id: g.id,
          title: g.title,
          date: g.date || prior?.date || "",
          dateLabel: g.dateLabel,
          attendees: g.attendees,
          external: isExternal(g, ownDomain),
          indexedAt: new Date().toISOString(),
          // Never clobber drafting state on a re-import.
          drafted: prior?.drafted ?? false,
          proposalId: prior?.proposalId ?? null,
        };
        if (!prior) added += 1;
        await meetingsCol().put(g.id, record);
      }

      const meetings = await refreshMeetings();
      set({
        meetings,
        notice: found.length
          ? added
            ? `Imported ${added} new meeting${added === 1 ? "" : "s"}.`
            : "You're up to date."
          : "No meetings found in that window.",
      });
    } catch (error) {
      set({ error: cleanError(error) });
    } finally {
      set({ importing: false });
    }
  },

  async refreshMeetings() {
    await get().importMeetings(get().settings.timeRange);
  },

  async dismissOnboarding() {
    const next: Onboarding = { dismissed: true, dismissedAt: new Date().toISOString() };
    set({ onboarding: next, view: "meetings" });
    try {
      await onboardingCol().put("state", next);
    } catch (error) {
      set({ error: cleanError(error) });
    }
  },

  setCommandOpen: (commandOpen) => set({ commandOpen }),

  async draftFromMeeting(meetingId) {
    if (get().job) return;
    const meeting = get().meetings.find((m) => m.id === meetingId);
    set({
      job: {
        kind: "draft",
        label: `Drafting a proposal from “${meeting?.title ?? "the meeting"}”…`,
        startedAt: Date.now(),
      },
      error: null,
    });
    try {
      await runAgent({
        mode: "draft",
        meeting_id: meetingId,
        context: get().context.trim(),
      });
      const [proposals, meetings] = await Promise.all([refreshProposals(), refreshMeetings()]);
      set({
        proposals,
        meetings,
        selectedProposalId: proposals[0]?.id ?? null,
        context: "",
        view: "proposal",
      });
    } catch (error) {
      set({ error: cleanError(error) });
    } finally {
      set({ job: null });
    }
  },

  async draftFromQuery() {
    const query = get().meetingQuery.trim();
    if (!query || get().job) return;
    set({
      job: { kind: "draft", label: `Finding “${query}” and drafting…`, startedAt: Date.now() },
      error: null,
    });
    try {
      await runAgent({
        mode: "draft",
        meeting_query: query,
        context: get().context.trim(),
      });
      const [proposals, meetings] = await Promise.all([refreshProposals(), refreshMeetings()]);
      set({
        proposals,
        meetings,
        selectedProposalId: proposals[0]?.id ?? null,
        context: "",
        meetingQuery: "",
        view: "proposal",
      });
    } catch (error) {
      set({ error: cleanError(error) });
    } finally {
      set({ job: null });
    }
  },

  /**
   * SuperDoc exports the edited document as a .docx Blob; writing it back under
   * the same file name keeps one canonical document per proposal rather than
   * accumulating near-identical copies.
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

  async saveSettings(partial) {
    const next = { ...get().settings, ...partial };
    set({ settings: next });
    try {
      await settingsCol().put("config", next);
      set({ notice: "Settings saved." });
    } catch (error) {
      set({ error: cleanError(error) });
    }
  },

  selectProposal: (id) => set({ selectedProposalId: id, view: "proposal" }),
  clearError: () => set({ error: null }),
  clearNotice: () => set({ notice: null }),
}));
