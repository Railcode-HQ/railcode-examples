// The tools the Ask AI agent can call.
//
// These are `LlmTool` objects handed straight to `llm.stream({ tools })`, so the
// SDK drives the loop: it validates `args` against each `schema`, calls `run`
// here in the page with the app's own SDK authority, feeds `summarize(result)`
// back to the model, and repeats until it answers. Only
// `{ name, description, schema }` crosses the wire — `run` and `summarize`
// never leave the browser.
//
// Two invariants shape everything below:
//
//   1. Reads run immediately; writes await `requestApproval` before touching a
//      single record. A declined write comes back as an ordinary result, not a
//      throw, so the model apologises and moves on instead of burning a retry.
//   2. Every write goes through the same `useCrmStore` action the UI calls. The
//      agent gets no authority the person doesn't already have, and the rest of
//      the app re-renders the instant a record changes.

import {
  ActionItem,
  CallNote,
  Company,
  Contact,
  Deal,
  EntityType,
  Priority,
  STAGES,
  StageId,
  Tone,
  compareActionItems,
  dueState,
  formatMoney,
  newId,
  nowIso,
  stage,
  todayIsoDate,
} from "@/lib/crm";
import {
  Approval,
  RecordLink,
  TableFormat,
  ToolOutcome,
  Viz,
  asEntityType,
  asIsoDate,
  asNumber,
  asPriority,
  asStage,
  asString,
} from "@/lib/ask";
import {
  AUTOMATION_ID,
  ArtifactFormat,
  FORMAT_LABEL,
  displayName,
  effectiveStatus,
  formatBytes,
  isLocalDev,
  templateFor,
} from "@/lib/automations";
import { LlmTool } from "@/lib/railcode";
import {
  automationRecord,
  dealInputFiles,
  fileUrl,
  meetingsForDeal,
  runForDeal,
  templateFiles,
  useAutomationStore,
} from "@/store/automation-store";
import { useCrmStore } from "@/store/crm-store";

/** Asks the person to approve one write. Resolves false if they decline. */
export type ApprovalRequest = Omit<Approval, "id" | "status" | "decide">;
export type RequestApproval = (request: ApprovalRequest) => Promise<boolean>;

const state = () => useCrmStore.getState();

// --- observation shaping ---------------------------------------------------

/** Past this and we're paying tokens for rows the model already summarised. */
const OBSERVATION_CHARS = 6000;

function clip(text: string, max = OBSERVATION_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… truncated (${text.length - max} more characters)`;
}

function listObservation(label: string, items: unknown[], total: number): string {
  if (total === 0) return `No ${label} matched.`;
  const note =
    total > items.length
      ? `\n… ${total - items.length} more not shown — narrow the filters or raise the limit.`
      : "";
  return clip(`${total} ${label}:\n${JSON.stringify(items)}${note}`);
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// --- lookups ---------------------------------------------------------------

function companyOf(id?: string): Company | undefined {
  return id ? state().companies.find((c) => c.id === id) : undefined;
}

function contactOf(id?: string): Contact | undefined {
  return id ? state().contacts.find((c) => c.id === id) : undefined;
}

function dealOf(id?: string): Deal | undefined {
  return id ? state().deals.find((d) => d.id === id) : undefined;
}

/** Ids come from the workspace snapshot, but a model that guesses one should
 *  get a usable error rather than a silent no-op. */
function requireDeal(id: string | undefined): Deal {
  const deal = dealOf(id);
  if (!deal) throw new Error(`No deal with id "${id ?? ""}". Use list_deals to find the right id.`);
  return deal;
}

/** Resolve a company by id, or by exact/prefix name when the model sends prose
 *  instead of an id. Returns undefined rather than throwing — most callers
 *  treat "no company" as simply unlinked. */
function resolveCompany(value: unknown): Company | undefined {
  const text = asString(value);
  if (!text) return undefined;
  const byId = companyOf(text);
  if (byId) return byId;
  const needle = text.toLowerCase();
  const all = state().companies;
  return (
    all.find((c) => c.name.toLowerCase() === needle) ??
    all.find((c) => c.name.toLowerCase().startsWith(needle))
  );
}

function resolveContact(value: unknown): Contact | undefined {
  const text = asString(value);
  if (!text) return undefined;
  const byId = contactOf(text);
  if (byId) return byId;
  const needle = text.toLowerCase();
  const all = state().contacts;
  return (
    all.find((c) => c.name.toLowerCase() === needle) ??
    all.find((c) => c.email?.toLowerCase() === needle) ??
    all.find((c) => c.name.toLowerCase().startsWith(needle))
  );
}

function companyLink(company?: Company): RecordLink | undefined {
  return company ? { type: "company", id: company.id, label: company.name } : undefined;
}

function contactLink(contact?: Contact): RecordLink | undefined {
  return contact ? { type: "contact", id: contact.id, label: contact.name } : undefined;
}

function dealLink(deal?: Deal): RecordLink | undefined {
  return deal ? { type: "deal", id: deal.id, label: deal.title } : undefined;
}

// --- projections -----------------------------------------------------------
//
// The model reads these, not the stored records: ids plus resolved names, dates
// trimmed to days, and no fields it can't act on.

function dealView(deal: Deal) {
  const openActions = state().actionItems.filter((a) => a.dealId === deal.id && !a.done).length;
  return {
    id: deal.id,
    title: deal.title,
    stage: deal.stage,
    value: deal.value ?? null,
    company: companyOf(deal.companyId)?.name ?? null,
    companyId: deal.companyId ?? null,
    contact: contactOf(deal.contactId)?.name ?? null,
    contactId: deal.contactId ?? null,
    openActionItems: openActions,
    updated: deal.updatedAt.slice(0, 10),
    created: deal.createdAt.slice(0, 10),
  };
}

function companyView(company: Company) {
  const deals = state().deals.filter((d) => d.companyId === company.id);
  return {
    id: company.id,
    name: company.name,
    domain: company.domain ?? null,
    industry: company.industry ?? null,
    contacts: state().contacts.filter((c) => c.companyId === company.id).length,
    deals: deals.length,
    openValue: deals
      .filter((d) => !stage(d.stage).terminal)
      .reduce((sum, d) => sum + (d.value ?? 0), 0),
    updated: company.updatedAt.slice(0, 10),
  };
}

function contactView(contact: Contact) {
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    title: contact.title ?? null,
    company: companyOf(contact.companyId)?.name ?? null,
    companyId: contact.companyId ?? null,
    deals: state().deals.filter((d) => d.contactId === contact.id).length,
    callNotes: state().callNotes.filter((n) => n.contactIds?.includes(contact.id)).length,
    updated: contact.updatedAt.slice(0, 10),
  };
}

function actionItemView(item: ActionItem) {
  const deal = dealOf(item.dealId);
  return {
    id: item.id,
    title: item.title,
    priority: item.priority,
    dueDate: item.dueDate ?? null,
    due: dueState(item.dueDate, item.done),
    done: item.done,
    dealId: item.dealId,
    deal: deal?.title ?? null,
    company: companyOf(deal?.companyId)?.name ?? null,
  };
}

function callNoteView(note: CallNote, excerptChars = 240) {
  const people = (note.contactIds ?? [])
    .map((id) => contactOf(id)?.name)
    .filter((name): name is string => Boolean(name));
  return {
    id: note.id,
    title: note.title,
    date: note.date.slice(0, 10),
    people,
    contactIds: note.contactIds ?? [],
    company: companyOf(note.companyId)?.name ?? null,
    source: note.source ?? "manual",
    hasTranscript: Boolean(note.hasTranscript),
    excerpt: excerpt(note.notesMarkdown, excerptChars),
  };
}

function excerpt(markdown: string, max: number): string {
  const flat = markdown.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// --- write plumbing --------------------------------------------------------

function declined(what: string): ToolOutcome {
  return {
    observation: `The user declined this action, so nothing was changed. Do not retry it — acknowledge briefly and ask what they'd like instead.`,
    summary: `${what} — declined`,
    rejected: true,
  };
}

