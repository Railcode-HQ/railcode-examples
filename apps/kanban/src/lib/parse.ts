import type { Priority } from "../types";

export interface ParsedInput {
  title: string;
  priority: Priority | null;
  tags: string[];
}

// Loosely parse a free-typed command-palette string into a new card.
//   "fix login p1 #auth #urgent"  ->  title "fix login", P1, [auth, urgent]
// Priority tokens are `p0`..`p4` (case-insensitive, standalone). Tags are
// `#word`. Everything else, in order, becomes the title.
export function parseLooseInput(raw: string): ParsedInput {
  let priority: Priority | null = null;
  const tags: string[] = [];

  const titleParts: string[] = [];
  for (const token of raw.split(/\s+/)) {
    if (!token) continue;

    const pri = token.match(/^p([0-4])$/i);
    if (pri) {
      priority = Number(pri[1]) as Priority;
      continue;
    }

    if (token.startsWith("#") && token.length > 1) {
      const tag = normalizeTag(token.slice(1));
      if (tag && !tags.includes(tag)) tags.push(tag);
      continue;
    }

    titleParts.push(token);
  }

  return { title: titleParts.join(" ").trim(), priority, tags };
}

export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}
