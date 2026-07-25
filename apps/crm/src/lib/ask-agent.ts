// The Ask AI agent loop.
//
// `llm.stream({ tools })` runs the whole loop inside the SDK: the model plans,
// the SDK validates each call's args against the tool schema, runs it here in
// the page with the app's own SDK authority, feeds the summarised result back,
// and repeats until the model writes its answer. Text streams throughout —
// including the preamble before a tool call — so tool use and token-by-token
// output come from one generation rather than a plan/answer split.
//
// What stays this file's job: the system prompt, the workspace snapshot that
// makes name→id resolution free, and picking a model.

import { RequestApproval, buildAskTools } from "@/lib/ask-tools";
import {
  Identity,
  LlmMessage,
  LlmProviderInfo,
  LlmStopReason,
  LlmToolStep,
  LlmUsage,
  listLlmProviders,
  llm,
} from "@/lib/railcode";
import { STAGES, formatMoney, gatewayErrorMessage, stage, todayIsoDate } from "@/lib/crm";
import { useCrmStore } from "@/store/crm-store";

const LIMITS = {
  /** Planning turns. Enough for stats → list → render → answer, tight enough
   *  that a confused model fails fast instead of burning the org's tokens. */
  maxSteps: 12,
  maxToolCalls: 30,
  /** Generous because a gated write parks the loop until a person clicks. */
  timeoutMs: 900_000,
};

// --- model selection -------------------------------------------------------

/** Best-first. The agent juggles ~20 tools and multi-step plans, so it's worth
 *  reaching past a small default model when the org has something stronger
 *  configured. */
const MODEL_PREFERENCE = [
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "gpt-5.5",
  "claude-opus-4-5",
];

/** The strongest model this workspace can actually call, or null for the org
 *  default.
 *
 *  Scoped to the default provider on purpose: the catalog lists every provider
 *  an admin has *configured*, and one can appear there without working
 *  credentials — asking for its model gets the whole run rejected. The default
 *  provider is the one the org is known to be able to reach. */
export async function pickModel(): Promise<string | null> {
  const providers: LlmProviderInfo[] = await listLlmProviders();
  const home = providers.find((p) => p.default) ?? (providers.length === 1 ? providers[0] : null);
  if (!home) return null;
  const catalog = home.models.map((m) => m.model);
  for (const wanted of MODEL_PREFERENCE) {
    const match = catalog.find((model) => model.includes(wanted));
    if (match) return match;
  }
  return null;
}

/** Whether a failure looks like "that model isn't callable here" — the one case
 *  worth silently retrying on the org default rather than showing the user. */
export function isModelRejection(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("rejected this model") ||
    text.includes("provider_model_error") ||
    text.includes("model not found") ||
    text.includes("unknown model")
  );
}

/** "anthropic/claude-sonnet-5" → "claude-sonnet-5" for the status line. */
export function shortModelName(model: string | null): string {
  if (!model) return "default model";
  const tail = model.split("/").pop() ?? model;
  return tail.replace(/^global\./, "").replace(/-v\d+:\d+$/, "");
}

// --- workspace snapshot ----------------------------------------------------

const DIGEST_LIMITS = { companies: 60, contacts: 80, deals: 80, notes: 30, actions: 40 };
const DIGEST_MAX_CHARS = 16_000;

/** A compact roster of the workspace, refreshed on every turn and pasted into
 *  the system prompt.
 *
 *  This is the difference between "which deal did you mean?" and a direct
 *  answer: the model can resolve a name to an id without spending a tool call,
 *  and it knows what exists before it proposes creating a duplicate. Anything
 *  past the caps is reachable through the list_* tools, which the prompt says
 *  so explicitly. */
