import { PRIORITY_META, type Priority } from "../types";
import { tagTone } from "../lib/cards";

export function PriorityBadge({ priority }: { priority: Priority }) {
  const meta = PRIORITY_META[priority];
  return <span className={`pri t-${meta.tone}`}>{meta.label}</span>;
}

export function TagChip({
  tag,
  onClick,
  active,
  removable,
  onRemove,
}: {
  tag: string;
  onClick?: () => void;
  active?: boolean;
  removable?: boolean;
  onRemove?: () => void;
}) {
  const tone = tagTone(tag);
  return (
    <span
      className={`chip t-${tone}${active ? " active" : ""}${onClick ? " click" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      {tag}
      {removable && (
        <button
          type="button"
          className="chip-x"
          aria-label={`Remove ${tag}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function fullDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}
