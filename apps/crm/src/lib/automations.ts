// Automations: the domain model shared between the app and the managed agent.
//
// One automation ships today — "deal-artifact", which turns a deal's meetings and
// uploaded files into a client-ready .docx or .pptx. The split of work is
// deliberate and worth stating once:
//
//   The app owns triggering, ingestion and the UI. It reads Granola (a personal
//   connector, only reachable from the page), mints every id, uploads every input
//   file, and starts the run.
//
//   Two agents own the sandbox. `crm-style-measurer` reads an uploaded template and
//   returns its measured design system, which the app caches as the style profile.
//   `crm-artifact-writer` reads files, renders the document, publishes it, and writes
//   the artifacts / activities / automationRuns records itself. That last part is
//   what lets a generate run outlive the tab that started it: the browser is not
//   required to be alive for the artifact to land.
//
// Everything below is shared-scope (`db.collection` / `files`), because the CRM's data
// is shared and an artifact belongs to the deal rather than to whoever triggered it.

import { gatewayErrorMessage } from "@/lib/crm";

export const AUTOMATION_ID = "deal-artifact";
/** Renders the document and writes the records — the generate path. */
export const AGENT_NAME = "crm-artifact-writer";
/** Measures an uploaded template's design system; the writer applies the result. */
export const MEASURE_AGENT_NAME = "crm-style-measurer";

export type ArtifactFormat = "docx" | "pptx";

export const FORMAT_LABEL: Record<ArtifactFormat, string> = {
  docx: "Word document",
  pptx: "PowerPoint deck",
};

export const FORMAT_MIME: Record<ArtifactFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// --- file layout -----------------------------------------------------------
//
// Prefixes, not folders — the file store is flat and keyed by name, but a slash in
// a published name survives intact (verified against the live store), so a prefix
// gives us per-deal grouping for free.

export const TEMPLATES_PREFIX = "templates/";
export const CONTEXT_PREFIX = "context/";

export function dealInputsPrefix(dealId: string): string {
  return `deals/${dealId}/inputs/`;
}

export function dealArtifactsPrefix(dealId: string): string {
  return `deals/${dealId}/artifacts/`;
}

/** Where a generated artifact lands. The app decides this, not the agent — the
 *  agent publishes under the exact name it is handed. */
export function artifactFileName(
  dealId: string,
  artifactId: string,
  format: ArtifactFormat,
): string {
  return `${dealArtifactsPrefix(dealId)}${artifactId}.${format}`;
}

/** The last path segment — what a person should see for a prefixed file name. */
export function displayName(fileName: string): string {
  const tail = fileName.split("/").pop();
  return tail && tail.length ? tail : fileName;
}

/**
 * A user-supplied filename made safe to append to a prefix. Slashes would forge a
 * new prefix and land the file somewhere it doesn't belong, so they collapse along
 * with anything else awkward to round-trip through a URL.
 */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .trim();
  return cleaned.length ? cleaned : "file";
}

/** Files this big are almost always a mistake, and the agent has to read them
 *  inside a 300-second run. Templates and decks are the large end of normal. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function formatBytes(bytes?: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const TEXTUAL_EXTENSIONS = [
  "pdf",
  "docx",
  "doc",
  "pptx",
  "ppt",
  "xlsx",
  "xls",
  "csv",
  "txt",
  "md",
  "json",
];

export function extensionOf(name: string): string {
  const tail = displayName(name);
  const dot = tail.lastIndexOf(".");
  return dot > 0 ? tail.slice(dot + 1).toLowerCase() : "";
}

// --- style profile ---------------------------------------------------------

/**
 * The design system the measuring agent reads off an uploaded template, cached so
 * every generate run doesn't have to spend its 300 seconds re-deriving the same
 * fonts and margins. Re-measure to refresh it; the company-context text is where a
 * person overrides something the measurement got wrong.
 */