export function workspaceDigest(): string {
  const s = useCrmStore.getState();
  const lines: string[] = [];

  const open = s.deals.filter((d) => !stage(d.stage).terminal);
  const openValue = open.reduce((sum, d) => sum + (d.value ?? 0), 0);
  const byStage = STAGES.map((st) => {
    const list = s.deals.filter((d) => d.stage === st.id);
    return `${st.id}=${list.length}`;
  }).join(" ");

  lines.push(
    `TOTALS: ${s.companies.length} companies, ${s.contacts.length} contacts, ${s.deals.length} deals ` +
      `(${open.length} open worth ${formatMoney(openValue)}), ` +
      `${s.actionItems.filter((a) => !a.done).length} open action items, ` +
      `${s.callNotes.length} call notes.`,
    `DEALS BY STAGE: ${byStage}`,
  );

  const truncNote = (shown: number, total: number, tool: string) =>
    total > shown ? `  … ${total - shown} more — use ${tool}.` : null;

  const companyName = new Map(s.companies.map((c) => [c.id, c.name]));

  lines.push("", `COMPANIES (id | name | domain | industry):`);
  s.companies.slice(0, DIGEST_LIMITS.companies).forEach((c) => {
    lines.push(`  ${c.id} | ${c.name} | ${c.domain ?? "-"} | ${c.industry ?? "-"}`);
  });
  const coNote = truncNote(DIGEST_LIMITS.companies, s.companies.length, "list_companies");
  if (coNote) lines.push(coNote);

  lines.push("", `CONTACTS (id | name | email | title | company):`);
  s.contacts.slice(0, DIGEST_LIMITS.contacts).forEach((c) => {
    lines.push(
      `  ${c.id} | ${c.name} | ${c.email ?? "-"} | ${c.title ?? "-"} | ${
        c.companyId ? companyName.get(c.companyId) ?? "-" : "-"
      }`,
    );
  });
  const ctNote = truncNote(DIGEST_LIMITS.contacts, s.contacts.length, "list_contacts");
  if (ctNote) lines.push(ctNote);

  lines.push("", `DEALS (id | title | stage | value | company):`);
  s.deals
    .slice()
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, DIGEST_LIMITS.deals)
    .forEach((d) => {
      lines.push(
        `  ${d.id} | ${d.title} | ${d.stage} | ${d.value ?? "-"} | ${
          d.companyId ? companyName.get(d.companyId) ?? "-" : "-"
        }`,
      );
    });
  const dlNote = truncNote(DIGEST_LIMITS.deals, s.deals.length, "list_deals");
  if (dlNote) lines.push(dlNote);

  const openActions = s.actionItems.filter((a) => !a.done);
  if (openActions.length) {
    lines.push("", `OPEN ACTION ITEMS (id | title | priority | due | deal):`);
    openActions.slice(0, DIGEST_LIMITS.actions).forEach((a) => {
      const deal = s.deals.find((d) => d.id === a.dealId);
      lines.push(
        `  ${a.id} | ${a.title} | ${a.priority} | ${a.dueDate ?? "-"} | ${deal?.title ?? "-"}`,
      );
    });
    const aiNote = truncNote(DIGEST_LIMITS.actions, openActions.length, "list_action_items");
    if (aiNote) lines.push(aiNote);
  }

  if (s.callNotes.length) {
    const contactName = new Map(s.contacts.map((c) => [c.id, c.name]));
    lines.push("", `RECENT CALL NOTES (id | date | title | people) — bodies via read_call_note:`);
    s.callNotes.slice(0, DIGEST_LIMITS.notes).forEach((n) => {
      const people = (n.contactIds ?? [])
        .map((id) => contactName.get(id))
        .filter(Boolean)
        .join(", ");
      lines.push(`  ${n.id} | ${n.date.slice(0, 10)} | ${n.title} | ${people || "-"}`);
    });
    const cnNote = truncNote(DIGEST_LIMITS.notes, s.callNotes.length, "list_call_notes");
    if (cnNote) lines.push(cnNote);
  }

  const text = lines.join("\n");
  return text.length > DIGEST_MAX_CHARS
    ? `${text.slice(0, DIGEST_MAX_CHARS)}\n… snapshot truncated — use the list_* tools for the rest.`
    : text;
}

// --- prompt ----------------------------------------------------------------

