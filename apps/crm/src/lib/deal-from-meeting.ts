// Turning a Granola meeting into CRM records.
//
// This is one `llm.generate` call with a JSON output schema rather than a tool loop.
// The shape of the answer is fixed — one company, the people on the call, one deal —
// so a single cheap call extracts it, a person confirms what they see, and the writes
// go through the same `useCrmStore` actions the UI uses. Nothing is saved by the
// model itself, which is what makes "create deal from meeting" safe to put one click
// away from a list.

import {
  GranolaMeetingDetail,
  attendeeFor,
  extractAttendees,
  extractEmails,
} from "@/lib/granola";
import { STAGES, StageId } from "@/lib/crm";
import { llm } from "@/lib/railcode";
import { asNumber, asStage, asString } from "@/lib/ask";
import { useCrmStore } from "@/store/crm-store";

export type ProposedContact = {
  name: string;
  email?: string;
  title?: string;
  /** Set when this person is already in the CRM — then we link, not create. */
  existingId?: string;
};

export type DealProposal = {
  /** Set when the meeting matches a company already in the CRM. */
  companyId?: string;
  companyName: string;
  domain?: string;
  industry?: string;
  contacts: ProposedContact[];
  dealTitle: string;
  value?: number;
  stage: StageId;
  /** One or two sentences, saved as the deal's description. */
  summary: string;
  /** False for internal calls, 1:1s, interviews — the UI warns before creating. */
  isClientMeeting: boolean;
  reasoning: string;
};

// `additionalProperties: false` is required, not stylistic: a JSON output schema is
// delivered to the model as a tool, and Bedrock rejects any object schema that leaves
// it unset ("For 'object' type, 'additionalProperties' must be explicitly set to
// false"). It has to be on every nested object too, not just the root.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    isClientMeeting: {
      type: "boolean",
      description:
        "True only for a conversation with an external party that could become a deal. False for internal standups, 1:1s, all-hands, interviews and personal calls.",
    },
    companyId: {
      type: "string",
      description:
        "The id of an EXISTING company from the roster when this meeting is with them. Empty string when it's a company not in the CRM yet.",
    },
    companyName: { type: "string", description: "The client company's name." },
    domain: { type: "string", description: "Their web domain, if it can be told from an attendee email. Empty if not." },
    industry: { type: "string", description: "Their industry, only if the notes actually say. Empty otherwise." },
    contacts: {
      type: "array",
      description: "The external people on the call. Never include the user's own colleagues.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          title: { type: "string", description: "Only if stated in the notes." },
        },
        required: ["name"],
      },
    },
    dealTitle: {
      type: "string",
      description: "A short, specific deal name, e.g. 'Acme — data platform migration'.",
    },
    value: {
      type: "number",
      description: "Deal value in whole dollars, ONLY if a figure was actually discussed. Omit otherwise.",
    },
    stage: {
      type: "string",
      enum: STAGES.map((s) => s.id),
      description:
        "Where this sits after the call: 'new' for a first touch, 'qualified' once a real need is confirmed, 'demo' if a demo happened or is booked, 'closing' if pricing or contracts are on the table.",
    },
    summary: { type: "string", description: "One or two sentences on what they need." },
    reasoning: { type: "string", description: "One line on why you judged it this way." },
  },
  required: ["isClientMeeting", "companyName", "dealTitle", "stage", "summary", "reasoning"],
} as const;

