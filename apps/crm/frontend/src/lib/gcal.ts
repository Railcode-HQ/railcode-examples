// Google Calendar integration: personal-connector calls and event parsing.
//
// Granola knows what was SAID; the calendar knows what was SCHEDULED. The second
// is the weaker signal and a much wider net — every standup and every dentist
// appointment is on there too — but it's the only source that has your first
// call with a new prospect on it before anyone has written a word about them.
// See `lib/meetings.ts` for how the two are merged.

import { connectToolkit, isToolkitConnected } from "@/lib/connect";
import type { MeetingDetail, MeetingStub } from "@/lib/meetings";
import { personalConnections } from "@/lib/railcode";

export const GCAL_TOOLKIT = "google_calendar";

/** The viewer's own default calendar. Shared and secondary ones are out of scope. */
const CALENDAR_ID = "primary";

/** Cap on one listing. The triage window is a week, so this is generous. */
const MAX_EVENTS = 100;

// --- Google Calendar event shapes (only the fields this reads) --------------

type GEventTime = { dateTime?: string; date?: string };

type GAttendee = {
  email?: string;
  displayName?: string;
  self?: boolean;
  /** Rooms and equipment are attendees too, as far as the API is concerned. */
  resource?: boolean;
  responseStatus?: string;
};

type GEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GEventTime;
  end?: GEventTime;
  eventType?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: GAttendee[];
};

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * `personalConnections.call()` answers with MCP-style content: an array of
 * blocks like `[{ type: "text", text: "<stringified JSON>" }]`. Unwrap to the
 * payload, staying tolerant of an envelope that's already an object — the
 * toolkit layer has changed this shape before.
 */
function unwrap(result: unknown): unknown {
  if (typeof result === "string") return parseMaybeJson(result) ?? result;

  if (Array.isArray(result)) {
    const text = result
      .map((block) =>
        block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
          ? (block as { text: string }).text
          : "",
      )
      .join("");
    if (!text) return result;
    const parsed = parseMaybeJson(text);
    // A call can succeed transport-wise while carrying a tool-level error (bad
    // args, expired grant) as plain text where JSON was promised. Surface it
    // instead of reporting an empty calendar.
    if (parsed === null) throw new Error(text.trim().slice(0, 300));
    return parsed;
  }

  const data = (result as { data?: unknown } | null | undefined)?.data;
  return data === undefined ? result : unwrap(data);
}

function eventsFrom(result: unknown): GEvent[] {
  const payload = unwrap(result);
  if (Array.isArray(payload)) return payload as GEvent[];
  const items = (payload as { items?: unknown } | null | undefined)?.items;
  return Array.isArray(items) ? (items as GEvent[]) : [];
}

function eventFrom(result: unknown): GEvent | undefined {
  const payload = unwrap(result);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const one = payload as GEvent;
    if (one.id || one.summary || one.start) return one;
  }
  return eventsFrom(result)[0];
}

/** Attendees who are people: no rooms, no projectors, no entries without a mailbox. */
function people(event: GEvent): GAttendee[] {
  return (event.attendees ?? []).filter((a) => a.email && !a.resource);
}

/**
 * The attendee list rendered in Granola's `Name <email>` form.
 *
 * Deliberate rather than lazy: `extractAttendees`, `extractEmails` and
 * `matchContactsByEmail` already read that format, and every consumer
 * downstream — contact matching, the deal proposal, the saved call note — goes
 * through them. Meeting a shape that already exists beats a second parallel
 * path doing the same work.
 */
function attendeeLine(event: GEvent): string {
  // A one-on-one invite the viewer sent may list nobody; the organizer is then
  // the only person the event knows about.
  const list = people(event);
  const source = list.length ? list : event.organizer?.email ? [event.organizer] : [];
  return source
    .map((a) => {
      const name = a.displayName?.trim();
      return name ? `${name} <${a.email}>` : (a.email ?? "");
    })
    .filter(Boolean)
    .join(", ");
}

const TAG_RE = /<[^>]+>/g;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Ampersand last, so an already-escaped entity isn't decoded twice.
    .replace(/&amp;/g, "&");
}

