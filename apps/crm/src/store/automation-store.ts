import { create } from "zustand";

import {
  AGENT_NAME,
  AUTOMATION_ID,
  ArtifactFormat,
  ArtifactRecord,
  AutomationRecord,
  AutomationSettings,
  CONTEXT_PREFIX,
  DEFAULT_SETTINGS,
  EMPTY_NOTIFICATION_STATE,
  LegacyAutomationConfig,
  MEASURE_AGENT_NAME,
  SETTINGS_KEY,
  FileRef,
  MAX_UPLOAD_BYTES,
  Notification,
  NotificationState,
  RunRecord,
  STALE_RUN_MESSAGE,
  StyleProfile,
  TEMPLATES_PREFIX,
  agentCallError,
  artifactFileName,
  defaultRecord,
  legacySettings,
  dealArtifactsPrefix,
  dealInputsPrefix,
  displayName,
  effectiveStatus,
  extensionOf,
  formatBytes,
  isStale,
  needsMeasure,
  runFailureMessage,
  safeFileName,
  templateFor,
} from "@/lib/automations";
import { CallNote, cleanError, gatewayErrorMessage, newId, nowIso } from "@/lib/crm";
import {
  AgentRun,
  agents,
  collection,
  fileStore,
  userCollection,
} from "@/lib/railcode";
import { useCrmStore } from "@/store/crm-store";

/** Per-automation switches, keyed by automation id. */
const recordsCol = () => collection<LegacyAutomationConfig>("automations");
/** Workspace setup, one row. */
const settingsCol = () => collection<AutomationSettings>("automationSettings");
const artifactsCol = () => collection<ArtifactRecord>("artifacts");
const runsCol = () => collection<RunRecord>("automationRuns");
/** Read state is the one per-user thing here — the artifacts themselves are shared. */
const notifCol = () => userCollection<NotificationState>("notifRead");

/** How many meetings to hand one run. The agent re-reads its input every turn, so
 *  this is a token budget, not a UI limit. Newest first — the recent call is the
 *  one the proposal is actually about. */
const MAX_MEETINGS_PER_RUN = 6;

const POLL_INTERVAL_MS = 3000;

type UploadBucket = "template" | "material";

type AutomationState = {
  loaded: boolean;
  error?: string;
  notice?: string;

  /** Workspace setup, shared by every automation. */
  settings: AutomationSettings;
  /** Per-automation switches, keyed by automation id. */
  records: Record<string, AutomationRecord>;
  /** Every file in the app store; the buckets below are views over it. */
  files: FileRef[];
  artifacts: ArtifactRecord[];
  runs: RunRecord[];
  notifState: NotificationState;

  uploading: boolean;
  saving: boolean;
  /** Format currently being measured, so the button can show progress. */
  extracting: ArtifactFormat | null;

  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;

  saveSettings: (patch: Partial<AutomationSettings>) => Promise<void>;
  saveRecord: (id: string, patch: Partial<AutomationRecord>) => Promise<void>;
  saveStyle: (format: ArtifactFormat, profile: StyleProfile) => Promise<void>;
  extractStyle: (format: ArtifactFormat) => Promise<void>;
  /** Measures any template that needs it, without being asked. */
  measurePending: () => Promise<void>;

  uploadFiles: (bucket: UploadBucket, files: FileList | File[]) => Promise<void>;
  uploadDealInputs: (dealId: string, files: FileList | File[]) => Promise<void>;
  removeFile: (fileName: string) => Promise<void>;

  runArtifact: (input: {
    dealId: string;
    format: ArtifactFormat;
    extraContext?: string;
  }) => Promise<void>;

  markRead: (ids: string[]) => Promise<void>;

  clearError: () => void;
  clearNotice: () => void;
};

// --- derivations -----------------------------------------------------------

function toRef(f: {
  name: string;
  content_type?: string;
  size?: number;
  updated_at?: string;
}): FileRef {
  return {
    fileName: f.name,
    name: displayName(f.name),
    contentType: f.content_type,
    size: f.size,
    updatedAt: f.updated_at,
  };
}

