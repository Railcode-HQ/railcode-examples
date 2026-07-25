// Granola integration: personal-connector calls, response parsing, and
// deterministic email-based contact matching.

import { personalConnections } from "@/lib/railcode";

export const GRANOLA_TOOLKIT = "granola";
export const GRANOLA_LOGO_NAME = "Granola";

export const GRANOLA_MAX_IMPORT_PER_SYNC = 20;

/**
 * What `list_meetings` gives us — enough to match a meeting to a company
 * without paying for the notes body. Only meetings the user actually assigns
 * get fetched in full.
 */
export type GranolaMeetingStub = {
  id: string;
  title: string;
  date: string; // best-effort ISO 8601
  /** Empty when the listing doesn't carry participants — then title is the only signal. */
  attendees: string;
};

export type GranolaMeetingDetail = GranolaMeetingStub & {
  notesMarkdown: string;
  /** Set when the notes body couldn't be fetched — the note still saves, just empty. */
  loadError?: boolean;
};

export type GranolaContactRef = { id: string; email?: string };

// The Granola MCP tools don't return JSON — they return a single text blob
// with a lightweight, not-quite-XML markup (attribute values are unescaped,
// so it can't be parsed with a real XML parser). We regex-parse it instead.
const MEETING_RE =
  /<meeting\s+id="([^"]*)"\s+title="([^"]*)"\s+date="([^"]*)">([\s\S]*?)<\/meeting>/g;
const PARTICIPANTS_RE = /<known_participants>([\s\S]*?)<\/known_participants>/;
const SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseGranolaDate(raw: string): string {
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  // Fallback: drop the time/timezone tail and parse just the date part.
  const m = raw.match(/([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/);
  if (m) {
    const fallback = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
    if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();
  }
  return new Date().toISOString();
}

function collectText(result: unknown): string {
  // The toolkit has changed this envelope shape on us once already (a bare
  // array of {type, text} vs. the older {data: [{type, text}]} wrapper) —
  // accept either rather than assuming one.
  const items = Array.isArray(result)
    ? result
    : (result as { data?: unknown[] } | undefined)?.data;
  if (!Array.isArray(items)) return "";
  return (items as { text?: string }[]).map((d) => d?.text ?? "").join("\n");
}

function extractText(result: unknown): string {
  const text = collectText(result);
  // The call can "succeed" transport-wise while carrying a tool-level error
  // (bad args, upstream failure) as plain text instead of `<meetings_data>`.
  // Surface that instead of silently treating it as zero meetings.
  if (text && !text.includes("<meetings_data")) {
    throw new Error(text.trim().slice(0, 300));
  }
  return text;
}

function parseAttendees(body: string): string {
  const participants = body.match(PARTICIPANTS_RE)?.[1];
  return participants ? decodeEntities(participants).replace(/\s+/g, " ").trim() : "";
}

function parseStubs(text: string): GranolaMeetingStub[] {
  const out: GranolaMeetingStub[] = [];
  for (const m of text.matchAll(MEETING_RE)) {
    out.push({
      id: m[1],
      title: decodeEntities(m[2]).trim() || "Untitled meeting",
      date: parseGranolaDate(m[3]),
      // `list_meetings` may or may not include participants per meeting; take
      // them when they're there, since they're the strongest matching signal.
      attendees: parseAttendees(m[4]),
    });
  }
  return out;
}

function parseDetail(text: string): GranolaMeetingDetail | undefined {
  const [stub] = parseStubs(text);
  if (!stub) return undefined;
  const summary = text.match(SUMMARY_RE)?.[1];
  return {
    ...stub,
    notesMarkdown: summary ? decodeEntities(summary).trim() : "",
  };
}

export async function isGranolaConnected(): Promise<boolean> {
  const connections = await personalConnections.list();
  return connections.some((c) => c.toolkit === GRANOLA_TOOLKIT && c.status === "active");
}

/** Opens the provider's OAuth URL; caller is responsible for popup handling. */
export async function connectGranola(): Promise<string> {
  const { redirect_url } = await personalConnections.connect(GRANOLA_TOOLKIT);
  return redirect_url;
}

export async function listRecentMeetings(): Promise<GranolaMeetingStub[]> {
  // The toolkit's declared schema advertises a "custom" time_range, but the live
  // tool only accepts these three fixed windows — "custom" 400s at call time.
  const { result } = await personalConnections.call(GRANOLA_TOOLKIT, "list_meetings", {
    time_range: "last_30_days",
  });
  return parseStubs(extractText(result)).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function fetchMeetingDetail(meetingId: string): Promise<GranolaMeetingDetail> {
  const { result } = await personalConnections.call(GRANOLA_TOOLKIT, "get_meetings", {
    meeting_ids: [meetingId],
  });
  const detail = parseDetail(extractText(result));
  if (!detail) throw new Error("Granola didn't return any data for this meeting.");
  return detail;
}

/**
 * Transcripts come from their own tool and are gated behind Granola's paid
 * tiers, so a failure here is expected rather than exceptional — it's reported
 * as a result, never thrown, and never blocks the note itself from importing.
 */
export type GranolaTranscriptResult =
  /** Meeting has a transcript and we got it. */
  | { status: "ok"; text: string }
  /** The account's Granola plan doesn't include transcripts at all. */
  | { status: "tierLocked" }
  /** Paid account, but this particular meeting has no transcript body. */
  | { status: "empty" }
  /** Transient failure — worth retrying on a later sync. */
  | { status: "failed"; message: string };

// Granola answers a transcript request on a free plan with
// `{"detail":"Transcripts are only available to paid Granola tiers"}`.
const TIER_LOCKED_RE = /paid granola tier/i;

const TRANSCRIPT_RE = /<transcript[^>]*>([\s\S]*?)<\/transcript>/;
const MEETING_BODY_RE = /<meeting\b[^>]*>([\s\S]*?)<\/meeting>/;

/**
 * The transcript tool's envelope isn't documented and we can't see a real one
 * without a paid account, so unwrap the shapes we know and fall back to the
 * raw text rather than returning nothing for an unexpected wrapper.
 */
function parseTranscript(text: string): string {
  const inner =
    text.match(TRANSCRIPT_RE)?.[1] ?? text.match(MEETING_BODY_RE)?.[1] ?? text;
  return decodeEntities(inner)
    .replace(/<\/?meetings_data[^>]*>/g, "")
    .trim();
}

/** Never throws: transcript availability is a plan feature, not an error path. */
export async function fetchMeetingTranscript(
  meetingId: string,
): Promise<GranolaTranscriptResult> {
  let raw: string;
  try {
    const { result } = await personalConnections.call(
      GRANOLA_TOOLKIT,
      "get_meeting_transcript",
      { meeting_id: meetingId },
    );
    raw = collectText(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The tier wall arrives as a rejection; everything else is transient.
    return TIER_LOCKED_RE.test(message)
      ? { status: "tierLocked" }
      : { status: "failed", message: message.slice(0, 300) };
  }

  // Some tool errors come back as a successful call carrying error text.
  if (TIER_LOCKED_RE.test(raw)) return { status: "tierLocked" };

  const text = parseTranscript(raw);
  return text ? { status: "ok", text } : { status: "empty" };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every stub that goes in comes back out — nothing is ever silently dropped
 * from the import. Retries transient failures (e.g. rate limits); if it still
 * can't load, falls back to the metadata we already have, so the user's
 * assignment is still honoured and the note saves without its body.
 */
export async function fetchMeetingDetailResilient(
  stub: GranolaMeetingStub,
  attempts = 3,
): Promise<GranolaMeetingDetail> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetchMeetingDetail(stub.id);
    } catch {
      if (attempt === attempts) break;
      await sleep(1500 * attempt);
    }
  }
  return { ...stub, notesMarkdown: "", loadError: true };
}

// Attendee strings from `list_meetings` carry raw email addresses; this pulls
// them out so we can match a meeting to CRM contacts without any LLM call.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Every email address in a free-text attendee string, lowercased and deduped. */
export function extractEmails(text: string): string[] {
  return Array.from(new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase())));
}

