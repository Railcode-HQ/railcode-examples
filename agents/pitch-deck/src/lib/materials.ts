export type MaterialFile = {
  name: string; // display name (prefix stripped)
  fileName: string; // full storage name, e.g. "materials/one-pager.pdf"
  contentType: string;
  size: number;
  updatedAt: string;
};

export type VersionRecord = {
  id: string;
  fileName: string;
  createdAt: string;
  context: string;
  summary: string;
  materialsUsed?: string[];
};

// Materials and agent-generated decks share the app's one file store, so
// materials live under this prefix to stay distinguishable from deck output.
export const MATERIALS_PREFIX = "materials/";

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