type FieldRow = { label: string; value: string };

/** Renders a patch for the approval card: "Demo → Closing" when a value
 *  changes, the plain new value on a create. Unchanged fields are dropped so
 *  the card shows the decision, not the whole record. */
function diffRows(
  patch: { label: string; next?: string; prev?: string }[],
): FieldRow[] {
  const rows: FieldRow[] = [];
  for (const { label, next, prev } of patch) {
    if (next === undefined) continue;
    const before = prev ?? "";
    if (before === next) continue;
    rows.push({ label, value: before ? `${before} → ${next}` : next });
  }
  return rows;
}

const money = (value?: number) => (value === undefined ? "" : formatMoney(value));

// --- tools -----------------------------------------------------------------

export function buildAskTools(requestApproval: RequestApproval): LlmTool[] {
  /** Every write funnels through here: build the card, wait for the person,
   *  then run the store action they approved. */
  async function gate(
    request: ApprovalRequest,
    run: () => Promise<ToolOutcome>,
  ): Promise<ToolOutcome> {
    const approved = await requestApproval(request);
    if (!approved) return declined(`${request.title} · ${request.subject}`);
    return run();
  }

  const tools: LlmTool[] = [];

  // === reads ===============================================================

  tools.push({
    name: "search_workspace",
    description:
      "Full-text search across companies, contacts, deals, action items and call notes at once. " +
      "Use it when you only have a name or phrase and need the matching record's id. " +
      "For filtered or sorted lists prefer the specific list_* tool.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name, email, phrase or keyword to look for." },
        limit: { type: "number", description: "Max hits per category. Defaults to 8." },
      },
      required: ["query"],
    },
    run: ({ query, limit }: { query?: string; limit?: number }) => {
      const needle = (asString(query) ?? "").toLowerCase();
      if (!needle) throw new Error("search_workspace needs a non-empty query.");
      const cap = Math.min(Math.max(asNumber(limit) ?? 8, 1), 25);
      const s = state();

      const companies = s.companies
        .filter((c) =>
          [c.name, c.domain, c.industry, c.notes].some((f) => f?.toLowerCase().includes(needle)),
        )
        .slice(0, cap);
      const contacts = s.contacts
        .filter((c) =>
          [c.name, c.email, c.title, c.phone, c.notes].some((f) =>
            f?.toLowerCase().includes(needle),
          ),
        )
        .slice(0, cap);
      const deals = s.deals
        .filter((d) => [d.title, d.notes].some((f) => f?.toLowerCase().includes(needle)))
        .slice(0, cap);
      const actionItems = s.actionItems
        .filter((a) => a.title.toLowerCase().includes(needle))
        .slice(0, cap);
      const callNotes = s.callNotes
        .filter(
          (n) =>
            n.title.toLowerCase().includes(needle) ||
            n.notesMarkdown.toLowerCase().includes(needle),
        )
        .slice(0, cap);

      const hits =
        companies.length + contacts.length + deals.length + actionItems.length + callNotes.length;
      const data = {
        companies: companies.map(companyView),
        contacts: contacts.map(contactView),
        deals: deals.map(dealView),
        actionItems: actionItems.map(actionItemView),
        callNotes: callNotes.map((n) => callNoteView(n, 160)),
      };

      return {
        observation:
          hits === 0
            ? `Nothing in the workspace matches "${needle}".`
            : clip(`Matches for "${needle}":\n${JSON.stringify(data)}`),
        summary: `“${needle}” · ${plural(hits, "match", "matches")}`,
        links: [
          ...companies.map((c) => companyLink(c)!),
          ...contacts.map((c) => contactLink(c)!),
          ...deals.map((d) => dealLink(d)!),
        ].slice(0, 6),
        data,
      } satisfies ToolOutcome;
    },
  });

  tools.push({
    name: "list_deals",
    description:
      "List deals with filters. Stages are new, qualified, demo, closing, won, lost — won and lost " +
      "are terminal, so 'open pipeline' means everything else. Use staleDays to find deals nobody " +
      "has touched recently.",
    schema: {
      type: "object",
      properties: {
        stage: {
          type: "string",
          enum: ["new", "qualified", "demo", "closing", "won", "lost"],
        },
        open: { type: "boolean", description: "True for open deals only (excludes won and lost)." },
        companyId: { type: "string", description: "Company id or exact company name." },
        contactId: { type: "string", description: "Contact id or exact contact name." },
        minValue: { type: "number" },
        maxValue: { type: "number" },
        staleDays: {
          type: "number",
          description: "Only deals whose last update is older than this many days.",
        },
        query: { type: "string", description: "Substring match on the deal title." },
        sort: { type: "string", enum: ["value", "updated", "created", "stage"] },
        limit: { type: "number", description: "Defaults to 25, max 100." },
      },
    },
    run: (args: Record<string, unknown>) => {
      const cap = Math.min(Math.max(asNumber(args.limit) ?? 25, 1), 100);
      const wantStage = asStage(args.stage);
      const company = resolveCompany(args.companyId);
      const contact = resolveContact(args.contactId);
      const min = asNumber(args.minValue);
      const max = asNumber(args.maxValue);
      const staleDays = asNumber(args.staleDays);
      const needle = asString(args.query)?.toLowerCase();
      const cutoff =
        staleDays === undefined ? null : Date.now() - staleDays * 24 * 60 * 60 * 1000;

      let rows = state().deals.filter((d) => {
        if (wantStage && d.stage !== wantStage) return false;
        if (args.open === true && stage(d.stage).terminal) return false;
        if (company && d.companyId !== company.id) return false;
        if (contact && d.contactId !== contact.id) return false;
        if (min !== undefined && (d.value ?? 0) < min) return false;
        if (max !== undefined && (d.value ?? 0) > max) return false;
        if (needle && !d.title.toLowerCase().includes(needle)) return false;
        if (cutoff !== null && new Date(d.updatedAt).getTime() > cutoff) return false;
        return true;
      });

      const sort = asString(args.sort) ?? "value";
      const stageRank = (id: StageId) => STAGES.findIndex((s) => s.id === id);
      rows = rows.slice().sort((a, b) => {
        if (sort === "updated") return a.updatedAt < b.updatedAt ? 1 : -1;
        if (sort === "created") return a.createdAt < b.createdAt ? 1 : -1;
        if (sort === "stage") return stageRank(a.stage) - stageRank(b.stage);
        return (b.value ?? 0) - (a.value ?? 0);
      });

      const total = rows.length;
      const shown = rows.slice(0, cap);
      const totalValue = rows.reduce((sum, d) => sum + (d.value ?? 0), 0);
      const data = shown.map(dealView);

      return {
        observation: `${listObservation("deals", data, total)}\nCombined value of all matches: ${formatMoney(totalValue)}.`,
        summary: `${plural(total, "deal")} · ${formatMoney(totalValue)}`,
        links: shown.slice(0, 6).map((d) => dealLink(d)!),
        data,
      } satisfies ToolOutcome;
    },
  });

  tools.push({
    name: "list_companies",
    description: "List companies with their contact counts, deal counts and open pipeline value.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring match on name, domain or industry." },
        industry: { type: "string" },
        sort: { type: "string", enum: ["value", "name", "updated"] },
        limit: { type: "number", description: "Defaults to 50." },
      },
    },
    run: (args: Record<string, unknown>) => {
      const cap = Math.min(Math.max(asNumber(args.limit) ?? 50, 1), 200);
      const needle = asString(args.query)?.toLowerCase();
      const industry = asString(args.industry)?.toLowerCase();

      const rows = state().companies.filter((c) => {
        if (needle && ![c.name, c.domain, c.industry].some((f) => f?.toLowerCase().includes(needle)))
          return false;
        if (industry && !c.industry?.toLowerCase().includes(industry)) return false;
        return true;
      });

      const views = rows.map(companyView);
      const sort = asString(args.sort) ?? "value";
      views.sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "updated") return a.updated < b.updated ? 1 : -1;
        return b.openValue - a.openValue;
      });

      const shown = views.slice(0, cap);
      return {
        observation: listObservation("companies", shown, views.length),
        summary: plural(views.length, "company", "companies"),
        links: shown
          .slice(0, 6)
          .map((c) => ({ type: "company" as EntityType, id: c.id, label: c.name })),
        data: shown,
      } satisfies ToolOutcome;
    },
  });

  tools.push({
    name: "list_contacts",
    description:
      "List people, optionally scoped to one company. Includes how many deals and call notes each " +
      "person is attached to.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring match on name, email or job title." },
        companyId: { type: "string", description: "Company id or exact company name." },
        unlinked: { type: "boolean", description: "True for contacts with no company." },
        withoutDeals: { type: "boolean", description: "True for contacts on no deal." },
        limit: { type: "number", description: "Defaults to 50." },
      },
    },
    run: (args: Record<string, unknown>) => {
      const cap = Math.min(Math.max(asNumber(args.limit) ?? 50, 1), 200);
      const needle = asString(args.query)?.toLowerCase();
      const company = resolveCompany(args.companyId);

      const rows = state().contacts.filter((c) => {
        if (needle && ![c.name, c.email, c.title].some((f) => f?.toLowerCase().includes(needle)))
          return false;
        if (company && c.companyId !== company.id) return false;
        if (args.unlinked === true && c.companyId) return false;
        if (args.withoutDeals === true && state().deals.some((d) => d.contactId === c.id))
          return false;
        return true;
      });

      const shown = rows.slice(0, cap).map(contactView);
      return {
        observation: listObservation("contacts", shown, rows.length),
        summary: plural(rows.length, "contact"),
        links: rows.slice(0, 6).map((c) => contactLink(c)!),
        data: shown,
      } satisfies ToolOutcome;
    },
  });

  tools.push({
    name: "list_action_items",
    description:
      "List action items (tasks). Each one belongs to a deal. Priorities run p0 (most urgent) to " +
      "p4. Use overdue:true for anything past its due date, or dueBefore for a window.",
    schema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        status: { type: "string", enum: ["open", "done", "all"], description: "Defaults to open." },
        priority: { type: "string", enum: ["p0", "p1", "p2", "p3", "p4"] },
        overdue: { type: "boolean" },
        dueBefore: { type: "string", description: "YYYY-MM-DD." },
        companyId: { type: "string", description: "Company id or name — filters via the deal." },
        limit: { type: "number", description: "Defaults to 50." },
      },
    },
    run: (args: Record<string, unknown>) => {
      const cap = Math.min(Math.max(asNumber(args.limit) ?? 50, 1), 200);
      const status = asString(args.status) ?? "open";
      const priority = asPriority(args.priority);
      const dueBefore = asIsoDate(args.dueBefore);
      const dealId = asString(args.dealId);
      const company = resolveCompany(args.companyId);
      const today = todayIsoDate();

      const rows = state()
        .actionItems.filter((a) => {
          if (status === "open" && a.done) return false;
          if (status === "done" && !a.done) return false;
          if (priority && a.priority !== priority) return false;
          if (dealId && a.dealId !== dealId) return false;
          if (args.overdue === true && !(a.dueDate && a.dueDate < today && !a.done)) return false;
          if (dueBefore && !(a.dueDate && a.dueDate <= dueBefore)) return false;
          if (company && dealOf(a.dealId)?.companyId !== company.id) return false;
          return true;
        })
        .sort(compareActionItems);

      const shown = rows.slice(0, cap).map(actionItemView);
      const overdue = rows.filter((a) => !a.done && a.dueDate && a.dueDate < today).length;
      return {
        observation: `${listObservation("action items", shown, rows.length)}${
          overdue ? `\n${overdue} of them are overdue (today is ${today}).` : ""
        }`,
        summary: `${plural(rows.length, "action item")}${overdue ? ` · ${overdue} overdue` : ""}`,
        data: shown,
      } satisfies ToolOutcome;
    },
  });

  tools.push({
    name: "list_call_notes",
    description:
      "List meeting/call notes with a short excerpt of each. Notes are attached to the people who " +
      "were on the call. Call read_call_note for the full text before quoting or summarising one.",
    schema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "Contact id or exact name." },
        companyId: {
          type: "string",
          description: "Company id or name — matches notes with anyone from that company.",
        },
        query: { type: "string", description: "Substring match on title or note body." },
        since: { type: "string", description: "YYYY-MM-DD — only notes on or after this date." },
        limit: { type: "number", description: "Defaults to 15." },
      },
    },
    run: (args: Record<string, unknown>) => {
      const cap = Math.min(Math.max(asNumber(args.limit) ?? 15, 1), 60);
      const contact = resolveContact(args.contactId);
      const company = resolveCompany(args.companyId);
      const needle = asString(args.query)?.toLowerCase();
      const since = asIsoDate(args.since);

      const companyPeople = company
        ? new Set(state().contacts.filter((c) => c.companyId === company.id).map((c) => c.id))
        : null;

      const rows = state().callNotes.filter((n) => {
        if (contact && !(n.contactIds ?? []).includes(contact.id)) return false;
        if (companyPeople) {
          const linked =
            n.companyId === company?.id ||
            (n.contactIds ?? []).some((id) => companyPeople.has(id));
          if (!linked) return false;
        }
        if (needle && ![n.title, n.notesMarkdown].some((f) => f?.toLowerCase().includes(needle)))
          return false;
        if (since && n.date.slice(0, 10) < since) return false;
        return true;
      });

      const shown = rows.slice(0, cap).map((n) => callNoteView(n));
      return {
        observation: listObservation("call notes", shown, rows.length),
        summary: plural(rows.length, "call note"),
        data: shown,
      } satisfies ToolOutcome;
    },
  });

  tools.push({
    name: "read_call_note",
    description:
      "Read one call note in full. Set includeTranscript when the summary isn't enough and the " +
      "note has one — transcripts are long, so only ask when you need verbatim wording.",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The call note id from list_call_notes." },
        includeTranscript: { type: "boolean" },
      },
      required: ["id"],
    },
    run: async ({ id, includeTranscript }: { id?: string; includeTranscript?: boolean }) => {
      const noteId = asString(id);
      const note = state().callNotes.find((n) => n.id === noteId);
      if (!note) {
        throw new Error(`No call note with id "${noteId ?? ""}". Use list_call_notes first.`);
      }
      const view = callNoteView(note, 0);
      const people = view.people.join(", ") || "nobody linked";

      let transcript: string | null = null;
      if (includeTranscript && note.hasTranscript) {
        transcript = await state().loadTranscript(note.meetingId);
      }

      const body = [
        `Call note "${note.title}" (${view.date}) with ${people}.`,
        "",
        note.notesMarkdown || "(the note body is empty)",
        transcript ? `\n--- transcript ---\n${clip(transcript, 12000)}` : "",
      ].join("\n");

      return {
        observation: clip(body, 16000),
        summary: `${note.title} · ${view.date}`,
        links: (note.contactIds ?? [])
          .map((cid) => contactLink(contactOf(cid)))
          .filter((l): l is RecordLink => Boolean(l)),
        data: {
          ...view,
          notesMarkdown: note.notesMarkdown,
          transcriptIncluded: Boolean(transcript),
        },
      } satisfies ToolOutcome;
    },
  });

  tools.push({
    name: "list_activity",
    description:
      "The timeline: notes people logged and events the CRM recorded (records created, stages " +
      "moved). Use it for 'what happened recently' or the history of one record.",
    schema: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: ["company", "contact", "deal"] },
        entityId: { type: "string" },
        kind: { type: "string", enum: ["note", "event"] },
        since: { type: "string", description: "YYYY-MM-DD." },
        limit: { type: "number", description: "Defaults to 30." },
      },
    },
    run: (args: Record<string, unknown>) => {
      const cap = Math.min(Math.max(asNumber(args.limit) ?? 30, 1), 150);
      const type = asEntityType(args.entityType);
      const entityId = asString(args.entityId);
      const kind = asString(args.kind);
      const since = asIsoDate(args.since);

      const rows = state().activities.filter((a) => {
        if (type && a.entityType !== type) return false;
        if (entityId && a.entityId !== entityId) return false;
        if (kind && a.kind !== kind) return false;
        if (since && a.createdAt.slice(0, 10) < since) return false;
        return true;
      });

      const nameOf = (a: { entityType: EntityType; entityId: string }): string => {
        if (a.entityType === "company") return companyOf(a.entityId)?.name ?? "(deleted)";
        if (a.entityType === "contact") return contactOf(a.entityId)?.name ?? "(deleted)";
        return dealOf(a.entityId)?.title ?? "(deleted)";
      };

      const shown = rows.slice(0, cap).map((a) => ({
        id: a.id,
        kind: a.kind,
        body: a.body,
        on: `${a.entityType}: ${nameOf(a)}`,
        entityType: a.entityType,
        entityId: a.entityId,
        author: a.author ?? null,
        at: a.createdAt.slice(0, 16).replace("T", " "),
      }));

      return {
        observation: listObservation("activity entries", shown, rows.length),
        summary: plural(rows.length, "activity entry", "activity entries"),
        data: shown,
      } satisfies ToolOutcome;
    },
  });

  tools.push({
    name: "get_record",
    description:
      "One company, contact or deal in full, together with everything attached to it — related " +
      "deals, people, action items, call notes and recent activity. The fastest way to answer " +
      "'tell me about X' or to gather context before proposing a change.",
    schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["company", "contact", "deal"] },
        id: { type: "string", description: "The record id, or its exact name/title." },
      },
      required: ["type", "id"],
    },
    run: ({ type, id }: { type?: string; id?: string }) => {
      const kind = asEntityType(type);
      if (!kind) throw new Error("get_record needs type to be company, contact or deal.");
      const s = state();
      const recent = (entityType: EntityType, entityId: string) =>
        s.activities
          .filter((a) => a.entityType === entityType && a.entityId === entityId)
          .slice(0, 10)
          .map((a) => ({ kind: a.kind, body: a.body, at: a.createdAt.slice(0, 10) }));

      if (kind === "company") {
        const company = resolveCompany(id);
        if (!company) throw new Error(`No company matches "${asString(id) ?? ""}".`);
        const people = s.contacts.filter((c) => c.companyId === company.id);
        const deals = s.deals.filter((d) => d.companyId === company.id);
        const data = {
          ...companyView(company),
          notes: company.notes ?? null,
          people: people.map(contactView),
          deals: deals.map(dealView),
          callNotes: s.callNotes
            .filter(
              (n) =>
                n.companyId === company.id ||
                (n.contactIds ?? []).some((cid) => people.some((p) => p.id === cid)),
            )
            .slice(0, 10)
            .map((n) => callNoteView(n, 160)),
          activity: recent("company", company.id),
        };
        return {
          observation: clip(JSON.stringify(data)),
          summary: `${company.name} · ${plural(deals.length, "deal")}`,
          links: [companyLink(company)!, ...deals.slice(0, 5).map((d) => dealLink(d)!)],
          data,
        } satisfies ToolOutcome;
      }

      if (kind === "contact") {
        const contact = resolveContact(id);
        if (!contact) throw new Error(`No contact matches "${asString(id) ?? ""}".`);
        const deals = s.deals.filter((d) => d.contactId === contact.id);
        const data = {
          ...contactView(contact),
          notes: contact.notes ?? null,
          deals: deals.map(dealView),
          callNotes: s.callNotes
            .filter((n) => (n.contactIds ?? []).includes(contact.id))
            .slice(0, 10)
            .map((n) => callNoteView(n, 160)),
          activity: recent("contact", contact.id),
        };
        return {
          observation: clip(JSON.stringify(data)),
          summary: `${contact.name} · ${plural(deals.length, "deal")}`,
          links: [contactLink(contact)!, ...deals.slice(0, 5).map((d) => dealLink(d)!)],
          data,
        } satisfies ToolOutcome;
      }

      const text = asString(id);
      const deal =
        dealOf(text) ??
        s.deals.find((d) => d.title.toLowerCase() === text?.toLowerCase()) ??
        s.deals.find((d) => d.title.toLowerCase().startsWith((text ?? "").toLowerCase()));
      if (!deal) throw new Error(`No deal matches "${text ?? ""}".`);
      const data = {
        ...dealView(deal),
        notes: deal.notes ?? null,
        actionItems: s.actionItems
          .filter((a) => a.dealId === deal.id)
          .sort(compareActionItems)
          .map(actionItemView),
        activity: recent("deal", deal.id),
      };
      return {
        observation: clip(JSON.stringify(data)),
        summary: `${deal.title} · ${stage(deal.stage).label}`,
        links: [
          dealLink(deal)!,
          companyLink(companyOf(deal.companyId)),
          contactLink(contactOf(deal.contactId)),
        ].filter((l): l is RecordLink => Boolean(l)),
        data,
      } satisfies ToolOutcome;
    },
  });

  tools.push({
    name: "pipeline_stats",
    description:
      "Aggregate snapshot: deal count and value per stage, total open pipeline, average deal size, " +
      "win rate, and open/overdue action item counts. Start here for any 'how are we doing' question.",
    schema: { type: "object", properties: {} },
    run: () => {
      const s = state();
      const today = todayIsoDate();
      const byStage = STAGES.map((st) => {
        const list = s.deals.filter((d) => d.stage === st.id);
        return {
          stage: st.id,
          label: st.label,
          count: list.length,
          value: list.reduce((sum, d) => sum + (d.value ?? 0), 0),
        };
      });
      const open = s.deals.filter((d) => !stage(d.stage).terminal);
      const won = s.deals.filter((d) => d.stage === "won");
      const lost = s.deals.filter((d) => d.stage === "lost");
      const openValue = open.reduce((sum, d) => sum + (d.value ?? 0), 0);
      const decided = won.length + lost.length;

      const data = {
        totals: {
          deals: s.deals.length,
          openDeals: open.length,
          openValue,
          averageOpenValue: open.length ? Math.round(openValue / open.length) : 0,
          wonCount: won.length,
          wonValue: won.reduce((sum, d) => sum + (d.value ?? 0), 0),
          lostCount: lost.length,
          winRatePercent: decided ? Math.round((won.length / decided) * 100) : null,
          companies: s.companies.length,
          contacts: s.contacts.length,
          openActionItems: s.actionItems.filter((a) => !a.done).length,
          overdueActionItems: s.actionItems.filter(
            (a) => !a.done && a.dueDate && a.dueDate < today,
          ).length,
        },
        byStage,
        today,
      };

      return {
        observation: JSON.stringify(data),
        summary: `${formatMoney(openValue)} open · ${plural(open.length, "deal")}`,
        data,
      } satisfies ToolOutcome;
    },
  });

  // === writes ==============================================================

  tools.push({
    name: "save_deal",
    description:
      "Create a deal, or update one by passing its id. WITHOUT an id this creates a NEW deal — " +
      "always pass the id when changing something that already exists. Only the fields you pass " +
      "change. Stages: new, qualified, demo, closing, won, lost. Needs the user's approval.",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Omit to create; pass to update an existing deal." },
        title: { type: "string" },
        value: { type: "number", description: "Deal size in US dollars, as a plain number." },
        stage: { type: "string", enum: ["new", "qualified", "demo", "closing", "won", "lost"] },
        companyId: { type: "string", description: "Company id (or exact company name)." },
        contactId: { type: "string", description: "Primary contact id (or exact name)." },
        notes: { type: "string" },
      },
    },
    run: async (args: Record<string, unknown>) => {
      const existing = dealOf(asString(args.id));
      if (asString(args.id) && !existing) {
        throw new Error(`No deal with id "${asString(args.id)}". Use list_deals to find it.`);
      }
      const title = asString(args.title) ?? existing?.title;
      if (!title) throw new Error("A new deal needs a title.");

      const value = asNumber(args.value);
      const nextStage = asStage(args.stage);
      const company = "companyId" in args ? resolveCompany(args.companyId) : undefined;
      const contact = "contactId" in args ? resolveContact(args.contactId) : undefined;
      const notes = asString(args.notes);

      const fields = diffRows([
        { label: "Title", next: asString(args.title), prev: existing?.title },
        { label: "Value", next: money(value), prev: money(existing?.value) },
        {
          label: "Stage",
          next: nextStage ? stage(nextStage).label : undefined,
          prev: existing ? stage(existing.stage).label : undefined,
        },
        {
          label: "Company",
          next: company?.name,
          prev: companyOf(existing?.companyId)?.name,
        },
        {
          label: "Contact",
          next: contact?.name,
          prev: contactOf(existing?.contactId)?.name,
        },
        { label: "Notes", next: notes, prev: existing?.notes },
      ]);

      if (existing && fields.length === 0) {
        return {
          observation: "Nothing to change — the deal already has those values.",
          summary: `${existing.title} · already up to date`,
          links: [dealLink(existing)!],
        } satisfies ToolOutcome;
      }

      return gate(
        {
          tool: "save_deal",
          title: existing ? "Update deal" : "Create deal",
          subject: title,
          fields: fields.length ? fields : [{ label: "Stage", value: "New" }],
          destructive: false,
        },
        async () => {
          const deal = await state().saveDeal({
            ...(existing ? { id: existing.id } : {}),
            title,
            ...(value !== undefined ? { value } : {}),
            ...(nextStage ? { stage: nextStage } : {}),
            ...(company ? { companyId: company.id } : {}),
            ...(contact ? { contactId: contact.id } : {}),
            ...(notes !== undefined ? { notes } : {}),
          });
          return {
            observation: `${existing ? "Updated" : "Created"} deal: ${JSON.stringify(dealView(deal))}`,
            summary: `${existing ? "Updated" : "Created"} ${deal.title}`,
            links: [dealLink(deal)!],
            data: dealView(deal),
          } satisfies ToolOutcome;
        },
      );
    },
  });

  tools.push({
    name: "save_company",
    description:
      "Create a company, or update one by passing its id. Without an id this creates a NEW company " +
      "— check the workspace snapshot or search first so you don't duplicate one. Needs approval.",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Omit to create; pass to update." },
        name: { type: "string" },
        domain: { type: "string", description: "e.g. acme.com" },
        industry: { type: "string" },
        notes: { type: "string" },
      },
    },
    run: async (args: Record<string, unknown>) => {
      const existing = companyOf(asString(args.id));
      if (asString(args.id) && !existing) {
        throw new Error(`No company with id "${asString(args.id)}".`);
      }
      const name = asString(args.name) ?? existing?.name;
      if (!name) throw new Error("A new company needs a name.");

      const domain = asString(args.domain);
      const industry = asString(args.industry);
      const notes = asString(args.notes);

      // Creating a second "Acme Corp" is the most likely accident here, so
      // catch it before the person is asked to approve anything.
      if (!existing) {
        const clash = state().findCompanyByName(name);
        if (clash) {
          return {
            observation: `"${name}" already exists (id ${clash.id}). Nothing was created. Update that record instead, or tell the user it is already there.`,
            summary: `${name} already exists`,
            links: [companyLink(clash)!],
            data: companyView(clash),
          } satisfies ToolOutcome;
        }
      }

      const fields = diffRows([
        { label: "Name", next: asString(args.name), prev: existing?.name },
        { label: "Domain", next: domain, prev: existing?.domain },
        { label: "Industry", next: industry, prev: existing?.industry },
        { label: "Notes", next: notes, prev: existing?.notes },
      ]);

      if (existing && fields.length === 0) {
        return {
          observation: "Nothing to change — the company already has those values.",
          summary: `${existing.name} · already up to date`,
          links: [companyLink(existing)!],
        } satisfies ToolOutcome;
      }

      return gate(
        {
          tool: "save_company",
          title: existing ? "Update company" : "Create company",
          subject: name,
          fields: fields.length ? fields : [{ label: "Name", value: name }],
          destructive: false,
        },
        async () => {
          const company = await state().saveCompany({
            ...(existing ? { id: existing.id } : {}),
            name,
            ...(domain !== undefined ? { domain } : {}),
            ...(industry !== undefined ? { industry } : {}),
            ...(notes !== undefined ? { notes } : {}),
          });
          return {
            observation: `${existing ? "Updated" : "Created"} company: ${JSON.stringify(companyView(company))}`,
            summary: `${existing ? "Updated" : "Created"} ${company.name}`,
            links: [companyLink(company)!],
            data: companyView(company),
          } satisfies ToolOutcome;
        },
      );
    },
  });

  tools.push({
    name: "save_contact",
    description:
      "Create a person, or update one by passing its id. Without an id this creates a NEW contact. " +
      "Link them to a company with companyId. Needs approval.",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Omit to create; pass to update." },
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        title: { type: "string", description: "Their job title." },
        companyId: { type: "string", description: "Company id (or exact company name)." },
        notes: { type: "string" },
      },
    },
    run: async (args: Record<string, unknown>) => {
      const existing = contactOf(asString(args.id));
      if (asString(args.id) && !existing) {
        throw new Error(`No contact with id "${asString(args.id)}".`);
      }
      const name = asString(args.name) ?? existing?.name;
      if (!name) throw new Error("A new contact needs a name.");

      const email = asString(args.email);
      const phone = asString(args.phone);
      const jobTitle = asString(args.title);
      const company = "companyId" in args ? resolveCompany(args.companyId) : undefined;
      const notes = asString(args.notes);

      const fields = diffRows([
        { label: "Name", next: asString(args.name), prev: existing?.name },
        { label: "Email", next: email, prev: existing?.email },
        { label: "Phone", next: phone, prev: existing?.phone },
        { label: "Title", next: jobTitle, prev: existing?.title },
        { label: "Company", next: company?.name, prev: companyOf(existing?.companyId)?.name },
        { label: "Notes", next: notes, prev: existing?.notes },
      ]);

      if (existing && fields.length === 0) {
        return {
          observation: "Nothing to change — the contact already has those values.",
          summary: `${existing.name} · already up to date`,
          links: [contactLink(existing)!],
        } satisfies ToolOutcome;
      }

      return gate(
        {
          tool: "save_contact",
          title: existing ? "Update contact" : "Create contact",
          subject: name,
          fields: fields.length ? fields : [{ label: "Name", value: name }],
          destructive: false,
        },
        async () => {
          const contact = await state().saveContact({
            ...(existing ? { id: existing.id } : {}),
            name,
            ...(email !== undefined ? { email } : {}),
            ...(phone !== undefined ? { phone } : {}),
            ...(jobTitle !== undefined ? { title: jobTitle } : {}),
            ...(company ? { companyId: company.id } : {}),
            ...(notes !== undefined ? { notes } : {}),
          });
          return {
            observation: `${existing ? "Updated" : "Created"} contact: ${JSON.stringify(contactView(contact))}`,
            summary: `${existing ? "Updated" : "Created"} ${contact.name}`,
            links: [contactLink(contact)!],
            data: contactView(contact),
          } satisfies ToolOutcome;
        },
      );
    },
  });

  tools.push({
    name: "save_action_item",
    description:
      "Create an action item on a deal, or update one by passing its id — including ticking it off " +
      "with done:true. Priorities run p0 (most urgent) to p4; default p2. Needs approval.",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Omit to create; pass to update." },
        dealId: { type: "string", description: "Required when creating — the deal it belongs to." },
        title: { type: "string" },
        priority: { type: "string", enum: ["p0", "p1", "p2", "p3", "p4"] },
        dueDate: { type: "string", description: "YYYY-MM-DD, or omit for no due date." },
        done: { type: "boolean" },
      },
    },
    run: async (args: Record<string, unknown>) => {
      const id = asString(args.id);
      const existing = id ? state().actionItems.find((a) => a.id === id) : undefined;
      if (id && !existing) throw new Error(`No action item with id "${id}".`);

      const deal = existing ? requireDeal(existing.dealId) : requireDeal(asString(args.dealId));
      const title = asString(args.title) ?? existing?.title;
      if (!title) throw new Error("An action item needs a title.");

      const priority = asPriority(args.priority) ?? existing?.priority ?? ("p2" as Priority);
      const dueDate = "dueDate" in args ? asIsoDate(args.dueDate) : existing?.dueDate;
      const done = typeof args.done === "boolean" ? args.done : existing?.done ?? false;

      const fields = diffRows([
        { label: "Task", next: asString(args.title), prev: existing?.title },
        { label: "Deal", next: deal.title, prev: existing ? deal.title : undefined },
        {
          label: "Priority",
          next: priority.toUpperCase(),
          prev: existing?.priority.toUpperCase(),
        },
        { label: "Due", next: dueDate ?? "", prev: existing?.dueDate ?? "" },
        {
          label: "Status",
          next: done ? "Done" : "Open",
          prev: existing ? (existing.done ? "Done" : "Open") : undefined,
        },
      ]);

      if (existing && fields.length === 0) {
        return {
          observation: "Nothing to change — the action item already has those values.",
          summary: `${existing.title} · already up to date`,
          links: [dealLink(deal)!],
        } satisfies ToolOutcome;
      }

      return gate(
        {
          tool: "save_action_item",
          title: existing ? "Update action item" : "Create action item",
          subject: title,
          fields: fields.length
            ? fields
            : [
                { label: "Deal", value: deal.title },
                { label: "Priority", value: priority.toUpperCase() },
              ],
          destructive: false,
        },
        async () => {
          const item = await state().saveActionItem({
            ...(existing ? { id: existing.id } : {}),
            dealId: deal.id,
            title,
            priority,
            dueDate,
            done,
          });
          return {
            observation: `${existing ? "Updated" : "Created"} action item: ${JSON.stringify(actionItemView(item))}`,
            summary: `${existing ? "Updated" : "Created"} ${item.title}`,
            links: [dealLink(deal)!],
            data: actionItemView(item),
          } satisfies ToolOutcome;
        },
      );
    },
  });

  tools.push({
    name: "add_activity_note",
    description:
      "Log a timestamped note on a company, contact or deal's timeline. Use this for context worth " +
      "keeping ('they're evaluating a competitor'), not for tasks — those are action items. " +
      "Needs approval.",
    schema: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: ["company", "contact", "deal"] },
        entityId: { type: "string" },
        body: { type: "string", description: "The note text." },
      },
      required: ["entityType", "entityId", "body"],
    },
    run: async (args: Record<string, unknown>) => {
      const type = asEntityType(args.entityType);
      if (!type) throw new Error("entityType must be company, contact or deal.");
      const body = asString(args.body);
      if (!body) throw new Error("The note body cannot be empty.");

      const id = asString(args.entityId) ?? "";
      const record =
        type === "company"
          ? companyOf(id)
          : type === "contact"
            ? contactOf(id)
            : dealOf(id);
      if (!record) throw new Error(`No ${type} with id "${id}".`);
      const label = "name" in record ? record.name : record.title;

      return gate(
        {
          tool: "add_activity_note",
          title: "Log note",
          subject: label,
          fields: [
            { label: "On", value: `${type} · ${label}` },
            { label: "Note", value: body },
          ],
          destructive: false,
        },
        async () => {
          await state().addNote(type, record.id, body);
          return {
            observation: `Logged a note on ${type} "${label}".`,
            summary: `Note logged on ${label}`,
            links: [{ type, id: record.id, label }],
          } satisfies ToolOutcome;
        },
      );
    },
  });

  tools.push({
    name: "save_call_note",
    description:
      "Write up a meeting the user describes, attached to the people who were on it. Pass an id to " +
      "edit an existing note. notesMarkdown supports headings and bullets. Needs approval.",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Omit to create a new note." },
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        contactIds: {
          type: "array",
          items: { type: "string" },
          description: "Ids of the people on the call.",
        },
        notesMarkdown: { type: "string", description: "The write-up, in markdown." },
        attendees: { type: "string", description: "Free-text attendee list." },
      },
      required: ["title", "notesMarkdown"],
    },
    run: async (args: Record<string, unknown>) => {
      const id = asString(args.id);
      const existing = id ? state().callNotes.find((n) => n.id === id) : undefined;
      if (id && !existing) throw new Error(`No call note with id "${id}".`);

      const title = asString(args.title) ?? existing?.title;
      if (!title) throw new Error("A call note needs a title.");
      const notesMarkdown = asString(args.notesMarkdown) ?? existing?.notesMarkdown ?? "";
      const date = asIsoDate(args.date) ?? existing?.date.slice(0, 10) ?? todayIsoDate();

      const people = Array.isArray(args.contactIds)
        ? args.contactIds
            .map((value) => resolveContact(value))
            .filter((c): c is Contact => Boolean(c))
        : existing
          ? (existing.contactIds ?? [])
              .map((cid) => contactOf(cid))
              .filter((c): c is Contact => Boolean(c))
          : [];

      const attendees =
        asString(args.attendees) ?? existing?.attendees ?? people.map((p) => p.name).join(", ");

      return gate(
        {
          tool: "save_call_note",
          title: existing ? "Update call note" : "Log call note",
          subject: title,
          fields: [
            { label: "Date", value: date },
            { label: "People", value: people.map((p) => p.name).join(", ") || "—" },
            { label: "Notes", value: excerpt(notesMarkdown, 400) },
          ],
          destructive: false,
        },
        async () => {
          const note: CallNote = {
            id: existing?.id ?? newId("cn"),
            meetingId: existing?.meetingId ?? newId("mtg"),
            contactIds: people.map((p) => p.id),
            title,
            // Stored as a full timestamp like the rest of the app; the date the
            // user gave anchors the day.
            date: existing && !asIsoDate(args.date) ? existing.date : `${date}T12:00:00.000Z`,
            attendees,
            notesMarkdown,
            createdAt: existing?.createdAt ?? nowIso(),
            updatedAt: nowIso(),
            source: existing?.source ?? "manual",
            importedBy: existing?.importedBy ?? state().identity?.user.name,
            hasTranscript: existing?.hasTranscript,
            ...(existing?.companyId ? { companyId: existing.companyId } : {}),
          };
          await state().saveCallNote(note);
          return {
            observation: `${existing ? "Updated" : "Created"} call note "${title}" (${date}) with ${
              people.map((p) => p.name).join(", ") || "nobody linked"
            }.`,
            summary: `${existing ? "Updated" : "Logged"} ${title}`,
            links: people.map((p) => contactLink(p)!),
            data: callNoteView(note, 200),
          } satisfies ToolOutcome;
        },
      );
    },
  });

  tools.push({
    name: "delete_record",
    description:
      "Permanently delete a record. Deleting a company unlinks its people and deals; deleting a " +
      "deal also removes its action items. Only call this when the user clearly asked for it — " +
      "it needs their explicit approval and cannot be undone.",
    schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["company", "contact", "deal", "action_item", "call_note"],
        },
        id: { type: "string" },
      },
      required: ["type", "id"],
    },
    run: async ({ type, id }: { type?: string; id?: string }) => {
      const kind = asString(type);
      const recordId = asString(id) ?? "";
      const s = state();

      const target = (() => {
        if (kind === "company") {
          const c = companyOf(recordId);
          return c && { label: c.name, extra: `${plural(s.contacts.filter((x) => x.companyId === c.id).length, "contact")}, ${plural(s.deals.filter((d) => d.companyId === c.id).length, "deal")} will be unlinked` };
        }
        if (kind === "contact") {
          const c = contactOf(recordId);
          return c && { label: c.name, extra: c.email ?? "" };
        }
        if (kind === "deal") {
          const d = dealOf(recordId);
          return (
            d && {
              label: d.title,
              extra: `${stage(d.stage).label} · ${formatMoney(d.value)} · ${plural(s.actionItems.filter((a) => a.dealId === d.id).length, "action item")} also deleted`,
            }
          );
        }
        if (kind === "action_item") {
          const a = s.actionItems.find((x) => x.id === recordId);
          return a && { label: a.title, extra: dealOf(a.dealId)?.title ?? "" };
        }
        if (kind === "call_note") {
          const n = s.callNotes.find((x) => x.id === recordId);
          return n && { label: n.title, extra: n.date.slice(0, 10) };
        }
        return undefined;
      })();

      if (!target) throw new Error(`No ${kind ?? "record"} with id "${recordId}".`);

      return gate(
        {
          tool: "delete_record",
          title: `Delete ${kind!.replace("_", " ")}`,
          subject: target.label,
          fields: target.extra ? [{ label: "Impact", value: target.extra }] : [],
          destructive: true,
        },
        async () => {
          if (kind === "company") await state().deleteCompany(recordId);
          else if (kind === "contact") await state().deleteContact(recordId);
          else if (kind === "deal") await state().deleteDeal(recordId);
          else if (kind === "action_item") await state().deleteActionItem(recordId);
          else if (kind === "call_note") {
            const note = state().callNotes.find((x) => x.id === recordId);
            if (note) await state().deleteCallNote(note);
          }
          return {
            observation: `Deleted ${kind} "${target.label}".`,
            summary: `Deleted ${target.label}`,
          } satisfies ToolOutcome;
        },
      );
    },
  });

  // === display =============================================================
  //
  // These paint the transcript and return almost nothing to the model, which is
  // the point: the user sees a full table, the model pays for one line.

  tools.push({
    name: "render_table",
    description:
      "Show a table in the chat. Use it whenever the answer is a list of records — deals, people, " +
      "action items — instead of writing rows out in prose. Give every row a link so the user can " +
      "click through to the record. Column formats right-align and style the values: money, " +
      "number, date, stage, priority. Then write a one-line takeaway; don't repeat the rows.",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        columns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              format: {
                type: "string",
                enum: ["text", "money", "number", "date", "stage", "priority"],
              },
            },
            required: ["label"],
          },
        },
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              cells: {
                type: "array",
                items: { type: "string" },
                description: "One value per column, in order. Numbers as plain strings.",
              },
              link: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["company", "contact", "deal"] },
                  id: { type: "string" },
                },
                required: ["type", "id"],
                description: "Makes the row clickable. Omit if it isn't one record.",
              },
            },
            required: ["cells"],
          },
        },
        note: { type: "string", description: "Optional caption under the table." },
      },
      required: ["columns", "rows"],
    },
    run: (args: Record<string, unknown>) => {
      const columns = (Array.isArray(args.columns) ? args.columns : [])
        .map((raw) => {
          const col = (raw ?? {}) as Record<string, unknown>;
          const label = asString(col.label);
          if (!label) return null;
          return { label, format: (asString(col.format) as TableFormat) ?? "text" };
        })
        .filter((c): c is { label: string; format: TableFormat } => Boolean(c));

      if (!columns.length) throw new Error("render_table needs at least one column with a label.");

      const rows = (Array.isArray(args.rows) ? args.rows : []).map((raw) => {
        const row = (raw ?? {}) as Record<string, unknown>;
        const cells = (Array.isArray(row.cells) ? row.cells : []).map(
          (cell) => asString(cell) ?? "",
        );
        // Pad or trim so a miscounted row never breaks the table layout.
        while (cells.length < columns.length) cells.push("");
        const linkRaw = (row.link ?? {}) as Record<string, unknown>;
        const linkType = asEntityType(linkRaw.type);
        const linkId = asString(linkRaw.id);
        const link =
          linkType && linkId
            ? { type: linkType, id: linkId, label: cells[0] ?? linkId }
            : undefined;
        return { cells: cells.slice(0, columns.length), link };
      });

      const viz: Viz = {
        kind: "table",
        title: asString(args.title),
        note: asString(args.note),
        columns,
        rows,
      };

      return {
        observation: `Table rendered for the user (${plural(rows.length, "row")}). They can see every row — summarise, don't repeat it.`,
        summary: `${asString(args.title) ?? "Table"} · ${plural(rows.length, "row")}`,
        viz,
      } satisfies ToolOutcome;
    },
  });

  tools.push({
    name: "render_chart",
    description:
      "Show a horizontal bar chart. Good for pipeline by stage, value by company, deals per month " +
      "— anything comparing a handful of labelled numbers. Keep it under ~12 bars. Tones: accent " +
      "(blue), green, violet, amber, red, dim; the stage colours are dim/accent/violet/amber/" +
      "green/red in stage order.",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        format: { type: "string", enum: ["money", "number"], description: "Defaults to number." },
        series: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number" },
              tone: {
                type: "string",
                enum: ["accent", "green", "violet", "amber", "red", "dim"],
              },
            },
            required: ["label", "value"],
          },
        },
        note: { type: "string" },
      },
      required: ["series"],
    },
    run: (args: Record<string, unknown>) => {
      type Point = { label: string; value: number; tone?: Tone };
      const series = (Array.isArray(args.series) ? args.series : [])
        .map((raw): Point | null => {
          const point = (raw ?? {}) as Record<string, unknown>;
          const label = asString(point.label);
          const value = asNumber(point.value);
          if (!label || value === undefined) return null;
          return { label, value, tone: asString(point.tone) as Tone | undefined };
        })
        .filter((p): p is Point => p !== null);

      if (!series.length) throw new Error("render_chart needs at least one {label, value} point.");

      const viz: Viz = {
        kind: "chart",
        title: asString(args.title),
        note: asString(args.note),
        format: asString(args.format) === "money" ? "money" : "number",
        series,
      };

      return {
        observation: `Chart rendered for the user (${plural(series.length, "bar")}). Interpret it in one or two lines rather than listing the values.`,
        summary: `${asString(args.title) ?? "Chart"} · ${plural(series.length, "bar")}`,
        viz,
      } satisfies ToolOutcome;
    },
  });

  tools.push({
    name: "render_stats",
    description:
      "Show a row of headline numbers (2–4 works best) — total pipeline, open deals, win rate. " +
      "Format the values yourself, e.g. \"$1.2M\" or \"64%\". Use it to open an answer about how " +
      "things are going, then explain what stands out.",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        stats: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string", description: "Pre-formatted, e.g. \"$1.2M\"." },
              hint: { type: "string", description: "Small line under the number." },
              tone: {
                type: "string",
                enum: ["accent", "green", "violet", "amber", "red", "dim"],
              },
            },
            required: ["label", "value"],
          },
        },
        note: { type: "string" },
      },
      required: ["stats"],
    },
    run: (args: Record<string, unknown>) => {
      type Stat = { label: string; value: string; hint?: string; tone?: Tone };
      const stats = (Array.isArray(args.stats) ? args.stats : [])
        .map((raw): Stat | null => {
          const item = (raw ?? {}) as Record<string, unknown>;
          const label = asString(item.label);
          const value = asString(item.value);
          if (!label || !value) return null;
          return {
            label,
            value,
            hint: asString(item.hint),
            tone: asString(item.tone) as Tone | undefined,
          };
        })
        .filter((s): s is Stat => s !== null);

      if (!stats.length) throw new Error("render_stats needs at least one {label, value} stat.");

      const viz: Viz = {
        kind: "stats",
        title: asString(args.title),
        note: asString(args.note),
        stats: stats.slice(0, 4),
      };

      return {
        observation: `Stat tiles rendered for the user (${stats.length}). Don't repeat the numbers verbatim — say what they mean.`,
        summary: stats.map((s) => `${s.label} ${s.value}`).join(" · "),
        viz,
      } satisfies ToolOutcome;
    },
  });

  tools.push({
    name: "list_deal_files",
    description:
      "List the files on a deal: the documents the proposal automation generated, and the " +
      "files people uploaded for it to work from. Use it whenever someone asks " +
      "about a deal's proposal, deck, document or attachments — it returns a download URL " +
      "for each file, which you should offer as a markdown link.",
    schema: {
      type: "object",
      properties: {
        dealId: { type: "string", description: "The deal's id." },
      },
      required: ["dealId"],
    },
    run: ({ dealId }: { dealId?: string }) => {
      const deal = requireDeal(asString(dealId));
      const automation = useAutomationStore.getState();

      const generated = automation.artifacts
        .filter((a) => a.dealId === deal.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((a) => ({
          kind: "generated" as const,
          title: a.title || displayName(a.fileName),
          format: a.format,
          created: a.createdAt.slice(0, 10),
          summary: a.summary,
          toFillIn: a.placeholders,
          url: fileUrl(a.fileName),
        }));

      const uploaded = dealInputFiles(automation.files, deal.id).map((f) => ({
        kind: "uploaded" as const,
        title: f.name,
        size: formatBytes(f.size),
        url: fileUrl(f.fileName),
      }));

      const run = runForDeal(automation.runs, deal.id);
      const inFlight = run && effectiveStatus(run) === "running";

      const all = [...generated, ...uploaded];
      if (!all.length) {
        return {
          observation: inFlight
            ? `No files on "${deal.title}" yet — a document is being generated right now. Tell them it's in progress and they'll see it on the deal when it lands.`
            : `No files on "${deal.title}" yet. Someone can generate a proposal from the deal page or the pipeline board, or upload files there.`,
          summary: `${deal.title} — no files`,
          links: [dealLink(deal)].filter(Boolean) as RecordLink[],
        } satisfies ToolOutcome;
      }

      return {
        observation: clip(
          `Files on "${deal.title}"${inFlight ? " (another document is being generated right now)" : ""}:\n` +
            `${JSON.stringify(all)}\n` +
            `Offer each file as a markdown link using its exact url, e.g. [${all[0].title}](${all[0].url}). ` +
            `Never invent a url. "toFillIn" lists bracketed gaps a human still needs to complete — worth mentioning when it isn't empty.`,
        ),
        summary: `${deal.title} — ${plural(generated.length, "document")}, ${plural(uploaded.length, "uploaded file")}`,
        links: [dealLink(deal)].filter(Boolean) as RecordLink[],
        data: all,
      } satisfies ToolOutcome;
    },
  });

  // === automations ==========================================================

  tools.push({
    name: "run_automation",
    description:
      "Start the proposal automation for a deal: a background agent reads the deal's meetings and " +
      "uploaded files and generates a client-ready Word document (docx) or PowerPoint deck (pptx). " +
      "Use it when the user asks you to generate a proposal, deck or document for a deal. The run " +
      "takes a couple of minutes and keeps going after this conversation — the document lands on " +
      "the deal (see list_deal_files) and the user is notified. Needs approval.",
    schema: {
      type: "object",
      properties: {
        dealId: { type: "string", description: "The deal's id." },
        format: {
          type: "string",
          enum: ["docx", "pptx"],
          description:
            "docx for a Word document, pptx for a PowerPoint deck. Omit to use the automation's default.",
        },
        instructions: {
          type: "string",
          description:
            "Anything specific for this run — what to focus on or leave out. Pass the user's own wording.",
        },
      },
      required: ["dealId"],
    },
    run: async (args: Record<string, unknown>) => {
      const deal = requireDeal(asString(args.dealId));
      const automation = useAutomationStore.getState();
      const record = automationRecord(automation.records, AUTOMATION_ID);
      const wanted = asString(args.format);
      const format: ArtifactFormat =
        wanted === "docx" || wanted === "pptx" ? wanted : record.defaultFormat;
      const instructions = asString(args.instructions);

      if (isLocalDev()) {
        return {
          observation:
            "`railcode dev` emulates storage locally but doesn't run managed agents, so the " +
            "automation only works against the deployed app. Tell the user to run it there.",
          summary: "Automations don't run in local dev",
        } satisfies ToolOutcome;
      }

      const current = runForDeal(automation.runs, deal.id);
      if (current && effectiveStatus(current) === "running") {
        return {
          observation:
            `A ${FORMAT_LABEL[current.format]} is already being generated for "${deal.title}". ` +
            `Don't start another — tell the user it's underway and will land on the deal shortly.`,
          summary: `${deal.title} · already generating`,
          links: [dealLink(deal)!],
        } satisfies ToolOutcome;
      }

      const meetings = meetingsForDeal(deal.id).length;
      const inputs = dealInputFiles(automation.files, deal.id).length;
      const template = templateFor(templateFiles(automation.files), format);

      return gate(
        {
          tool: "run_automation",
          title: "Run automation",
          subject: deal.title,
          fields: [
            { label: "Generate", value: `${FORMAT_LABEL[format]} (.${format})` },
            {
              label: "From",
              value: `${plural(meetings, "meeting")}, ${plural(inputs, "uploaded file")}, ${
                template ? `template: ${template.name}` : "no template"
              }`,
            },
            ...(instructions ? [{ label: "Focus", value: instructions }] : []),
            ...(record.enabled
              ? []
              : [
                  {
                    label: "Note",
                    value: "Switched off on the Automations page — this is a one-off run.",
                  },
                ]),
          ],
          destructive: false,
        },
        async () => {
          // runArtifact reports problems through store state rather than throwing,
          // so compare the newest run before and after to learn what happened.
          const beforeId = runForDeal(useAutomationStore.getState().runs, deal.id)?.id;
          await useAutomationStore.getState().runArtifact({
            dealId: deal.id,
            format,
            extraContext: instructions,
          });
          const after = useAutomationStore.getState();
          const run = runForDeal(after.runs, deal.id);
          if (!run || run.id === beforeId || run.status === "failed") {
            const message =
              (run && run.id !== beforeId ? run.error : undefined) ??
              after.error ??
              "The run couldn't start.";
            return {
              observation: `The automation didn't start: ${message}\nDon't retry — explain this to the user.`,
              summary: `${deal.title} · couldn't start`,
              links: [dealLink(deal)!],
            } satisfies ToolOutcome;
          }
          return {
            observation:
              `Started generating a ${FORMAT_LABEL[format]} for "${deal.title}". It takes a couple ` +
              `of minutes and keeps running in the background, even if the user navigates away. The ` +
              `finished document will appear on the deal and in their notifications. Don't wait or ` +
              `poll — tell the user it's underway.`,
            summary: `Generating ${FORMAT_LABEL[format]} · ${deal.title}`,
            links: [dealLink(deal)!],
            data: { runId: run.id, dealId: deal.id, format, startedAt: run.startedAt },
          } satisfies ToolOutcome;
        },
      );
    },
  });

  // The model only ever reads `observation`; the raw outcome stays in the page
  // for the card to render.
  for (const tool of tools) {
    tool.summarize = (result: unknown) =>
      (result as ToolOutcome)?.observation ?? JSON.stringify(result ?? null);
  }

  return tools;
}
