import { describeStreamError } from "./errors";
import { loadSchema } from "./schema";
import { buildTools, toUiStep } from "./tools";
import type { Attachment, Message, Prefs, ToolName, ToolStep } from "./types";

/** The agent loop.
 *
 *  `llm.stream({ tools })` runs the whole loop inside the SDK: the model plans,
 *  the SDK validates each call's args against the tool's schema, runs it here in
 *  the page with the app's own SDK authority, feeds the summarized result back,
 *  and repeats until the model writes its answer. Text streams live throughout —
 *  including any preamble before a tool call — so tool use and token-by-token
 *  output come from one generation rather than a plan/answer split.
 *
 *  What stays the app's job: the system prompt, the tool definitions in
 *  `lib/tools.ts`, and the display/observation split those tools encode.
 *
 *  No new authority is involved. The model can only reach what a `run` function
 *  wires up, every turn rides the same audited `/_api` calls the app already
 *  makes, and `run`/`summarize` never cross the wire. */

const LIMITS: LlmRunLimits = {
  /** Planning turns. Enough for query → refine → answer, short enough that a
   *  confused model fails fast instead of burning the org's token budget. */
  maxSteps: 6,
  maxToolCalls: 12,
  timeoutMs: 120_000,
};

function systemPrompt(
  orgName: string,
  userName: string,
  hasTools: boolean,
  hasPostgres: boolean,
  schemaDigest: string,
): string {
  const parts = [
    `You are a data analyst assistant for ${orgName}, answering ${userName}.`,
    "",
    hasTools
      ? "Use the tools to ground your answer in real data, then explain what you found."
      : "No data sources are enabled, so answer directly from your own knowledge and say plainly that you could not query anything.",
  ];

  if (hasPostgres) {
    parts.push("", "Postgres schema (use fully-qualified schema.table names):", schemaDigest);
  }

  if (hasTools) {
    parts.push(
      "",
      "Rules:",
      "- Answer from data you have already retrieved whenever possible; stop querying as soon as you can answer.",
      "- Never re-run a query identical to one you already ran.",
      "- If a tool returns an error, either fix the query and try once more, or explain what failed.",
      "- Views like open_sla_risk, customer_health_snapshot, agent_workload and channel_performance are pre-joined; prefer them over hand-rolling the joins.",
    );
  }

  parts.push(
    "",
    "Writing the answer:",
    "- Lead with the direct answer, then support it.",
    "- Use markdown: short paragraphs, bullets, and tables where they help.",
    "- Quote concrete numbers from the results. Never invent data.",
    "- The user already sees every query and its full result table in the UI, so summarise and interpret rather than re-printing large tables.",
    "- If the data was insufficient or a tool failed, say so plainly and suggest what would help.",
    "- Be concise. No preamble like 'Certainly!'.",
  );

  return parts.join("\n");
}

/** Attachment text is inlined into the user turn — the LLM gateway is text-only,
 *  so an image can be referenced by name but not actually seen by the model. */
function renderQuestion(question: string, attachments: Attachment[]): string {
  if (attachments.length === 0) return question;
  const described = attachments.map((att) => {
    if (att.excerpt) {
      return `--- attached file: ${att.name} (${att.contentType}) ---\n${att.excerpt}`;
    }
    return `--- attached file: ${att.name} (${att.contentType}, ${att.size} bytes) — binary, contents not readable ---`;
  });
  return `${question}\n\n${described.join("\n\n")}`;
}

function toTranscript(history: Message[]): LlmMessage[] {
  return history
    .filter((m) => m.content.trim() || m.attachments.length > 0)
    .map((m) => ({
      role: m.role,
      content: renderQuestion(m.content, m.attachments),
    }));
}

/** A run that hit a bound can come back with empty or half-written text, so the
 *  UI has to say why rather than render a blank turn. `aborted` is the user's
 *  own stop button and is reported by the store, not here. */
export function stopReasonNote(
  stopReason: LlmStopReason | null,
  hasContent: boolean,
): string | null {
  switch (stopReason) {
    case "max_steps":
    case "max_tool_calls":
      return hasContent
        ? "Stopped after the step limit — this answer may be incomplete."
        : "Hit the step limit before reaching an answer. Try narrowing the question.";
    case "timeout":
      return hasContent
        ? "Timed out mid-answer — what's above may be incomplete."
        : "The run timed out before producing an answer.";
    default:
      return null;
  }
}

