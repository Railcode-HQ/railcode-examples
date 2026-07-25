// Everything in this file describes data the AGENT wrote. The app creates no
// records of its own except the `edited` fields below — it is a reader.

export type ProposalRecord = {
  id: string;
  fileName: string; // "proposals/proposal-acme-20260718-153000.docx"
  title: string;
  client: string;
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  createdAt: string;
  summary: string;
  /** Section names in order — the agent reads these back to keep house structure. */
  sections?: string[];
  /** Bracketed gaps the agent deliberately left for a human to fill in. */
  placeholders?: string[];
  /** What in the meeting made this a proposal. The agent's reasoning, shown as-is. */
  signals?: string[];
  /** Set by this app once someone saves an edit from the editor. */
  edited?: boolean;
  editedAt?: string;
  editedBy?: string;
};

/**
 * The agent's own account of its last run, written every run including the quiet
 * ones. On a schedule this is the only evidence the agent is alive: with no
 * proposals on screen, "checked 8 minutes ago, nothing new" and "hasn't run
 * since Tuesday" look identical without it.
 */
export type ScoutState = {
  lastRunAt?: string;
  outcome?: "bootstrap" | "idle" | "drafted" | "error";
  /** When the agent started watching. Everything before it was marked handled. */
  bootstrappedAt?: string;
  scanned?: number;
  candidates?: number;
  drafted?: { id: string; title: string }[];
  skipped?: { title: string; reason: string }[];
  notReady?: string[];
  /** Meetings that qualified but weren't drafted this run — one per run. */
  pending?: number;
  error?: string | null;
};

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDay(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "just now";
  if (diffMs < hour) return Math.round(diffMs / minute) + "m ago";
  if (diffMs < day) return Math.round(diffMs / hour) + "h ago";
  return Math.round(diffMs / day) + "d ago";
}

/**
 * The agent runs every 30 minutes, so anything much older than that means the
 * schedule is not firing — worth surfacing rather than showing a stale
 * "checked 4d ago" as though it were normal.
 */
export const STALE_AFTER_MS = 90 * 60 * 1000;

export function isStale(state: ScoutState | null): boolean {
  if (!state?.lastRunAt) return false;
  const then = new Date(state.lastRunAt).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then > STALE_AFTER_MS;
}

export function cleanError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
