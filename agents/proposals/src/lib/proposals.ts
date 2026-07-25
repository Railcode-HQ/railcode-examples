export type MaterialFile = {
  name: string; // display name (prefix stripped)
  fileName: string; // full storage name, e.g. "materials/rate-card.pdf"
  contentType: string;
  size: number;
  updatedAt: string;
};

export type ProposalRecord = {
  id: string;
  fileName: string; // "proposals/proposal-acme-20260718-153000.docx"
  title: string;
  client: string;
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  createdAt: string;
  source: "manual" | "cron";
  context: string;
  summary: string;
  materialsUsed?: string[];
  /** Bracketed gaps the agent deliberately left for a human to fill in. */
  placeholders?: string[];
  /** Set by this app once someone saves an edit from the SuperDoc editor. */
  edited?: boolean;
  editedAt?: string;
  editedBy?: string;
};

export type MeetingRecord = {
  id: string;
  title: string;
  /** ISO 8601, or "" when the source date could not be parsed. */
  date: string;
  /** Granola's own date string, shown when `date` is unparseable. */
  dateLabel?: string;
  attendees?: string[];
  /** Someone outside your email domain attended — i.e. a client conversation. */
  external?: boolean;
  indexedAt: string;
  drafted: boolean;
  proposalId?: string | null;
};

/** The only window Granola's list_meetings accepts — it takes no other filter. */
export type TimeRange = "this_week" | "last_week" | "last_30_days";

export const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "last_30_days", label: "Last 30 days" },
];

export type Settings = {
  autoDraft: boolean;
  timeRange: TimeRange;
  companyName?: string;
};

/**
 * Only the dismissal is stored. Which steps are done is derived from live data
 * (are there meetings / materials / proposals?), so the checklist can never
 * disagree with reality — deleting every material re-opens that step.
 */
export type Onboarding = {
  dismissed?: boolean;
  dismissedAt?: string;
};

export type CronState = {
  lastRunAt?: string;
  lastIndexedAt?: string;
  drafted?: string[];
  skipped?: string[];
};

export const DEFAULT_SETTINGS: Settings = {
  // Off until someone turns it on in Settings: the scheduled run keeps the
  // meeting list fresh, but writing client-facing documents unattended is an
  // opt-in, not a default.
  autoDraft: false,
  timeRange: "this_week",
};

// Materials and agent-generated proposals share the app's one file store, so
// each side gets a prefix to stay distinguishable.
export const MATERIALS_PREFIX = "materials/";
export const PROPOSALS_PREFIX = "proposals/";

// A sane client-side guard so one huge upload doesn't stall the browser —
// not a platform-imposed limit.
export const MAX_MATERIAL_BYTES = 25 * 1024 * 1024;

export function materialStorageName(fileName: string): string {
  return MATERIALS_PREFIX + fileName.replace(/^\/+/, "");
}

export function materialDisplayName(storageName: string): string {
  return storageName.startsWith(MATERIALS_PREFIX)
    ? storageName.slice(MATERIALS_PREFIX.length)
    : storageName;
}

export function formatBytes(value: number | undefined): string {
  if (!value) return "0 B";
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  return (value / (1024 * 1024)).toFixed(1) + " MB";
}

export function formatDateTime(iso: string): string {
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

export function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function relativeTime(iso: string): string {
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

export function cleanError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