/** The existing roster, so the model matches instead of creating a near-duplicate. */
function rosterPrompt(): string {
  const s = useCrmStore.getState();
  const companies = s.companies
    .slice(0, 80)
    .map((c) => `  ${c.id} | ${c.name} | ${c.domain ?? "-"}`)
    .join("\n");
  const contacts = s.contacts
    .slice(0, 120)
    .map((c) => `  ${c.name} | ${c.email ?? "-"}`)
    .join("\n");
  return [
    companies ? `EXISTING COMPANIES (id | name | domain):\n${companies}` : "No companies in the CRM yet.",
    contacts ? `EXISTING CONTACTS (name | email):\n${contacts}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function systemPrompt(ownDomain: string | undefined): string {
  return `You read a meeting write-up and extract the CRM records it implies: one company, the external people who were on the call, and one deal.

${ownDomain ? `The user's own company domain is "${ownDomain}". Anyone at that domain is a colleague, never a client contact, and a meeting with only those people is internal.` : "Attendees from a different domain than the user's are the client side."}

RULES
- Match against the roster below before inventing anything. If the meeting is with a company already listed, return its exact id in companyId — a second copy of a company someone already has is the worst outcome here.
- Only include external attendees as contacts.
- Never invent a deal value. Return one only if a figure was genuinely discussed; otherwise omit it.
- Never invent a title, an industry or a domain. Leave the field empty when the notes don't say.
- Judge isClientMeeting honestly. An internal standup with a title that sounds commercial is still internal.
- Keep the deal title short and specific enough to recognise in a pipeline column.

${rosterPrompt()}`;
}

function ownDomainOf(email?: string): string | undefined {
  const at = email?.lastIndexOf("@") ?? -1;
  return at > 0 ? email!.slice(at + 1).toLowerCase() : undefined;
}

/**
 * Long write-ups get trimmed before the call.
 *
 * Everything this extraction needs — who was there, what they want, whether money
 * came up — is in the opening of a meeting summary. Sending the whole thing makes the
 * request slow enough to hit the API gateway's timeout, which fails the whole flow
 * for no gain in accuracy.
 */
const MAX_NOTES_CHARS = 12_000;

function clampNotes(notes: string): string {
  const text = notes.trim();
  if (text.length <= MAX_NOTES_CHARS) return text;
  return `${text.slice(0, MAX_NOTES_CHARS)}\n\n[notes truncated]`;
}

/**
 * Reads the meeting and proposes records. Never writes — the caller shows the
 * result and only commits when a person says so.
 */
export async function proposeFromMeeting(
  detail: GranolaMeetingDetail,
  model: string | null,
): Promise<DealProposal> {
  const crm = useCrmStore.getState();
  const ownDomain = ownDomainOf(crm.identity?.user.email);

  const body = [
    `TITLE: ${detail.title}`,
    `DATE: ${detail.date}`,
    `ATTENDEES: ${detail.attendees || "(not recorded)"}`,
    "",
    clampNotes(detail.notesMarkdown) || "(no notes body was recorded for this meeting)",
  ].join("\n");

  const result = await llm.generate(body, {
    ...(model ? { model } : {}),
    system: systemPrompt(ownDomain),
    output: { type: "json", schema: SCHEMA as unknown as Record<string, unknown> },
    maxOutputTokens: 1200,
    metadata: { feature: "deal-from-meeting", app: "crm" },
  });

  return normalize(result.output, detail, ownDomain);
}

/**
 * A schema constrains shape, not sense — so every field is re-checked against the
 * CRM here: a companyId the model made up is dropped, a contact who already exists
 * is linked rather than duplicated, and a stage outside the vocabulary falls back.
 */
function normalize(
  output: unknown,
  detail: GranolaMeetingDetail,
  ownDomain?: string,
): DealProposal {
  const raw = (output ?? {}) as Record<string, unknown>;
  const crm = useCrmStore.getState();

  const claimedId = asString(raw.companyId);
  const existingCompany = claimedId
    ? crm.companies.find((c) => c.id === claimedId)
    : undefined;

  const companyName =
    asString(raw.companyName) ?? existingCompany?.name ?? detail.title ?? "New company";

  // A name match is as good as an id match, and the model is likelier to get the
  // name right than to copy an id faithfully.
  const byName = existingCompany
    ? undefined
    : crm.companies.find(
        (c) => c.name.trim().toLowerCase() === companyName.trim().toLowerCase(),
      );
  const company = existingCompany ?? byName;

  const meetingEmails = extractEmails(detail.attendees);
  const attendees = extractAttendees(detail.attendees);
  const rawContacts = Array.isArray(raw.contacts) ? raw.contacts : [];
  const contacts: ProposedContact[] = [];
  for (const entry of rawContacts) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const name = asString(item.name);
    if (!name) continue;
    // The model routinely names the person without quoting their address. Backfill it
    // from the attendee list: a contact with no email is invisible to the Granola
    // auto-sync, so every later meeting with them silently fails to import.
    const email =
      asString(item.email)?.toLowerCase() ?? attendeeFor(name, attendees)?.email;
    // Colleagues sometimes slip through despite the prompt; the domain is decisive.
    if (ownDomain && email?.endsWith(`@${ownDomain}`)) continue;
    const existing = crm.contacts.find(
      (c) =>
        (email && c.email?.toLowerCase() === email) ||
        c.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    contacts.push({
      name: existing?.name ?? name,
      email: email ?? existing?.email,
      title: asString(item.title) ?? existing?.title,
      existingId: existing?.id,
    });
  }

  // Fall back to the attendee list when the model returned nobody but the meeting
  // clearly had external people on it. Prefer the parsed pairs, which carry real
  // names; bare addresses only get a name derived from the local part.
  if (!contacts.length) {
    const seen = new Set<string>();
    for (const attendee of attendees) {
      if (ownDomain && attendee.email.endsWith(`@${ownDomain}`)) continue;
      seen.add(attendee.email);
      const existing = crm.contacts.find(
        (c) => c.email?.toLowerCase() === attendee.email,
      );
      contacts.push({
        name: existing?.name ?? (attendee.name || attendee.email.split("@")[0]),
        email: attendee.email,
        existingId: existing?.id,
      });
    }
    for (const email of meetingEmails) {
      if (seen.has(email)) continue;
      if (ownDomain && email.endsWith(`@${ownDomain}`)) continue;
      const existing = crm.contacts.find((c) => c.email?.toLowerCase() === email);
      contacts.push({
        name: existing?.name ?? email.split("@")[0].replace(/[._]+/g, " "),
        email,
        existingId: existing?.id,
      });
    }
  }

  const domain =
    asString(raw.domain)?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") ??
    company?.domain ??
    meetingEmails.find((e) => !ownDomain || !e.endsWith(`@${ownDomain}`))?.split("@")[1];

  return {
    companyId: company?.id,
    companyName: company?.name ?? companyName,
    domain,
    industry: asString(raw.industry) ?? company?.industry,
    contacts,
    dealTitle: asString(raw.dealTitle) ?? `${companyName} — new opportunity`,
    value: asNumber(raw.value),
    stage: asStage(raw.stage) ?? "new",
    summary: asString(raw.summary) ?? "",
    isClientMeeting: raw.isClientMeeting !== false,
    reasoning: asString(raw.reasoning) ?? "",
  };
}
