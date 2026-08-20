// Types and shared vocabulary for the "Ask AI" agent surface.
//
// The agent runs inside `llm.stream({ tools })` — the SDK plans, validates each
// call's args against the tool schema, executes `run` here in the page with the
// app's own SDK authority, feeds `summarize(result)` back, and repeats until the
// model answers. Everything below describes that run to the UI.

import { EntityType, Priority, StageId, Tone } from "@/lib/crm";

export type AskRole = "user" | "assistant";

/** Reads run the moment the model asks. Writes stop and wait for the person.
 *  Display tools only paint the transcript, so they run freely too. */
export type ToolKind = "read" | "write" | "display";

export type RecordLink = {
  type: EntityType;
  id: string;
  label: string;
};

// --- rendered output -------------------------------------------------------

export type TableFormat =
  | "text"
  | "money"
  | "number"
  | "date"
  | "stage"
  | "priority";

export type VizTable = {
  kind: "table";
  title?: string;
  note?: string;
  columns: { label: string; format?: TableFormat }[];
  rows: { cells: string[]; link?: RecordLink }[];
};

export type VizChart = {
  kind: "chart";
  title?: string;
  note?: string;
  format?: "money" | "number";
  series: { label: string; value: number; tone?: Tone }[];
};

export type VizStats = {
  kind: "stats";
  title?: string;
  note?: string;
  stats: { label: string; value: string; hint?: string; tone?: Tone }[];
};

export type Viz = VizTable | VizChart | VizStats;

// --- tool results ----------------------------------------------------------

/** Every tool returns this. The model only ever sees `observation`; the raw
 *  object rides on the SDK's `step.result` and is what the card renders — so a
 *  20-row table costs the model a clipped preview, not 20 rows of tokens. */
export type ToolOutcome = {
  /** What the model reads back. */
  observation: string;
  /** One-line label on the collapsed card. */
  summary: string;
  /** Painted into the transcript by the display tools. */
  viz?: Viz;
  /** Records this call found or touched, as clickable chips. */
  links?: RecordLink[];
  /** Shown in the expanded card body. */
  data?: unknown;
  /** True when the person declined a gated write. */
  rejected?: boolean;
};

// --- transcript ------------------------------------------------------------

export type AskStepStatus = "running" | "awaiting" | "ok" | "error";

export type AskStep = {
  id: string;
  tool: string;
  kind: ToolKind;
  args: Record<string, unknown>;
  status: AskStepStatus;
  ms: number | null;
  error: string | null;
  outcome: ToolOutcome | null;
  /** The approval this call is parked on, once one has been paired to it. */
  approvalId: string | null;
};

/** A write the model wants to make, parked until the person decides.
 *  `decide` resolves the promise the tool's `run` is sitting on. */
export type Approval = {
  id: string;
  tool: string;
  /** "Create deal" / "Update contact" / "Delete company" */
  title: string;
  /** The record the action lands on. */
  subject: string;
  fields: { label: string; value: string }[];
  destructive: boolean;
  status: "pending" | "approved" | "rejected";
  decide: (approved: boolean) => void;
};

export type AskMessage = {
  id: string;
  role: AskRole;
  content: string;
  createdAt: string;
  steps: AskStep[];
  /** A hard failure — the turn produced nothing usable. */
  error: string | null;
  /** A soft caveat: hit the step limit, timed out, was stopped. */
  note: string | null;
};

// --- tool registry ---------------------------------------------------------

/** Display metadata for every tool the agent can call. Drives the card label
 *  and, through `kind`, whether a call is gated behind approval. */
export const TOOL_META: Record<string, { label: string; kind: ToolKind }> = {
  // reads
  search_workspace: { label: "Search workspace", kind: "read" },
  list_deals: { label: "List deals", kind: "read" },
  list_companies: { label: "List companies", kind: "read" },
  list_contacts: { label: "List contacts", kind: "read" },
  list_action_items: { label: "List action items", kind: "read" },
  list_call_notes: { label: "List call notes", kind: "read" },
  read_call_note: { label: "Read call note", kind: "read" },
  list_activity: { label: "Read activity", kind: "read" },
  get_record: { label: "Open record", kind: "read" },
  pipeline_stats: { label: "Pipeline stats", kind: "read" },
  list_deal_files: { label: "List deal files", kind: "read" },
  // writes
  save_company: { label: "Save company", kind: "write" },
  save_contact: { label: "Save contact", kind: "write" },
  save_deal: { label: "Save deal", kind: "write" },
  save_action_item: { label: "Save action item", kind: "write" },
  save_call_note: { label: "Save call note", kind: "write" },
  add_activity_note: { label: "Log note", kind: "write" },
  delete_record: { label: "Delete record", kind: "write" },
  run_automation: { label: "Run automation", kind: "write" },
  // display
  render_table: { label: "Table", kind: "display" },
  render_chart: { label: "Chart", kind: "display" },
  render_stats: { label: "Stats", kind: "display" },
};

export function toolMeta(name: string): { label: string; kind: ToolKind } {
  return TOOL_META[name] ?? { label: name, kind: "read" };
}

// --- coercion --------------------------------------------------------------
//
// Tool args are validated against a JSON Schema before `run`, but a model can
// still hand over a number where a string belongs or a stage that doesn't
// exist. These keep a sloppy call from throwing into app code — the tool either
// works or explains itself back to the model.

export function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    // "$50k" / "1.2M" / "40,000" — the model is told to send plain numbers, but
    // it copies user phrasing often enough to be worth handling.
    const text = value.trim().toLowerCase().replace(/[$,\s]/g, "");
    const match = text.match(/^(-?\d*\.?\d+)([km])?$/);
    if (!match) return undefined;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return undefined;
    if (match[2] === "k") return base * 1_000;
    if (match[2] === "m") return base * 1_000_000;
    return base;
  }
  return undefined;
}

const STAGE_SET = new Set<string>([
  "new",
  "qualified",
  "demo",
  "closing",
  "won",
  "lost",
]);

export function asStage(value: unknown): StageId | undefined {
  const text = asString(value)?.toLowerCase();
  return text && STAGE_SET.has(text) ? (text as StageId) : undefined;
}

export function asPriority(value: unknown): Priority | undefined {
  const text = asString(value)?.toLowerCase();
  if (!text) return undefined;
  const match = text.match(/p?([0-4])/);
  return match ? (`p${match[1]}` as Priority) : undefined;
}

export function asEntityType(value: unknown): EntityType | undefined {
  const text = asString(value)?.toLowerCase();
  if (text === "company" || text === "contact" || text === "deal") return text;
  return undefined;
}

/** "2026-07-24" from anything date-shaped the model sends. */
export function asIsoDate(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
