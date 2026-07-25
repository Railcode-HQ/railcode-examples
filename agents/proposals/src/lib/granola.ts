import type { TimeRange } from "@/lib/proposals";

export type GranolaMeeting = {
  id: string;
  title: string;
  /** ISO 8601 when the source date could be parsed; otherwise "". */
  date: string;
  /** The source's own date string, e.g. "Jul 17, 2026 10:00 AM PDT". */
  dateLabel: string;
  attendees: string[];
  domains: string[];
};

/**
 * Granola's list_meetings returns a prose preamble wrapped around a block of
 * XML. The XML is fully structured — id, title, date and participants — so the
 * app parses it directly instead of paying an LLM to retype it.
 */
export function parseMeetingsXml(text: string): GranolaMeeting[] {
  const start = text.indexOf("<meetings_data");
  if (start === -1) return [];
  const xml = text.slice(start);

  // NOT well-formed XML, despite the tags: meeting titles routinely contain raw
  // angle brackets (the "Yakko <> Gurleen" 1:1 convention), unescaped. That
  // breaks DOMParser outright, and breaks any pattern that treats ">" as the
  // end of the open tag — the title swallows it. So delimit each element by the
  // *next* element instead, and pull attributes by their quoted values.
  const out: GranolaMeeting[] = [];
  const chunks = xml.split(/<meeting\s+/).slice(1);
  for (const chunk of chunks) {
    const id = attr(chunk, "id");
    if (!id) continue;
    const body = chunk.slice(chunk.indexOf("<known_participants>") + 1);
    out.push(toMeeting(id, titleOf(chunk), attr(chunk, "date"), body));
  }
  return out;
}

/**
 * A title may contain anything except a double quote — including `<` and `>` —
 * so it is bounded by the ` date="` attribute that follows it rather than by
 * any character class.
 */
function titleOf(chunk: string): string {
  const bounded = /title="([\s\S]*?)"\s+date="/.exec(chunk);
  if (bounded) return decodeEntities(bounded[1]);
  return attr(chunk, "title");
}

function attr(chunk: string, name: string): string {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(chunk);
  return m ? decodeEntities(m[1]) : "";
}

function toMeeting(id: string, title: string, dateLabel: string, participants: string): GranolaMeeting {
  const emails = Array.from(participants.matchAll(/<([^<>@\s]+@[^<>\s]+)>/g)).map((m) => m[1]);
  const attendees = participants
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return {
    id,
    title: title || "Untitled meeting",
    date: toIso(dateLabel),
    dateLabel,
    attendees,
    domains: Array.from(new Set(emails.map((e) => e.split("@")[1]?.toLowerCase()).filter(Boolean))),
  };
}

/**
 * "Jul 17, 2026 10:00 AM PDT" — a trailing timezone abbreviation is not
 * portably parseable, so retry without it rather than storing an invalid date.
 */
function toIso(label: string): string {
  if (!label) return "";
  const direct = new Date(label);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const stripped = new Date(label.replace(/\s+[A-Z]{2,5}$/, ""));
  return Number.isNaN(stripped.getTime()) ? "" : stripped.toISOString();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

type ConnectorEnvelope = {
  result?: Array<{ type?: string; text?: string }>;
};

/** Reads the caller's own Granola account — no agent, no LLM tokens. */
export async function listGranolaMeetings(range: TimeRange): Promise<GranolaMeeting[]> {
  const res = (await personalConnections.call("granola", "list_meetings", {
    time_range: range,
  })) as ConnectorEnvelope;
  const text = res?.result?.find((r) => typeof r.text === "string")?.text ?? "";
  return parseMeetingsXml(text);
}

/**
 * A meeting is a client conversation when someone outside your own email domain
 * was on it. Derived from the participant list, so no model call is needed.
 */
export function isExternal(meeting: GranolaMeeting, ownDomain: string): boolean {
  if (!ownDomain) return meeting.domains.length > 0;
  return meeting.domains.some((d) => d !== ownDomain);
}

export function domainOf(email: string | undefined): string {
  return email?.split("@")[1]?.toLowerCase() ?? "";
}