export type AgentRun = {
  content: string;
  steps: ToolStep[];
  usage: LlmUsage | null;
  model: string | null;
  stopReason: LlmStopReason | null;
};

export type AgentCallbacks = {
  /** Fired twice per tool call — status "running", then "ok"/"error", same
   *  `step.id` — so the store upserts by id and the card animates in place. */
  onStep: (step: ToolStep) => void;
  onDelta: (text: string) => void;
};

export async function runAgent(
  params: {
    history: Message[];
    question: string;
    attachments: Attachment[];
    prefs: Prefs;
    orgName: string;
    userName: string;
    /** Cancels the run. Aborting resolves normally with `stopReason: "aborted"`,
     *  so the caller branches on stopReason rather than catching. */
    signal: AbortSignal;
  },
  callbacks: AgentCallbacks,
): Promise<AgentRun> {
  const { history, question, attachments, prefs, orgName, userName, signal } = params;

  const enabled: ToolName[] = [];
  if (prefs.sources.postgres) enabled.push("query_postgres");
  if (prefs.sources.posthog) enabled.push("posthog_query", "posthog_api");

  // Only introspect when a SQL tool is actually on — an org with PostHog alone
  // shouldn't fail to chat because no Postgres connection exists.
  const hasPostgres = enabled.includes("query_postgres");
  let connection = "";
  let schemaDigest = "";
  if (hasPostgres) {
    const info = await loadSchema();
    connection = info.connection;
    schemaDigest = info.digest;
  }

  const transcript: LlmMessage[] = [
    ...toTranscript(history),
    { role: "user", content: renderQuestion(question, attachments) },
  ];

  // Insertion-ordered so the transcript renders cards in execution order; the
  // second event for a call overwrites the first in place.
  const steps = new Map<string, ToolStep>();
  let content = "";
  let usage: LlmUsage | null = null;
  let model: string | null = prefs.model;
  let stopReason: LlmStopReason | null = null;

  // With no sources enabled there is nothing to call. An empty `tools` array
  // makes the SDK fall through to a plain streamed turn, so this stays a normal
  // chat rather than an error.
  const tools = buildTools(enabled, connection);

  const stream = llm.stream(transcript, {
    ...(prefs.model ? { model: prefs.model } : {}),
    system: systemPrompt(orgName, userName, tools.length > 0, hasPostgres, schemaDigest),
    tools,
    limits: LIMITS,
    signal,
    maxOutputTokens: 2000,
    metadata: { feature: "chat", app: "chat" },
  });

  // The model may write a preamble before calling a tool ("Let me check the
  // ticket table…") and the answer on a later turn. Both arrive as plain `text`
  // events, so without a break at the turn boundary they concatenate into one
  // run-on sentence. Insert it lazily — only once text actually resumes — so a
  // run that ends on a tool call doesn't leave trailing blank lines.
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
      const step = toUiStep(event.step);
      steps.set(step.id, step);
      callbacks.onStep(step);
      if (content) pendingBreak = true;
    } else if (event.type === "done") {
      usage = event.usage;
      model = event.model;
      stopReason = event.stopReason ?? null;
      // `done.text` is the finished run's answer; the accumulated stream is what
      // the user actually watched arrive. Prefer what was displayed so saving
      // never rewrites the message, and fall back for runs that ended before
      // anything streamed.
      if (!content.trim() && event.text) content = event.text;
    } else if (event.type === "error") {
      throw new Error(describeStreamError(event));
    }
  }

  return { content, steps: [...steps.values()], usage, model, stopReason };
}

/** A cheap, separate call so the sidebar shows something better than the first
 *  40 characters of the question. Failure is non-fatal — the caller keeps the
 *  fallback title. */
export async function generateTitle(question: string, model: string | null): Promise<string> {
  const result = await llm.generate(
    `Write a title of at most 6 words for a chat that starts with this question. Reply with the title only, no quotes or trailing period.\n\n${question}`,
    {
      ...(model ? { model } : {}),
      temperature: 0,
      maxOutputTokens: 24,
      metadata: { feature: "chat-title", app: "chat" },
    },
  );
  return result.text.trim().replace(/^["']|["']$/g, "").slice(0, 60);
}
