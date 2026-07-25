export type Status = "future" | "todo" | "in_progress" | "done";

export type Priority = 0 | 1 | 2 | 3 | 4;

// The app's top-level surfaces (sidebar Views group).
export type View = "board" | "list";

// A file uploaded to a card. `id` doubles as the flat, dot/slash-free name
// under which the blob is stored via the `files` SDK global — the
// user-facing filename lives only in `name`.
export interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  uploaded_at: string; // ISO
}

export interface Card {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  tags: string[];
  assignee: string | null; // uuid of the app user this card is assigned to
  attachments: Attachment[];
  created_at: string; // ISO
  updated_at: string; // ISO
  done_at: string | null; // ISO when moved to done, else null
  order: number; // manual position within its column (fractional index)
}

// An org member a card can be assigned to (from the Railcode `appUsers()` SDK global).
export interface AssigneeOption {
  uuid: string;
  name: string;
  email: string;
}

export const STATUSES: { key: Status; label: string }[] = [
  { key: "future", label: "Future" },
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
];

export const STATUS_LABEL: Record<Status, string> = {
  future: "Future",
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

export const PRIORITIES: Priority[] = [0, 1, 2, 3, 4];

// Descending intensity: P0 is the loudest, P4 the quietest.
export const PRIORITY_META: Record<Priority, { label: string; tone: string }> = {
  0: { label: "P0", tone: "red" },
  1: { label: "P1", tone: "amber" },
  2: { label: "P2", tone: "violet" },
  3: { label: "P3", tone: "dim" },
  4: { label: "P4", tone: "faint" },
};

export type SortKey =
  | "manual"
  | "priority"
  | "created_desc"
  | "created_asc"
  | "done_desc";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "manual", label: "Manual order" },
  { key: "priority", label: "Priority (P0 first)" },
  { key: "created_desc", label: "Newest first" },
  { key: "created_asc", label: "Oldest first" },
  { key: "done_desc", label: "Recently done" },
];

export type DonePreset =
  | "all"
  | "today"
  | "7d"
  | "30d"
  | "month"
  | "custom";

export interface DoneFilter {
  preset: DonePreset;
  from: string; // yyyy-mm-dd (custom)
  to: string; // yyyy-mm-dd (custom)
}

export const DONE_PRESETS: { key: DonePreset; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "today", label: "Done today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom range…" },
];
