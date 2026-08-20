// Meetings, independent of where they came from.
//
// Two connectors can put a meeting in front of the triage list: Granola, which
// carries a written summary of what was said, and Google Calendar, which carries
// the invite and nothing else. They answer different questions — Granola knows
// about the calls you took notes on, the calendar knows about every call you
// took — and between them they cover the first conversation with a new prospect,
// which is exactly the one worth turning into a deal.
//
// Everything downstream of the fetch works off the shapes below, so a third
// source would be a listing function and one more case in `fetchMeetingDetail`.

import { cleanError } from "@/lib/crm";
import { fetchEventDetail, isGcalConnected, listRecentEvents } from "@/lib/gcal";
import {
  fetchGranolaDetail,
  isGranolaConnected,
  listGranolaMeetings,
} from "@/lib/granola";

export type MeetingSource = "granola" | "google_calendar";

export const MEETING_SOURCES: MeetingSource[] = ["granola", "google_calendar"];

export const SOURCE_LABEL: Record<MeetingSource, string> = {
  granola: "Granola",
  google_calendar: "Google Calendar",
};

/** Short form for badges and chips, where the full name doesn't fit a row. */
export const SOURCE_SHORT: Record<MeetingSource, string> = {
  granola: "Granola",
  google_calendar: "Calendar",
};

export type MeetingStub = {
  source: MeetingSource;
  /**
   * The PROVIDER's own id, not a namespaced one. Granola issues uuids and Google
   * issues base32 event ids, so a collision across the two isn't a practical
   * concern — which is what lets triage records and call notes stay keyed by
   * this alone, including the ones written before there was a second source.
   */
  id: string;
  title: string;
  /** ISO 8601, best effort — Granola's dates arrive as display strings. */
  date: string;
  /** Free text in `Name <email>` form. Empty when the listing carries nobody. */
  attendees: string;
};

export type MeetingDetail = MeetingStub & {
  /**
   * Granola: the meeting summary. Calendar: the invite body, which is routinely
   * empty — an invite is a plan, not a record of what was said.
   */
  notesMarkdown: string;
  /** Set when the body couldn't be fetched; the note still saves, just empty. */
  loadError?: boolean;
};

/**
 * A meeting-sourced note's key is derived from the meeting rather than random,
 * so `put` is an upsert and re-importing the same meeting can never fan out into
 * duplicate notes.
 *
 * Granola keeps its original `cn_g_` prefix on purpose: those keys are live in
 * shared KV, and a tidier scheme would strand every note already imported.
 */
export function meetingNoteId(source: MeetingSource, meetingId: string): string {
  return source === "granola" ? `cn_g_${meetingId}` : `cn_gc_${meetingId}`;
}

// --- merging sources -------------------------------------------------------

/**
 * How far two starts can drift and still be read as the same meeting. Generous
 * because Granola's date is parsed from a display string and can land on the
 * day rather than the minute; still far short of the week between two instances
 * of the same recurring invite, which must stay separate rows.
 */
const SAME_MEETING_MS = 24 * 60 * 60 * 1000;

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function sameMeeting(a: MeetingStub, b: MeetingStub): boolean {
  if (normalizeTitle(a.title) !== normalizeTitle(b.title)) return false;
  const at = new Date(a.date).getTime();
  const bt = new Date(b.date).getTime();
  if (Number.isNaN(at) || Number.isNaN(bt)) return false;
  return Math.abs(at - bt) < SAME_MEETING_MS;
}

/**
 * One conversation, one row.
 *
 * A Granola note and the calendar invite it was taken in are the same meeting,
 * so with both connectors wired up the list would otherwise offer to create the
 * deal twice — and someone would eventually accept both. Granola wins the tie:
 * its summary is what the extraction actually reads.
 */
export function mergeMeetings(
  granola: MeetingStub[],
  calendar: MeetingStub[],
): MeetingStub[] {
  return [...granola, ...calendar.filter((c) => !granola.some((g) => sameMeeting(g, c)))].sort(
    (a, b) => (a.date < b.date ? 1 : -1),
  );
}

// --- listing ---------------------------------------------------------------

export type MeetingSourceState = {
  connected: boolean;
  /** Set when a connected source failed to list; its meetings are missing. */
  error?: string;
};

export type MeetingListing = {
  meetings: MeetingStub[];
  sources: Record<MeetingSource, MeetingSourceState>;
};

type Settled = { items: MeetingStub[]; error?: string };

const NOTHING: Settled = { items: [] };

async function settle(run: () => Promise<MeetingStub[]>): Promise<Settled> {
  try {
    return { items: await run() };
  } catch (error) {
    return { items: [], error: cleanError(error) };
  }
}

/**
 * Recent meetings from every connected source, merged into one list.
 *
 * Sources are listed independently and a failure in one is reported rather than
 * thrown: with two connectors up, a Granola outage must not empty a list the
 * calendar could still fill.
 */
export async function listRecentMeetings(sinceDays: number): Promise<MeetingListing> {
  const [granolaOn, calendarOn] = await Promise.all([
    isGranolaConnected().catch(() => false),
    isGcalConnected().catch(() => false),
  ]);

  const [granola, calendar] = await Promise.all([
    granolaOn ? settle(listGranolaMeetings) : NOTHING,
    calendarOn ? settle(() => listRecentEvents(sinceDays)) : NOTHING,
  ]);

  return {
    meetings: mergeMeetings(granola.items, calendar.items),
    sources: {
      granola: { connected: granolaOn, error: granola.error },
      google_calendar: { connected: calendarOn, error: calendar.error },
    },
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The full detail behind a stub, whichever source it came from.
 *
 * Every stub that goes in comes back out — nothing is ever silently dropped from
 * an import. Transient failures are retried; if it still can't load, this falls
 * back to the metadata already in hand, so the user's assignment is honoured and
 * the note saves without its body.
 */
export async function fetchMeetingDetail(
  stub: MeetingStub,
  attempts = 3,
): Promise<MeetingDetail> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return stub.source === "granola"
        ? await fetchGranolaDetail(stub.id)
        : await fetchEventDetail(stub);
    } catch {
      if (attempt === attempts) break;
      await sleep(1500 * attempt);
    }
  }
  return { ...stub, notesMarkdown: "", loadError: true };
}
