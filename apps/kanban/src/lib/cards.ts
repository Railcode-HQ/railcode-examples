import type { Card, DoneFilter, Priority, SortKey, Status } from "../types";

// ----- Tag colors (deterministic per tag name) ------------------------------

const TAG_TONES = ["accent", "green", "amber", "violet", "red", "dim"] as const;

export function tagTone(tag: string): (typeof TAG_TONES)[number] {
  let sum = 0;
  for (let i = 0; i < tag.length; i++) sum = (sum + tag.charCodeAt(i)) % 997;
  return TAG_TONES[sum % TAG_TONES.length];
}

// ----- Done-date range ------------------------------------------------------

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Resolve the active done-filter into an inclusive [from, to) millisecond range,
// or null when no filtering applies. Anchored on `now` so callers stay pure-ish.
export function doneRange(
  filter: DoneFilter,
  now: Date,
): { from: number; to: number } | null {
  const today = startOfDay(now);
  const dayMs = 24 * 60 * 60 * 1000;

  switch (filter.preset) {
    case "all":
      return null;
    case "today":
      return { from: today.getTime(), to: today.getTime() + dayMs };
    case "7d":
      return { from: today.getTime() - 6 * dayMs, to: now.getTime() + 1 };
    case "30d":
      return { from: today.getTime() - 29 * dayMs, to: now.getTime() + 1 };
    case "month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return { from: first, to: now.getTime() + 1 };
    }
    case "custom": {
      const from = filter.from ? new Date(filter.from + "T00:00:00").getTime() : -Infinity;
      const to = filter.to ? new Date(filter.to + "T00:00:00").getTime() + dayMs : Infinity;
      if (from === -Infinity && to === Infinity) return null;
      return { from, to };
    }
  }
}

// ----- Filtering ------------------------------------------------------------

export interface Filters {
  search: string;
  tags: string[]; // OR — a card matches if it has any selected tag
  priorities: Priority[]; // OR — a card matches if its priority is selected
  assignees: string[]; // OR — a card matches if it's assigned to any selected person
  done: DoneFilter;
  now: Date;
}

function matchesSearch(card: Card, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = (
    card.title +
    " " +
    card.description +
    " " +
    card.tags.join(" ")
  ).toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function passesFilters(card: Card, f: Filters): boolean {
  const terms = f.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!matchesSearch(card, terms)) return false;

  if (f.tags.length > 0 && !f.tags.some((t) => card.tags.includes(t))) {
    return false;
  }

  if (f.priorities.length > 0 && !f.priorities.includes(card.priority)) {
    return false;
  }

  if (
    f.assignees.length > 0 &&
    !(card.assignee && f.assignees.includes(card.assignee))
  ) {
    return false;
  }

  // The done-date filter only constrains the Done column.
  if (card.status === "done") {
    const range = doneRange(f.done, f.now);
    if (range) {
      const ts = card.done_at ? new Date(card.done_at).getTime() : NaN;
      if (Number.isNaN(ts) || ts < range.from || ts >= range.to) return false;
    }
  }

  return true;
}

// ----- Sorting --------------------------------------------------------------

function ts(iso: string | null): number {
  return iso ? new Date(iso).getTime() : 0;
}

export function sortCards(cards: Card[], sort: SortKey): Card[] {
  const out = [...cards];
  out.sort((a, b) => {
    switch (sort) {
      case "manual":
        return a.order - b.order || ts(b.created_at) - ts(a.created_at);
      case "priority":
        return a.priority - b.priority || ts(b.created_at) - ts(a.created_at);
      case "created_desc":
        return ts(b.created_at) - ts(a.created_at);
      case "created_asc":
        return ts(a.created_at) - ts(b.created_at);
      case "done_desc": {
        // Done cards by completion time; other columns fall back to newest.
        const av = a.done_at ? ts(a.done_at) : ts(a.created_at);
        const bv = b.done_at ? ts(b.done_at) : ts(b.created_at);
        return bv - av;
      }
    }
  });
  return out;
}

// ----- Column composition ---------------------------------------------------

export interface Column {
  status: Status;
  cards: Card[];
}

export function buildColumns(
  all: Card[],
  filters: Filters,
  sorts: Record<Status, SortKey>,
): Record<Status, Card[]> {
  const byStatus: Record<Status, Card[]> = {
    future: [],
    todo: [],
    in_progress: [],
    done: [],
  };
  for (const c of all) {
    if (passesFilters(c, filters)) byStatus[c.status].push(c);
  }
  (Object.keys(byStatus) as Status[]).forEach((s) => {
    byStatus[s] = sortCards(byStatus[s], sorts[s]);
  });
  return byStatus;
}

// ----- Search ranking for the command palette -------------------------------

export function searchCards(all: Card[], query: string, limit = 6): Card[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored: { card: Card; score: number }[] = [];
  for (const card of all) {
    const title = card.title.toLowerCase();
    const desc = card.description.toLowerCase();
    const tags = card.tags.join(" ").toLowerCase();

    let score = 0;
    let ok = true;
    for (const t of terms) {
      if (title.startsWith(t)) score += 5;
      else if (title.includes(t)) score += 3;
      else if (tags.includes(t)) score += 2;
      else if (desc.includes(t)) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (ok) {
      // Recency nudge so ties favor newer cards.
      score += Math.min(2, ts(card.created_at) / 1e13);
      scored.push({ card, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.card);
}