export type StyleProfile = {
  summary: string;
  fonts: string[];
  colors: string[];
  /** Section / slide names in the order the template uses them. */
  structure: string[];
  metrics: { label: string; value: string }[];
  templateFile?: string;
  extractedAt?: string;
};

export function emptyStyleProfile(): StyleProfile {
  return { summary: "", fonts: [], colors: [], structure: [], metrics: [] };
}

export function hasStyle(profile?: StyleProfile | null): boolean {
  return Boolean(
    profile &&
      (profile.summary.trim() ||
        profile.fonts.length ||
        profile.colors.length ||
        profile.structure.length),
  );
}

// --- config ----------------------------------------------------------------
//
// Two records, deliberately split: setup that every automation draws on, and the
// per-automation switches. They used to be one object, which only worked while there
// was exactly one automation — the moment a second appeared, "the company context"
// would have been owned by whichever automation happened to be written first.

/** Workspace-level setup. One record, shared by every automation. */
export type AutomationSettings = {
  /** Standing text about the user's own company, pasted into every run. */
  companyContext: string;
  /** One measured profile per format — a deck and a document differ. */
  style: Partial<Record<ArtifactFormat, StyleProfile>>;
  updatedAt?: string;
};

export const SETTINGS_KEY = "workspace";

export const DEFAULT_SETTINGS: AutomationSettings = {
  companyContext: "",
  style: {},
};

/** Per-automation switches. One record per automation id. */
export type AutomationRecord = {
  id: string;
  enabled: boolean;
  /** Used when a trigger doesn't name a format. */
  defaultFormat: ArtifactFormat;
  updatedAt?: string;
};

export function defaultRecord(id: string): AutomationRecord {
  return { id, enabled: true, defaultFormat: "docx" };
}

/**
 * The pre-split shape, where workspace setup lived inside the `deal-artifact`
 * record. Read once on load so context somebody already typed survives the change.
 */
export type LegacyAutomationConfig = Partial<AutomationRecord> &
  Partial<AutomationSettings>;

export function legacySettings(
  legacy: LegacyAutomationConfig | null | undefined,
): Partial<AutomationSettings> | null {
  if (!legacy) return null;
  const hasContext = typeof legacy.companyContext === "string" && legacy.companyContext.trim();
  const hasStyle = legacy.style && Object.keys(legacy.style).length > 0;
  if (!hasContext && !hasStyle) return null;
  return {
    ...(hasContext ? { companyContext: legacy.companyContext as string } : {}),
    ...(hasStyle ? { style: legacy.style as AutomationSettings["style"] } : {}),
  };
}

export type SetupStatus = {
  hasContext: boolean;
  templates: number;
  materials: number;
  /** Templates uploaded but never measured — the commonest half-finished state. */
  unmeasured: ArtifactFormat[];
  /** Runnable without a template; it just won't look like the house style. */
  ready: boolean;
};

/**
 * Templates whose style profile is missing or was measured against a file that has
 * since been replaced. Measuring is automatic, so this is the work list for that —
 * and anything left in it is a measurement that didn't succeed.
 */
export function needsMeasure(
  settings: AutomationSettings,
  templates: FileRef[],
): ArtifactFormat[] {
  return (["docx", "pptx"] as ArtifactFormat[]).filter((format) => {
    const template = templateFor(templates, format);
    if (!template) return false;
    const profile = settings.style[format];
    if (!hasStyle(profile)) return true;
    return profile?.templateFile !== template.fileName;
  });
}

export function setupStatus(
  settings: AutomationSettings,
  templates: FileRef[],
  materials: FileRef[],
): SetupStatus {
  const unmeasured = needsMeasure(settings, templates);
  const hasContext = settings.companyContext.trim().length > 0;
  return {
    hasContext,
    templates: templates.length,
    materials: materials.length,
    unmeasured,
    ready: hasContext || templates.length > 0 || materials.length > 0,
  };
}

