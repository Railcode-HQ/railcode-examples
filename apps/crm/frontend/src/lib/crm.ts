// Domain model + helpers for the CRM.

export type EntityType = "company" | "contact" | "deal";

export type StageId =
  | "new"
  | "qualified"
  | "demo"
  | "closing"
  | "won"
  | "lost";

export type Tone = "accent" | "green" | "violet" | "amber" | "red" | "dim";

export type Stage = {
  id: StageId;
  label: string;
  tone: Tone;
  /** terminal stages don't count toward open pipeline value */
  terminal?: boolean;
};

export const STAGES: Stage[] = [
  { id: "new", label: "New", tone: "dim" },
  { id: "qualified", label: "Qualified", tone: "accent" },
  { id: "demo", label: "Demo", tone: "violet" },
  { id: "closing", label: "Closing", tone: "amber" },
  { id: "won", label: "Won", tone: "green", terminal: true },
  { id: "lost", label: "Lost", tone: "red", terminal: true },
];

export const STAGE_IDS = STAGES.map((s) => s.id);

export function stage(id: StageId): Stage {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}

export type Company = {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  notes?: string;
  /** Optional company logo, stored as a downscaled data URL. */
  logo?: string;
  createdAt: string;
  updatedAt: string;
};

export type Contact = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  title?: string;
  companyId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type Deal = {
  id: string;
  title: string;
  value?: number;
  stage: StageId;
  companyId?: string;
  contactId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type Activity = {
  id: string;
  entityType: EntityType;
  entityId: string;
  kind: "note" | "event";
  body: string;
  createdAt: string;
  author?: string;
};

export type CallNote = {
  id: string;
  /** People this meeting is attached to; a meeting can belong to several. */
  contactIds: string[];
  meetingId: string;
  title: string;
  date: string;
  attendees: string;
  notesMarkdown: string;
  createdAt: string;
  updatedAt?: string;
  /** "manual" for notes typed in the app; imported ones are "granola". */
  source?: "granola" | "manual";
  importedBy?: string;
  /**
   * Whether a verbatim transcript was imported alongside the notes. The body
   * lives in its own collection (see CallTranscript) so it doesn't weigh down
   * every note list; this flag lets the UI offer it without loading it.
   */
  hasTranscript?: boolean;
  /** @deprecated legacy company-scoped notes imported before per-person matching. */
  companyId?: string;
};

/**
 * A meeting's verbatim transcript, keyed by CallNote.meetingId. Kept out of
 * CallNote because transcripts run to tens of KB and notes are all loaded on
 * boot — this one is fetched only when someone opens it.
 */
export type CallTranscript = {
  meetingId: string;
  text: string;
  importedAt: string;
};

// --- action items ----------------------------------------------------------

export type Priority = "p0" | "p1" | "p2" | "p3" | "p4";

/** An actionable attached to a deal. P0 is most urgent, P4 least. */
export type ActionItem = {
  id: string;
  dealId: string;
  title: string;
  priority: Priority;
  /** "YYYY-MM-DD" (date-only); undefined means no due date. */
  dueDate?: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
};

export const PRIORITIES: { id: Priority; label: string; tone: Tone }[] = [
  { id: "p0", label: "P0", tone: "red" },
  { id: "p1", label: "P1", tone: "amber" },
  { id: "p2", label: "P2", tone: "accent" },
  { id: "p3", label: "P3", tone: "violet" },
  { id: "p4", label: "P4", tone: "dim" },
];

export function priorityMeta(p: Priority): { id: Priority; label: string; tone: Tone } {
  return PRIORITIES.find((x) => x.id === p) ?? PRIORITIES[2];
}

/** Open before done, then by priority (P0 first), then soonest due, then age. */
export function compareActionItems(a: ActionItem, b: ActionItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.priority !== b.priority) return a.priority < b.priority ? -1 : 1;
  const ad = a.dueDate ?? "9999-99-99";
  const bd = b.dueDate ?? "9999-99-99";
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : 1;
}

/**
 * Same as compareActionItems with the two keys swapped: soonest due first,
 * undated items last, priority only breaking ties.
 */
export function compareActionItemsByDue(a: ActionItem, b: ActionItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const ad = a.dueDate ?? "9999-99-99";
  const bd = b.dueDate ?? "9999-99-99";
  if (ad !== bd) return ad < bd ? -1 : 1;
  if (a.priority !== b.priority) return a.priority < b.priority ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : 1;
}

/** Today as "YYYY-MM-DD" in the viewer's local time (matches a date input). */
export function todayIsoDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function formatDueDate(due?: string): string {
  if (!due) return "";
  const d = new Date(`${due}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const showYear = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(showYear ? { year: "numeric" } : {}),
  });
}

export type DueState = "none" | "overdue" | "today" | "upcoming";

/** ISO date strings sort chronologically, so plain string compares suffice. */
export function dueState(due?: string, done?: boolean): DueState {
  if (!due || done) return "none";
  const today = todayIsoDate();
  if (due < today) return "overdue";
  if (due === today) return "today";
  return "upcoming";
}

// ---------------------------------------------------------------------------

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatMoney(value?: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Compact form for column totals: $1.2M, $50k, $900 */
export function formatMoneyCompact(value?: number): string {
  if (!value) return "$0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000)
    return `$${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `$${trim(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function cleanError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong.";
}

/**
 * Gateways fail with an HTML error page, not JSON.
 *
 * Rendering that raw fills the UI with kilobytes of Cloudflare markup, which is how a
 * transient 504 ends up looking like the app itself broke. Returns null when the text
 * is ordinary and should be shown as-is.
 */
export function gatewayErrorMessage(raw: string): string | null {
  const text = raw.trim();
  if (/^<(!doctype|html|\?xml)/i.test(text) || /<\/html>/i.test(text)) {
    const title = text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
    const status = title?.match(/\b(4\d\d|5\d\d)\b/)?.[1];
    if (status === "504" || /time-?out/i.test(title ?? "")) {
      return "The request took too long and the gateway gave up (504). The work may still be running — wait a moment and try again.";
    }
    if (status === "502" || status === "503") {
      return `The platform is temporarily unreachable (${status}). Try again shortly.`;
    }
    return status
      ? `The platform gateway returned an error (${status}). Try again shortly.`
      : "The platform gateway returned an error page instead of a response. Try again shortly.";
  }
  // A wall of unparsed text is no more useful than a sentence of it.
  return text.length > 400 ? `${text.slice(0, 300).trim()}…` : null;
}