/** Invite descriptions come out of Google's composer as HTML; flatten to text. */
function plainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n")
      .replace(TAG_RE, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * What the calendar has in place of a write-up: the invite body, plus the
 * location when there is one.
 *
 * Often this is empty, or a bare video link. That's expected and not a failure —
 * the extraction is told it's reading an invite rather than a summary, so it
 * judges from the title and who was on it instead of inventing a discussion.
 */
function inviteBody(event: GEvent): string {
  const location = event.location?.trim();
  return [
    location ? `Location: ${location}` : "",
    event.description ? plainText(event.description) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The calendar is a diary, not a meeting log, and most of what's on it was never
 * a conversation. Four rules drop the bulk of that before anyone sees a row:
 *
 * - cancelled events, which happened to nobody;
 * - all-day entries, which are holidays, travel and OOO, never calls;
 * - invitations the viewer declined;
 * - solo blocks — focus time, reminders, "gym" — with no second person on them.
 *
 * What survives is still only a candidate. Whether it's a client call is the
 * extraction's judgement, and the person confirming the proposal has the last word.
 */
function isTriageable(event: GEvent): boolean {
  if (!event.id || event.status === "cancelled") return false;
  if (!event.start?.dateTime) return false;
  // "outOfOffice", "focusTime", "workingLocation", "birthday" — never meetings.
  if (event.eventType && event.eventType !== "default") return false;

  const attendees = people(event);
  if (attendees.length < 2) return false;
  if (attendees.find((a) => a.self)?.responseStatus === "declined") return false;
  return true;
}

function toStub(event: GEvent): MeetingStub | undefined {
  const start = event.start?.dateTime;
  if (!event.id || !start) return undefined;
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    source: "google_calendar",
    id: event.id,
    title: event.summary?.trim() || "Untitled event",
    date: date.toISOString(),
    attendees: attendeeLine(event),
  };
}

export function isGcalConnected(): Promise<boolean> {
  return isToolkitConnected(GCAL_TOOLKIT);
}

/** Opens the provider's OAuth URL; caller is responsible for popup handling. */
export function connectGcal(): Promise<string> {
  return connectToolkit(GCAL_TOOLKIT);
}

/**
 * Meetings from the last `sinceDays` days that have already finished, newest first.
 *
 * `timeMax` is now, and that's the point: everything triage exists for happens
 * after a meeting. A call still to come has nothing to extract, and offering to
 * create a deal from one that hasn't happened yet is how a pipeline fills with
 * conversations nobody has had.
 */
export async function listRecentEvents(sinceDays: number): Promise<MeetingStub[]> {
  const now = new Date();
  const timeMin = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000);

  const { result } = await personalConnections.call(GCAL_TOOLKIT, "list_events", {
    calendarId: CALENDAR_ID,
    timeMin: timeMin.toISOString(),
    timeMax: now.toISOString(),
    // Without this a weekly invite comes back as one recurring row rather than
    // the instances that actually happened — and `orderBy: startTime` 400s.
    singleEvents: true,
    orderBy: "startTime",
    maxResults: MAX_EVENTS,
  });

  return eventsFrom(result)
    .filter(isTriageable)
    .map(toStub)
    .filter((stub): stub is MeetingStub => stub !== undefined)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * One event in full. The listing already carries most of it — this is worth the
 * round trip for the description, which `list_events` truncates or omits and
 * which is the only prose the calendar ever has.
 */
export async function fetchEventDetail(stub: MeetingStub): Promise<MeetingDetail> {
  const { result } = await personalConnections.call(GCAL_TOOLKIT, "get_event", {
    calendarId: CALENDAR_ID,
    eventId: stub.id,
  });
  const event = eventFrom(result);
  if (!event) throw new Error("Google Calendar didn't return any data for this event.");

  return {
    ...stub,
    title: event.summary?.trim() || stub.title,
    attendees: attendeeLine(event) || stub.attendees,
    notesMarkdown: inviteBody(event),
  };
}