/** The single most useful thing left to do, or null when setup is in good shape. */
export function nextSetupStep(status: SetupStatus): string | null {
  if (!status.templates) {
    return "Upload a brand template — it changes how the output looks more than anything else here.";
  }
  // Measuring happens on its own after an upload, so reaching here means it
  // didn't get through — this is a retry prompt, not a chore nobody did.
  if (status.unmeasured.length) {
    return `Your .${status.unmeasured[0]} template couldn't be measured — open Brand templates and try again, or its fonts and layout get guessed.`;
  }
  if (!status.hasContext) {
    return "Add your company context so pricing and tone come from you instead of being left blank.";
  }
  return null;
}

// --- files -----------------------------------------------------------------

export type FileRef = {
  /** Full storage name, prefix included. */
  fileName: string;
  /** Last path segment, for display. */
  name: string;
  contentType?: string;
  size?: number;
  updatedAt?: string;
};

export function templateFor(
  templates: FileRef[],
  format: ArtifactFormat,
): FileRef | undefined {
  return templates.find((t) => extensionOf(t.fileName) === format);
}

// --- records ---------------------------------------------------------------

/** Written by the AGENT (see agents/crm-artifact-writer/agent.yaml step 9). */
export type ArtifactRecord = {
  id: string;
  dealId: string;
  fileName: string;
  format: ArtifactFormat;
  title: string;
  summary: string;
  sections: string[];
  /** Bracketed gaps the agent deliberately left for a human to fill. */
  placeholders: string[];
  meetingIds: string[];
  sourcesUsed: string[];
  createdAt: string;
  runId: string;
  source: string;
};

export type RunStatus = "running" | "done" | "failed";

export type RunRecord = {
  id: string;
  dealId: string;
  automationId: string;
  status: RunStatus;
  format: ArtifactFormat;
  artifactId?: string | null;
  /** The agent run this maps to, so a reloaded tab can resume polling it. */
  requestId?: string | null;
  dealTitle?: string;
  startedAt?: string;
  startedBy?: string;
  finishedAt?: string;
  error?: string | null;
};

/**
 * A `running` record this old is not running any more.
 *
 * The agent writes the terminal record, so a normal run closes itself out whether
 * or not the browser is still open. What this covers is the case where the run died
 * hard enough that nothing wrote anything — otherwise the deal would show a spinner
 * for ever. A run is capped at 300s by the platform; this leaves generous slack for
 * queueing on top.
 */
export const STALE_RUN_MS = 12 * 60 * 1000;

export function isStale(run: RunRecord, now = Date.now()): boolean {
  if (run.status !== "running") return false;
  const started = run.startedAt ? new Date(run.startedAt).getTime() : 0;
  if (!started || Number.isNaN(started)) return true;
  return now - started > STALE_RUN_MS;
}

/** What the UI should treat a record as, folding stale `running` into failure. */
export function effectiveStatus(run: RunRecord, now = Date.now()): RunStatus {
  return isStale(run, now) ? "failed" : run.status;
}

export const STALE_RUN_MESSAGE =
  "The run stopped without reporting back. Nothing was saved — trying again is safe.";

// --- meeting triage --------------------------------------------------------

/**
 * A decision about one Granola meeting, kept in SHARED scope on purpose: "this
 * meeting is not a deal" is true for the whole team, and a per-user set would make
 * everyone re-triage the same noise.
 */
export type MeetingTriage = {
  meetingId: string;
  status: "dismissed" | "linked";
  /** The deal a "linked" decision created or attached to. */
  dealId?: string;
  title?: string;
  decidedAt: string;
  decidedBy?: string;
};

/** How far back the Home triage list looks. */
export const TRIAGE_WINDOW_DAYS = 7;