export type GranolaAttendee = { name: string; email: string };

/**
 * Name/email pairs from an attendee string, e.g.
 * `Philip Okugbe from Docmost <philip@docmost.com>, Yakko (note creator) <y@x.com>`.
 *
 * Worth parsing rather than just collecting emails: a contact created without an
 * email is invisible to `matchContactsByEmail`, so every later meeting with that
 * person silently fails to auto-import. This is how the address gets attached.
 */
export function extractAttendees(text: string): GranolaAttendee[] {
  const out: GranolaAttendee[] = [];
  for (const match of text.matchAll(/([^,;<]+?)\s*<([^>\s]+@[^>\s]+)>/g)) {
    const name = match[1]
      // Granola appends role notes like "(note creator)" and " from <Company>".
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s+from\s+.*$/i, "")
      .trim();
    const email = match[2].toLowerCase();
    if (email) out.push({ name, email });
  }
  return out;
}

/** Loose name match: exact, or same first and last token. */
export function attendeeFor(
  name: string,
  attendees: GranolaAttendee[],
): GranolaAttendee | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  const exact = attendees.find((a) => a.name.toLowerCase() === needle);
  if (exact) return exact;

  const parts = needle.split(/\s+/);
  const first = parts[0];
  const last = parts[parts.length - 1];
  return attendees.find((a) => {
    const other = a.name.toLowerCase().split(/\s+/);
    if (!other.length) return false;
    return other[0] === first && other[other.length - 1] === last;
  });
}

/**
 * Deterministic, non-agentic matching: a meeting belongs to every CRM contact
 * whose email appears among the meeting's attendees. Returns matching contact
 * ids (empty when nobody matches — those meetings are left for manual import).
 */
export function matchContactsByEmail(
  attendees: string,
  contacts: GranolaContactRef[],
): string[] {
  const emails = new Set(extractEmails(attendees));
  if (!emails.size) return [];
  return contacts
    .filter((c) => c.email && emails.has(c.email.toLowerCase()))
    .map((c) => c.id);
}