function systemPrompt(identity: Identity | undefined): string {
  const user = identity?.user.name || "the user";
  const org = identity?.org.name || identity?.org.slug || "this workspace";

  return `You are the assistant inside ${org}'s CRM, working with ${user}. Today is ${todayIsoDate()}.

You can answer anything about this workspace and you can change it — the same things ${user} could do by hand in the UI.

HOW ACTIONS WORK
- Read tools run immediately.
- Every write (save_deal, save_company, save_contact, save_action_item, save_call_note, add_activity_note, delete_record, run_automation) pauses and shows ${user} an approval card before anything is saved. Just call the tool — never ask "shall I?" in prose first, the card is the confirmation.
- If a write comes back declined, do not retry it and do not try a different tool to accomplish the same thing. Acknowledge in one line and ask what they'd prefer.
- Take the actions the request implies, in one go. "Add Acme and a $40k deal" is three calls (company, contact, deal), not a question about whether to proceed.

IDS
- The snapshot below carries the id of everything in the workspace. Use those ids directly rather than spending a tool call to look them up.
- To CHANGE an existing record you must pass its id. A save_* call without an id creates a brand new record — that is how duplicates happen.
- Only pass the fields you're actually changing; everything else stays as it is.

VOCABULARY
- Deal stages, in order: new, qualified, demo, closing, won, lost. Won and lost are terminal — "open pipeline" excludes them.
- Action item priorities: p0 (most urgent) to p4. Action items always belong to a deal.
- Call notes are meeting write-ups attached to the people who were on the call. Their bodies are not in the snapshot — read_call_note gets you the full text.

FILES ON DEALS
- A deal's files are one list, flagged by how they got there: documents the proposal automation generated (Word or PowerPoint), and files people uploaded for it to work from. list_deal_files returns both, each with a download url.
- Offer files as markdown links with the exact url the tool gave you — [Acme proposal](…). Never construct or guess a url, and never claim a deal has a document without calling the tool first.
- A generated document can carry "toFillIn" placeholders: bracketed gaps deliberately left for a person. Mention them when there are any — that's the difference between "here's the proposal" and "here's the proposal, it still needs the implementation fee".
- run_automation generates a new document: it starts the proposal automation for a deal, which reads the deal's meetings and uploaded files and writes a Word document or PowerPoint deck in the background. Use it when ${user} asks you to generate a proposal, deck or document. Pass their specific asks ("leave pricing out") as instructions.
- A run takes a couple of minutes and outlives the conversation — after starting one, say it's underway and that the document will land on the deal. Don't poll for it, and don't start a second run for the same deal while one is going.

SHOWING RESULTS
- render_table for any list of records. Give each row a link so it's clickable. Don't also write the rows out in prose.
- render_chart for comparing labelled numbers (pipeline by stage, value by company, deals per month).
- render_stats for two to four headline numbers.
- Call these BEFORE your written answer, then keep the prose to what the visual doesn't say: the takeaway, the outlier, what to do next.
- For a single fact ("how much is the Acme deal?") just answer in a sentence — no table.

STYLE
- Lead with the answer. Be concise and specific; ${user} knows their own pipeline.
- Quote real numbers from tools or the snapshot. Never invent a record, a figure, or a quote from a call.
- Markdown is supported: short paragraphs, bold, bullets. No headings in short answers, no "Certainly!", no restating the question.
- If something isn't in the CRM, say so plainly and suggest the closest thing you can do.

WORKSPACE SNAPSHOT
${workspaceDigest()}`;
}

// --- errors ----------------------------------------------------------------

/** Governed-platform failures are normal states with different fixes, so each
 *  gets a message that names the fix instead of a raw JSON blob. */
function fromCode(code: string | null, detail: string | null): string | null {
  switch (code) {
    case "daily_token_limit_exceeded":
      return "This workspace has hit its daily LLM token limit. It resets tomorrow, or an admin can raise the cap in Railcode.";
    case "provider_auth_error":
      return "The LLM provider rejected its API key. An admin needs to update the provider credentials in Railcode.";
    case "provider_rate_limited":
      return "The model provider is rate-limiting requests. Wait a moment and try again.";
    case "provider_timeout":
      return "The model provider timed out. Try again, or ask something narrower.";
    case "provider_bad_request":
      return detail ? `The model provider rejected the request: ${detail}` : "The model provider rejected the request.";
    default:
      return null;
  }
}

export function describeStreamError(event: { error: string; message: string }): string {
  const raw = event.message ?? event.error;
  return fromCode(event.error, event.message) ?? gatewayErrorMessage(raw) ?? raw;
}