export function withinTriageWindow(iso: string, now = Date.now()): boolean {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  return now - then <= TRIAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

// --- notifications ---------------------------------------------------------

export type NotificationKind = "artifact" | "failure";

/** Derived, never stored: built from shared artifacts + runs, marked read per-user. */
export type Notification = {
  id: string;
  kind: NotificationKind;
  at: string;
  title: string;
  body: string;
  dealId: string;
  /** Present for artifacts — what the download link points at. */
  fileName?: string;
  format?: ArtifactFormat;
  read: boolean;
};

/** Per-user read state. The only thing about automations that isn't shared. */
export type NotificationState = {
  readIds: string[];
};

export const EMPTY_NOTIFICATION_STATE: NotificationState = { readIds: [] };

// --- failures --------------------------------------------------------------

/**
 * Explanations for the run failures a person can actually act on. Anything not
 * listed falls through to the platform's own message — never to a generic "didn't
 * finish", which hides a diagnosis the API already handed us.
 *
 * Note that a token-quota failure arrives as status "failed" with this code, NOT as
 * "limit_exceeded" — that one means the agent's own manifest limits were hit.
 */
export const FAILURE_HELP: Record<string, string> = {
  daily_token_limit_exceeded:
    "The workspace's daily LLM token limit is used up, so the run stopped before writing anything. It resets daily, or an admin can raise the cap — nothing was lost.",
  invalid_input:
    "The request didn't match what the agent expects. That's a bug in this app rather than anything you did.",
  timeout:
    "The run hit its five-minute limit before finishing. Fewer or smaller files usually gets it through.",
  provider_auth_error:
    "The LLM provider rejected its API key. An admin needs to update the provider credentials in Railcode.",
  provider_rate_limited:
    "The model provider is rate-limiting requests. Wait a moment and run it again.",
};

export type AgentFailure = {
  status?: string;
  error_code?: string | null;
  error_message?: string | null;
};

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** True under `railcode dev`, which emulates storage but has no agent runner. */
export function isLocalDev(): boolean {
  return typeof window !== "undefined" && LOCAL_HOSTS.has(window.location.hostname);
}

/**
 * A thrown SDK error, turned into something with a fix in it.
 *
 * The 404 case is the one worth special-casing: `railcode dev` emulates KV and files
 * locally but does not run managed agents, so every generate attempt against the dev
 * proxy fails with a bare `{"detail":"not found"}` that reads like a missing agent.
 */
export function agentCallError(error: unknown, agentName: string = AGENT_NAME): string {
  const raw = error instanceof Error ? error.message : String(error);
  let detail = raw;
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; message?: unknown };
    if (typeof parsed?.detail === "string") detail = parsed.detail;
    else if (typeof parsed?.message === "string") detail = parsed.message;
  } catch {
    /* not JSON — the raw text is the best we have */
  }

  if (/not found/i.test(detail)) {
    return isLocalDev()
      ? "`railcode dev` emulates storage locally but doesn't run managed agents, so generating documents only works against the deployed app. Everything else on this page works here."
      : `The platform couldn't find the "${agentName}" agent. It may not have been created yet, or this app's manifest may need to declare it and be ratified.`;
  }
  if (/forbidden|not authorized|permission/i.test(detail)) {
    return `This app isn't allowed to run "${agentName}". Its manifest needs to declare the agent and be ratified by an admin.`;
  }
  return gatewayErrorMessage(detail) ?? detail ?? "Couldn't start the run.";
}

export function runFailureMessage(run: AgentFailure): string {
  const code = run.error_code ?? undefined;
  const detail = run.error_message ?? undefined;

  if (code && FAILURE_HELP[code]) return FAILURE_HELP[code];
  if (run.status === "limit_exceeded") {
    return `The run exceeded the agent's own limits (steps, tokens or time) before finishing.${
      detail ? ` ${detail}` : ""
    }`;
  }
  if (run.status === "cancelled") return "The run was cancelled before it finished.";
  if (detail) return code ? `${detail} (${code})` : detail;
  if (code) return `The run failed: ${code}`;
  return "The run didn't finish, and the platform reported no reason.";
}