function byPrefix(files: FileRef[], prefix: string): FileRef[] {
  return files
    .filter((f) => f.fileName.startsWith(prefix))
    .sort((a, b) => ((a.updatedAt ?? "") < (b.updatedAt ?? "") ? 1 : -1));
}

export function templateFiles(files: FileRef[]): FileRef[] {
  return byPrefix(files, TEMPLATES_PREFIX);
}

export function materialFiles(files: FileRef[]): FileRef[] {
  return byPrefix(files, CONTEXT_PREFIX);
}

export function dealInputFiles(files: FileRef[], dealId: string): FileRef[] {
  return byPrefix(files, dealInputsPrefix(dealId));
}

export function dealArtifactFiles(files: FileRef[], dealId: string): FileRef[] {
  return byPrefix(files, dealArtifactsPrefix(dealId));
}

/**
 * Meetings that plausibly belong to a deal: those attached to its contact, plus
 * anyone else at its company, plus the legacy company-scoped notes imported before
 * per-person matching existed.
 */
export function meetingsForDeal(dealId: string): CallNote[] {
  const s = useCrmStore.getState();
  const deal = s.deals.find((d) => d.id === dealId);
  if (!deal) return [];

  const people = new Set<string>();
  if (deal.contactId) people.add(deal.contactId);
  if (deal.companyId) {
    s.contacts
      .filter((c) => c.companyId === deal.companyId)
      .forEach((c) => people.add(c.id));
  }

  return s.callNotes
    .filter(
      (n) =>
        (n.contactIds ?? []).some((id) => people.has(id)) ||
        (deal.companyId && n.companyId === deal.companyId),
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Newest run for a deal, so a card can show "generating…" without a lookup. */
export function runForDeal(runs: RunRecord[], dealId: string): RunRecord | undefined {
  return runs
    .filter((r) => r.dealId === dealId)
    .sort((a, b) => ((a.startedAt ?? "") < (b.startedAt ?? "") ? 1 : -1))[0];
}

export function isGenerating(runs: RunRecord[], dealId: string): boolean {
  const run = runForDeal(runs, dealId);
  return Boolean(run && effectiveStatus(run) === "running");
}

/**
 * The notifications feed: every artifact, plus every run that failed. Derived on
 * read rather than stored, so a shared artifact is one record and "have I seen it"
 * stays a per-user concern.
 */
export function notifications(
  artifacts: ArtifactRecord[],
  runs: RunRecord[],
  state: NotificationState,
): Notification[] {
  const read = new Set(state.readIds);
  const deals = useCrmStore.getState().deals;
  const dealTitle = (id: string) =>
    deals.find((d) => d.id === id)?.title ?? "a deleted deal";

  const items: Notification[] = artifacts.map((a) => ({
    id: a.id,
    kind: "artifact" as const,
    at: a.createdAt,
    title: a.title || displayName(a.fileName),
    body: a.summary || `${a.format.toUpperCase()} for ${dealTitle(a.dealId)}`,
    dealId: a.dealId,
    fileName: a.fileName,
    format: a.format,
    read: read.has(a.id),
  }));

  for (const run of runs) {
    if (effectiveStatus(run) !== "failed") continue;
    const stored = (isStale(run) ? STALE_RUN_MESSAGE : run.error) || STALE_RUN_MESSAGE;
    items.push({
      id: run.id,
      kind: "failure",
      at: run.finishedAt ?? run.startedAt ?? nowIso(),
      title: `Couldn't generate for ${run.dealTitle ?? dealTitle(run.dealId)}`,
      // Records written before the error messages were cleaned up can hold raw JSON
      // or a whole gateway error page; the feed shouldn't render that.
      body: gatewayErrorMessage(stored) ?? stored,
      dealId: run.dealId,
      read: read.has(run.id),
    });
  }

  return items.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function unreadCount(
  artifacts: ArtifactRecord[],
  runs: RunRecord[],
  state: NotificationState,
): number {
  return notifications(artifacts, runs, state).filter((n) => !n.read).length;
}

// --- agent plumbing --------------------------------------------------------

/** Request ids already being polled, so a resume on load and a fresh trigger
 *  can't end up watching the same run twice. */
const watching = new Set<string>();

function terminal(run: AgentRun): boolean {
  return run.status !== "queued" && run.status !== "running";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses the agent's final JSON message, which may arrive fenced or prose-wrapped. */
function parseAgentJson(output: unknown): Record<string, unknown> | null {
  const text =
    typeof output === "string"
      ? output
      : typeof (output as { text?: unknown })?.text === "string"
        ? ((output as { text: string }).text)
        : null;
  if (!text) {
    return output && typeof output === "object"
      ? (output as Record<string, unknown>)
      : null;
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const useAutomationStore = create<AutomationState>((set, get) => {
  /** `format:fileName` of every template auto-measured this page load. */
  const autoMeasured = new Set<string>();

  /** Re-reads the two shared collections the agent writes. */
  async function pullRecords() {
    const [artifactRows, runRows, fileRows] = await Promise.all([
      artifactsCol().list(),
      runsCol().list(),
      fileStore.list(),
    ]);
    set({
      artifacts: artifactRows
        .map((r) => r.value)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      runs: runRows.map((r) => r.value),
      files: fileRows.map(toRef),
    });
  }

  async function putRun(run: RunRecord) {
    await runsCol().put(run.id, run);
    set((s) => ({
      runs: s.runs.some((r) => r.id === run.id)
        ? s.runs.map((r) => (r.id === run.id ? run : r))
        : [run, ...s.runs],
    }));
  }

  /**
   * Watches one agent run to completion.
   *
   * On success the agent has already written the artifact, the activity and the
   * terminal run record — so this only has to pull them and refresh the deal
   * timeline. On failure it writes the failed record itself, because a run that
   * died may not have got that far.
   */
  async function watch(requestId: string, runId: string) {
    if (watching.has(requestId)) return;
    watching.add(requestId);
    try {
      let run = await agents.get(requestId);
      while (!terminal(run)) {
        await sleep(POLL_INTERVAL_MS);
        run = await agents.get(requestId);
      }

      if (run.status === "success") {
        await pullRecords();
        await useCrmStore.getState().refreshActivities();
        const artifact = get().artifacts.find((a) => a.runId === runId);
        set({
          notice: artifact
            ? `“${artifact.title || displayName(artifact.fileName)}” is ready.`
            : "The run finished.",
        });
        return;
      }

      const existing = get().runs.find((r) => r.id === runId);
      await putRun({
        ...(existing ?? {
          id: runId,
          dealId: "",
          automationId: AUTOMATION_ID,
          format: "docx" as ArtifactFormat,
        }),
        id: runId,
        status: "failed",
        requestId,
        finishedAt: nowIso(),
        error: runFailureMessage(run),
      });
      set({ error: runFailureMessage(run) });
    } catch (error) {
      // Losing the poll (tab slept, network blipped) doesn't mean the run failed —
      // the agent writes its own terminal record, so leave the record alone and let
      // the next refresh or the staleness cutoff settle it.
      set({ error: cleanError(error) });
    } finally {
      watching.delete(requestId);
    }
  }

  /** Picks polling back up for runs that were in flight when the tab last closed. */
  async function resumeWatching() {
    for (const run of get().runs) {
      if (run.status !== "running" || !run.requestId) continue;
      if (isStale(run)) {
        await putRun({
          ...run,
          status: "failed",
          finishedAt: nowIso(),
          error: STALE_RUN_MESSAGE,
        });
        continue;
      }
      void watch(run.requestId, run.id);
    }
  }

  async function uploadTo(prefix: string, list: File[]): Promise<string[]> {
    const failures: string[] = [];
    for (const file of list) {
      if (file.size > MAX_UPLOAD_BYTES) {
        failures.push(
          `${file.name} is ${formatBytes(file.size)} — files are capped at ${formatBytes(MAX_UPLOAD_BYTES)}.`,
        );
        continue;
      }
      try {
        await fileStore.upload(
          `${prefix}${safeFileName(file.name)}`,
          file,
          file.type || "application/octet-stream",
        );
      } catch (error) {
        failures.push(cleanError(error));
      }
    }
    return failures;
  }

  return {
    loaded: false,
    settings: DEFAULT_SETTINGS,
    records: {},
    files: [],
    artifacts: [],
    runs: [],
    notifState: EMPTY_NOTIFICATION_STATE,
    uploading: false,
    saving: false,
    extracting: null,

    async bootstrap() {
      try {
        const [storedSettings, recordRows, notifState] = await Promise.all([
          settingsCol().get(SETTINGS_KEY),
          recordsCol().list(),
          notifCol().get("state"),
          pullRecords(),
        ]);

        const records: Record<string, AutomationRecord> = {};
        for (const row of recordRows) {
          const value = row.value ?? {};
          records[row.key] = {
            ...defaultRecord(row.key),
            ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
            ...(value.defaultFormat ? { defaultFormat: value.defaultFormat } : {}),
            id: row.key,
          };
        }

        // Workspace setup used to live inside the deal-artifact record. Adopt it once
        // rather than silently starting blank on somebody who already filled it in.
        let settings: AutomationSettings = { ...DEFAULT_SETTINGS, ...(storedSettings ?? {}) };
        if (!storedSettings) {
          const adopted = legacySettings(
            recordRows.find((r) => r.key === AUTOMATION_ID)?.value,
          );
          if (adopted) {
            settings = { ...settings, ...adopted, updatedAt: nowIso() };
            await settingsCol().put(SETTINGS_KEY, settings);
          }
        }

        set({
          settings,
          records,
          notifState: { ...EMPTY_NOTIFICATION_STATE, ...(notifState ?? {}) },
          loaded: true,
        });
        void resumeWatching();
        // A template uploaded before this ran, or one whose measurement was cut
        // short by a reload, still needs measuring — and still shouldn't be asked for.
        void get().measurePending();
      } catch (error) {
        set({ error: cleanError(error), loaded: true });
      }
    },

    async refresh() {
      try {
        await pullRecords();
        // A run whose poll was lost still needs to stop showing a spinner.
        for (const run of get().runs) {
          if (isStale(run)) {
            await putRun({
              ...run,
              status: "failed",
              finishedAt: nowIso(),
              error: STALE_RUN_MESSAGE,
            });
          }
        }
      } catch (error) {
        set({ error: cleanError(error) });
      }
    },

    async saveSettings(patch) {
      const next: AutomationSettings = {
        ...get().settings,
        ...patch,
        updatedAt: nowIso(),
      };
      set({ settings: next, saving: true });
      try {
        await settingsCol().put(SETTINGS_KEY, next);
      } catch (error) {
        set({ error: cleanError(error) });
      } finally {
        set({ saving: false });
      }
    },

    async saveRecord(id, patch) {
      const next: AutomationRecord = {
        ...(get().records[id] ?? defaultRecord(id)),
        ...patch,
        id,
        updatedAt: nowIso(),
      };
      set((s) => ({ records: { ...s.records, [id]: next }, saving: true }));
      try {
        await recordsCol().put(id, next);
      } catch (error) {
        set({ error: cleanError(error) });
      } finally {
        set({ saving: false });
      }
    },

    async saveStyle(format, profile) {
      await get().saveSettings({
        style: { ...get().settings.style, [format]: profile },
      });
    },

    /**
     * Runs the measuring agent over an uploaded template once and caches the result,
     * so a generate run doesn't spend its 300 seconds re-deriving the same fonts and
     * margins.
     */
    async extractStyle(format) {
      const template = templateFor(templateFiles(get().files), format);
      if (!template) {
        set({ error: `Upload a .${format} template first.` });
        return;
      }
      set({ extracting: format, error: undefined });
      try {
        const run = await agents.invoke(MEASURE_AGENT_NAME, {
          format,
          template_file: template.fileName,
        });
        if (run.status !== "success") {
          set({ error: runFailureMessage(run) });
          return;
        }
        const parsed = parseAgentJson(run.output_json);
        if (!parsed || parsed.error) {
          set({
            error:
              typeof parsed?.error === "string"
                ? parsed.error
                : "The agent didn't return a usable style profile.",
          });
          return;
        }
        const asStrings = (value: unknown): string[] =>
          Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
        await get().saveStyle(format, {
          summary: typeof parsed.summary === "string" ? parsed.summary : "",
          fonts: asStrings(parsed.fonts),
          colors: asStrings(parsed.colors),
          structure: asStrings(parsed.structure),
          metrics: Array.isArray(parsed.metrics)
            ? (parsed.metrics as { label?: unknown; value?: unknown }[])
                .filter((m) => typeof m?.label === "string" && typeof m?.value === "string")
                .map((m) => ({ label: m.label as string, value: m.value as string }))
            : [],
          templateFile: template.fileName,
          extractedAt: nowIso(),
        });
        set({ notice: `Measured ${template.name}.` });
      } catch (error) {
        set({ error: agentCallError(error, MEASURE_AGENT_NAME) });
      } finally {
        set({ extracting: null });
      }
    },

    /**
     * Measures every template that needs it — a fresh upload, or one whose file was
     * replaced after the last measurement. An unmeasured template is inert, so this
     * runs on its own rather than waiting for someone to ask.
     *
     * One automatic attempt per file per page load: a template the agent can't read
     * would otherwise be retried on every upload and every reload. The button in the
     * template slot is the retry, and it doesn't go through here.
     */
    async measurePending() {
      for (const format of needsMeasure(get().settings, templateFiles(get().files))) {
        const template = templateFor(templateFiles(get().files), format);
        if (!template) continue;
        const attempt = `${format}:${template.fileName}`;
        if (autoMeasured.has(attempt)) continue;
        autoMeasured.add(attempt);
        await get().extractStyle(format);
      }
    },

    async uploadFiles(bucket, files) {
      const list = Array.from(files);
      if (!list.length) return;
      set({ uploading: true, error: undefined });
      const failures = await uploadTo(
        bucket === "template" ? TEMPLATES_PREFIX : CONTEXT_PREFIX,
        list,
      );
      try {
        set({ files: (await fileStore.list()).map(toRef) });
      } catch (error) {
        failures.push(cleanError(error));
      }
      // Drop the upload spinner before measuring: that step reports itself.
      set({ uploading: false, error: failures[0] });
      if (bucket === "template" && !failures.length) await get().measurePending();
    },

    async uploadDealInputs(dealId, files) {
      const list = Array.from(files);
      if (!list.length) return;
      set({ uploading: true, error: undefined });
      const failures = await uploadTo(dealInputsPrefix(dealId), list);
      try {
        set({ files: (await fileStore.list()).map(toRef) });
      } catch (error) {
        failures.push(cleanError(error));
      }
      set({ uploading: false, error: failures[0] });
    },

    async removeFile(fileName) {
      try {
        await fileStore.delete(fileName);
        set((s) => ({ files: s.files.filter((f) => f.fileName !== fileName) }));
        // An artifact's record outliving its file would render a dead download link.
        const orphan = get().artifacts.find((a) => a.fileName === fileName);
        if (orphan) {
          await artifactsCol().delete(orphan.id);
          set((s) => ({ artifacts: s.artifacts.filter((a) => a.id !== orphan.id) }));
        }
      } catch (error) {
        set({ error: cleanError(error) });
      }
    },

    /**
     * Starts one generate run and returns as soon as it is queued.
     *
     * Every id is minted here and handed to the agent, which uses them as KV keys —
     * so the artifact, the timeline entry and the run record all land under ids in
     * this app's own format, and the agent never has to invent one. The run record
     * is written BEFORE the agent is started: that row is what a reloaded tab uses
     * to find its way back to an in-flight run.
     */
    async runArtifact({ dealId, format, extraContext }) {
      const crm = useCrmStore.getState();
      const deal = crm.deals.find((d) => d.id === dealId);
      if (!deal) {
        set({ error: "That deal no longer exists." });
        return;
      }
      if (isGenerating(get().runs, dealId)) {
        set({ error: "A run is already going for this deal." });
        return;
      }

      const runId = newId("run");
      const artifactId = newId("ar");
      const activityId = newId("act");
      const outputFile = artifactFileName(dealId, artifactId, format);
      const files = get().files;
      const company = deal.companyId
        ? crm.companies.find((c) => c.id === deal.companyId)
        : undefined;
      const contact = deal.contactId
        ? crm.contacts.find((c) => c.id === deal.contactId)
        : undefined;

      const record: RunRecord = {
        id: runId,
        dealId,
        automationId: AUTOMATION_ID,
        status: "running",
        format,
        artifactId,
        dealTitle: deal.title,
        startedAt: nowIso(),
        startedBy: crm.identity?.user.name,
        error: null,
      };

      try {
        await putRun(record);

        const meetings = meetingsForDeal(dealId)
          .slice(0, MAX_MEETINGS_PER_RUN)
          .map((n) => ({
            meetingId: n.meetingId,
            title: n.title,
            date: n.date,
            attendees: n.attendees,
            notes: n.notesMarkdown,
            hasTranscript: Boolean(n.hasTranscript),
          }));

        const started = await agents.start(AGENT_NAME, {
          run_id: runId,
          artifact_id: artifactId,
          activity_id: activityId,
          // The sandbox has no reliable clock — left to guess, the agent stamped an
          // artifact half an hour before the run that made it, which sorts it into the
          // wrong place in every list. The app owns time, as it owns the ids.
          created_at: record.startedAt,
          deal_id: dealId,
          format,
          output_file: outputFile,
          template_file: templateFor(templateFiles(files), format)?.fileName ?? null,
          material_files: materialFiles(files).map((f) => ({
            file: f.fileName,
            name: f.name,
          })),
          input_files: dealInputFiles(files, dealId).map((f) => ({
            file: f.fileName,
            name: f.name,
          })),
          style_profile: get().settings.style[format] ?? null,
          company_context: get().settings.companyContext,
          extra_context: extraContext?.trim() ?? "",
          deal: {
            title: deal.title,
            value: deal.value ?? null,
            stage: deal.stage,
            notes: deal.notes ?? "",
            company: company
              ? { name: company.name, domain: company.domain ?? null, industry: company.industry ?? null }
              : null,
            contact: contact
              ? { name: contact.name, email: contact.email ?? null, title: contact.title ?? null }
              : null,
          },
          meetings,
        });

        await putRun({ ...record, requestId: started.request_id });
        set({
          notice: `Generating a ${format === "pptx" ? "deck" : "document"} for ${deal.title}. It keeps going if you navigate away.`,
        });
        void watch(started.request_id, runId);
      } catch (error) {
        const message = agentCallError(error);
        await putRun({
          ...record,
          status: "failed",
          finishedAt: nowIso(),
          error: message,
        }).catch(() => undefined);
        set({ error: message });
      }
    },

    async markRead(ids) {
      if (!ids.length) return;
      const merged = Array.from(new Set([...get().notifState.readIds, ...ids]));
      // Pruned to ids that still exist, so the list can't grow without bound as
      // artifacts and runs are deleted.
      const live = new Set([
        ...get().artifacts.map((a) => a.id),
        ...get().runs.map((r) => r.id),
      ]);
      const next: NotificationState = { readIds: merged.filter((id) => live.has(id)) };
      set({ notifState: next });
      try {
        await notifCol().put("state", next);
      } catch (error) {
        set({ error: cleanError(error) });
      }
    },

    clearError: () => set({ error: undefined }),
    clearNotice: () => set({ notice: undefined }),
  };
});

/** A file's download URL. Artifacts are served from the app's own file store. */
export function fileUrl(fileName: string): string {
  return fileStore.url(fileName);
}

/** One automation's switches, defaulted for an id that has never been saved. */
export function automationRecord(
  records: Record<string, AutomationRecord>,
  id: string,
): AutomationRecord {
  return records[id] ?? defaultRecord(id);
}

export { extensionOf };