export function describeAskError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? (err as { status?: unknown }).status
      : null;

  let code: string | null = null;
  let detail: string | null = null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const body = (parsed.detail ?? parsed) as Record<string, unknown> | string;
    if (typeof body === "string") detail = body;
    else {
      if (typeof body.error === "string") code = body.error;
      if (typeof body.message === "string") detail = body.message;
    }
  } catch {
    /* not JSON — fall through to the raw text */
  }

  const mapped = fromCode(code, detail);
  if (mapped) return mapped;
  if (status === 403) return "This app isn't authorized to use the LLM. Its manifest may need an admin to ratify it.";
  if (status === 429) return "Rate limit reached. Wait a moment and try again.";
  if (status === 504) return "The request took too long and the gateway gave up (504). Try again shortly.";
  if (status === 503)
    return "The LLM isn't available. If you're running locally, `railcode dev` forwards LLM calls to the real instance — sign in with `railcode login` first.";
  return gatewayErrorMessage(detail ?? raw) ?? detail ?? raw ?? "Something went wrong.";
}

/** A bounded run can return empty or half-written text, so the turn has to say
 *  why rather than render a blank answer. */
export function stopReasonNote(
  stopReason: LlmStopReason | null,
  hasContent: boolean,
): string | null {
  switch (stopReason) {
    case "max_steps":
    case "max_tool_calls":
      return hasContent
        ? "Stopped at the step limit — this answer may be incomplete."
        : "Hit the step limit before reaching an answer. Try narrowing the question.";
    case "timeout":
      return hasContent ? "Timed out mid-answer." : "The run timed out before producing an answer.";
    default:
      return null;
  }
}

// --- run -------------------------------------------------------------------

export type AskRun = {
  content: string;
  steps: LlmToolStep[];
  /** The full transcript incl. threaded tool turns — feeds the next question. */
  messages: LlmMessage[];
  usage: LlmUsage | null;
  model: string | null;
  stopReason: LlmStopReason | null;
};

export type AskCallbacks = {
  onDelta: (text: string) => void;
  /** Fired twice per tool call — "running", then settled — with the same
   *  `step.id`, so the caller upserts and the card animates in place. */
  onStep: (step: LlmToolStep) => void;
};

export async function runAsk(
  params: {
    /** Prior turns, including the tool turns the SDK threaded in. */
    history: LlmMessage[];
    question: string;
    model: string | null;
    identity?: Identity;
    signal: AbortSignal;
    requestApproval: RequestApproval;
  },
  callbacks: AskCallbacks,
): Promise<AskRun> {
  const transcript: LlmMessage[] = [
    ...params.history,
    { role: "user", content: params.question },
  ];

  const steps = new Map<string, LlmToolStep>();
  let content = "";
  let usage: LlmUsage | null = null;
  let model: string | null = params.model;
  let stopReason: LlmStopReason | null = null;
  let messages: LlmMessage[] = transcript;

  const stream = llm.stream(transcript, {
    ...(params.model ? { model: params.model } : {}),
    system: systemPrompt(params.identity),
    tools: buildAskTools(params.requestApproval),
    limits: LIMITS,
    signal: params.signal,
    maxOutputTokens: 2400,
    metadata: { feature: "ask-ai", app: "crm" },
  });

  // The model often writes a line before calling a tool and the answer after
  // it. Both arrive as plain text events, so without a break at the turn
  // boundary they run together into one sentence. Inserted lazily, so a turn
  // that ends on a tool call doesn't leave trailing blank lines.
  let pendingBreak = false;

  for await (const event of stream) {
    if (event.type === "text") {
      let text = event.text;
      if (pendingBreak) {
        pendingBreak = false;
        if (content && !content.endsWith("\n\n")) {
          text = (content.endsWith("\n") ? "\n" : "\n\n") + text;
        }
      }
      content += text;
      callbacks.onDelta(text);
    } else if (event.type === "step") {
      steps.set(event.step.id, event.step);
      callbacks.onStep(event.step);
      if (content) pendingBreak = true;
    } else if (event.type === "done") {
      usage = event.usage ?? null;
      model = event.model ?? model;
      stopReason = event.stopReason ?? null;
      if (event.messages?.length) messages = event.messages;
      // `done.text` is the finished run's answer; the accumulated stream is what
      // the user actually watched arrive. Prefer what was displayed.
      if (!content.trim() && event.text) content = event.text;
    } else if (event.type === "error") {
      throw new Error(describeStreamError(event));
    }
  }

  return { content, steps: [...steps.values()], messages, usage, model, stopReason };
}
