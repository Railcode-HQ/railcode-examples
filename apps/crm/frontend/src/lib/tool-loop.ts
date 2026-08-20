// The in-page tool-calling loop behind `llm.generate({ tools })` / `llm.stream({
// tools })` when the tools carry `run` handlers.
//
// VENDORED into the app on purpose. On apps v2 the SDK's own loop runs inside the
// worker, and this app's write tools cannot: they pause for a human approval card
// and close over live browser state, and a worker invocation is one request with no
// inbound channel for an Approve click. So the loop lives here, in the page, and
// only each planning TURN crosses to the worker (see lib/railcode.ts).
//
// It adds no authority. Every tool executes in the page against the same worker
// routes the rest of the app uses, and every LLM turn resolves through the worker's
// audited platform calls.
//
// `generate` plans through non-streaming turns: the planning turn that discovers "the
// model is done" already contains the final answer, so there is nothing extra to
// fetch. `stream` plans through streaming turns instead — one generation per answer:
// text streams live as the model writes it (including any preamble before it asks for
// tools), while tool calls are reassembled server-side and delivered complete on the
// wire `done` event. The turn that ends the loop is the same turn whose streamed text
// is the final answer — never a discard-and-regenerate second call. Structured output
// stays a final tool-free `generate({ output })` after the loop (streaming can't
// carry JSON output).
//
// The app LLM surface carries plain system/user/assistant messages only (no native
// tool-call/tool-result roles), so each round's decision and observations are
// threaded back into the transcript as text — the model re-reads them, with the tool
// schemas re-attached, every planning turn.

import type {
  LlmMessage,
  LlmOptions,
  LlmResult,
  LlmRunLimits,
  LlmStopReason,
  LlmStreamEvent,
  LlmTool,
  LlmToolCall,
  LlmToolStep,
  LlmUsage,
} from "@/lib/railcode";

// The model sees at most this many chars of a tool result: a huge table can still
// render in the UI via the raw `step.result` while the model's context stays bounded.
export const OBSERVATION_CHARS = 6000;

const DEFAULT_LIMITS: Required<LlmRunLimits> = {
  maxSteps: 8,
  maxToolCalls: 30,
  timeoutMs: 120_000,
};

/** Thrown by `llm.generate()` when a tool-loop run fails (an LLM turn erroring —
 * never a misbehaving tool, whose failure is fed back to the model instead). */
export class LlmRunError extends Error {
  /** The planning turn the failure happened on (1-based), if known. */
  step: number | null;
  cause: unknown;
  constructor(message: string, step: number | null, cause: unknown) {
    super(message);
    this.name = "LlmRunError";
    this.step = step;
    this.cause = cause;
  }
}

// The raw wire runners from llm.ts (fetch + parse, no dispatch, no tracking) — the
// loop must not re-enter the public generate/stream, whose tool dispatch would
// recurse and whose track() wrapper would double-count every turn.
export interface WireRunners {
  generate(input: LlmMessage[], opts: LlmOptions): Promise<LlmResult>;
  stream(input: LlmMessage[], opts: LlmOptions): AsyncIterable<LlmStreamEvent>;
}

const now = (): number =>
  typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

const toMessages = (input: string | LlmMessage[]): LlmMessage[] =>
  typeof input === "string" ? [{ role: "user", content: input }] : input.map((m) => ({ ...m }));

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);

function clip(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}… (${text.length - n} more chars)` : text;
}

function defaultStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    const s = JSON.stringify(value);
    return s === undefined ? String(value) : s;
  } catch {
    return String(value);
  }
}

function summarizeResult(tool: LlmTool, raw: unknown): string {
  if (tool.summarize) {
    try {
      return clip(String(tool.summarize(raw)), OBSERVATION_CHARS);
    } catch {
      // A broken summarize must not sink the loop — fall back to the default.
    }
  }
  return clip(defaultStringify(raw), OBSERVATION_CHARS);
}

// ── minimal JSON-Schema arg validation ───────────────────────────────────────
//
// Enough to catch the arg mistakes a model actually makes (missing required key,
// wrong scalar type, bad enum) BEFORE `run` — the failure is fed back so the model
// self-corrects. Deliberately shallow: it guards the tool boundary, it is not a full
// JSON Schema implementation.

const JS_TYPE_OK: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && !Number.isNaN(v),
  integer: (v) => typeof v === "number" && Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  null: (v) => v === null,
};

function typeMatches(type: unknown, value: unknown): boolean {
  const allowed = Array.isArray(type) ? type : [type];
  return allowed.some((t) => typeof t === "string" && JS_TYPE_OK[t]?.(value));
}

function validateArgs(schema: Record<string, unknown> | undefined, args: unknown): string | null {
  if (!schema || typeof schema !== "object") return null;
  if (schema.type && schema.type !== "object") {
    return typeMatches(schema.type, args) ? null : `arguments must be of type ${schema.type}`;
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return "arguments must be an object";
  }
  const obj = args as Record<string, unknown>;
  for (const key of (schema.required as string[] | undefined) ?? []) {
    if (!(key in obj)) return `missing required property "${key}"`;
  }
  const props = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
  for (const [key, spec] of Object.entries(props)) {
    if (!(key in obj) || spec == null) continue;
    const value = obj[key];
    if (spec.type && !typeMatches(spec.type, value)) {
      return `property "${key}" must be of type ${JSON.stringify(spec.type)}`;
    }
    if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
      return `property "${key}" must be one of ${JSON.stringify(spec.enum)}`;
    }
  }
  return null;
}

// ── transcript threading ─────────────────────────────────────────────────────

function assistantTurn(text: string, calls: LlmToolCall[]): LlmMessage {
  const decided = calls.map((c) => `${c.name}(${defaultStringify(c.arguments)})`).join(", ");
  const content = text ? `${text}\n\n[calling tools: ${decided}]` : `[calling tools: ${decided}]`;
  return { role: "assistant", content };
}

function observationTurn(lines: string[]): LlmMessage {
  return { role: "user", content: `Tool results:\n${lines.join("\n")}` };
}

// ── multi-turn accounting ────────────────────────────────────────────────────

class RunLedger {
  usage: LlmUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  model = "";
  provider = "";
  finishReason: string | null = null;
  requestId = "";
  private costSum = 0;
  private costSeen = false;
  private costMissing = false;

  turn(t: {
    usage: LlmUsage;
    model: string;
    provider?: string;
    finishReason?: string | null;
    requestId?: string;
    cost?: string | null;
  }): void {
    this.usage.inputTokens += t.usage.inputTokens;
    this.usage.outputTokens += t.usage.outputTokens;
    this.usage.totalTokens += t.usage.totalTokens;
    if (t.model) this.model = t.model;
    if (t.provider) this.provider = t.provider;
    if (t.finishReason !== undefined) this.finishReason = t.finishReason;
    if (t.requestId) this.requestId = t.requestId;
    const parsed = t.cost == null ? NaN : Number(t.cost);
    if (Number.isFinite(parsed)) {
      this.costSum += parsed;
      this.costSeen = true;
    } else {
      this.costMissing = true;
    }
  }

  /** Sum of per-turn costs; null unless every turn reported one. */
  get cost(): string | null {
    if (!this.costSeen || this.costMissing) return null;
    // Provider costs are tiny decimals; 10 places keeps them exact enough while
    // trimming float noise from the sum.
    return this.costSum.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  }
}

// ── the loop ─────────────────────────────────────────────────────────────────

const toDefs = (tools: LlmTool[]): Pick<LlmTool, "name" | "description" | "schema">[] =>
  tools.map((t) => ({ name: t.name, description: t.description, schema: t.schema }));

async function* engine(
  input: string | LlmMessage[],
  opts: LlmOptions,
  wire: WireRunners,
  streamFinal: boolean,
): AsyncGenerator<LlmStreamEvent, void> {
  const tools = opts.tools ?? [];
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const toolDefs = toDefs(tools);
  const limits: Required<LlmRunLimits> = { ...DEFAULT_LIMITS, ...opts.limits };
  const { system: baseSystem, model, provider, output, maxOutputTokens, metadata } = opts;

  const messages = toMessages(input);
  const steps: LlmToolStep[] = [];
  const ledger = new RunLedger();
  if (model) ledger.model = model;
  let toolExecs = 0;
  let turn = 0;
  let finalText = "";
  let finalOutput: unknown | null = null;
  let hasStructuredOutput = false;
  let stopReason: LlmStopReason = "end";

  // Cancellation: one internal controller aborted by either the external signal or
  // the timeout. It is handed to every wire call (tearing down in-flight HTTP) and to
  // every tool's ctx; the loop itself settles at step/chunk boundaries.
  const controller = new AbortController();
  let abortReason: "aborted" | "timeout" = "aborted";
  const onExternalAbort = () => {
    abortReason = "aborted";
    controller.abort();
  };
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => {
    abortReason = "timeout";
    controller.abort();
  }, limits.timeoutMs);
  const signal = controller.signal;

  const budgetSystem = (): string | undefined => {
    if (!limits.maxSteps) return baseSystem;
    const line = `You have used ${turn} of ${limits.maxSteps} tool steps.`;
    return baseSystem ? `${baseSystem}\n\n${line}` : line;
  };

  // One planning turn. In stream mode its text streams live (each wire text event
  // re-yielded); either way it returns the completed turn's text and tool calls.
  // An abort mid-turn is a graceful cancel — the wire fetch throws on teardown, which
  // we swallow so the loop settles to `stopReason: aborted` instead of erroring.
  type PlanResult = { text: string; toolCalls: LlmToolCall[] };
  async function* planTurn(system: string | undefined): AsyncGenerator<LlmStreamEvent, PlanResult> {
    const turnOpts: LlmOptions = {
      system,
      tools: toolDefs,
      model,
      provider,
      maxOutputTokens,
      metadata,
      signal,
    };
    if (!streamFinal) {
      try {
        const result = await wire.generate(messages, turnOpts);
        ledger.turn(result);
        return { text: result.text, toolCalls: result.toolCalls ?? [] };
      } catch (err) {
        if (signal.aborted) return { text: "", toolCalls: [] };
        throw err;
      }
    }
    let turnText = "";
    let toolCalls: LlmToolCall[] = [];
    try {
      for await (const event of wire.stream(messages, turnOpts)) {
        if (signal.aborted) break;
        if (event.type === "text") {
          turnText += event.text;
          yield { type: "text", text: event.text };
        } else if (event.type === "done") {
          ledger.turn(event);
          toolCalls = event.toolCalls ?? [];
        } else if (event.type === "error") {
          throw new LlmRunError(event.message, turn, event);
        }
      }
    } catch (err) {
      if (!signal.aborted) throw err;
    }
    return { text: turnText, toolCalls };
  }

  try {
    planning: while (true) {
      if (signal.aborted) {
        stopReason = abortReason;
        break;
      }
      if (turn >= limits.maxSteps) {
        stopReason = "max_steps";
        break;
      }
      // `turn` counts completed planning turns, so the budget line reads "used N"
      // before this turn runs; increment to this turn's 1-based number afterwards.
      const system = budgetSystem();
      turn += 1;

      const result = yield* planTurn(system);

      if (signal.aborted) {
        // Cancelled mid-turn: the streamed-so-far text is the answer we have.
        finalText = result.text;
        stopReason = abortReason;
        break;
      }

      if (result.toolCalls.length === 0) {
        finalText = result.text;
        stopReason = "end";
        break;
      }

      messages.push(assistantTurn(result.text, result.toolCalls));
      const observations: string[] = [];
      for (const call of result.toolCalls) {
        if (signal.aborted) {
          messages.push(observationTurn(observations.length ? observations : ["(cancelled)"]));
          stopReason = abortReason;
          break planning;
        }
        if (toolExecs >= limits.maxToolCalls) {
          observations.push(`- ${call.name}: skipped (tool-call budget exhausted)`);
          stopReason = "max_tool_calls";
          continue;
        }
        toolExecs += 1;
        const step: LlmToolStep = {
          id: call.id || `step_${toolExecs}`,
          index: toolExecs,
          tool: call.name,
          args: call.arguments,
          status: "running",
          result: null,
          error: null,
          ms: null,
        };
        steps.push(step);
        yield { type: "step", step: { ...step } };

        const started = now();
        let observation: string;
        const tool = toolsByName.get(call.name);
        if (!tool) {
          step.status = "error";
          step.error = `Unknown tool "${call.name}"`;
          observation = step.error;
        } else {
          const invalid = validateArgs(tool.schema, call.arguments);
          if (invalid) {
            step.status = "error";
            step.error = invalid;
            observation = `Invalid arguments: ${invalid}`;
          } else {
            try {
              const raw = await tool.run!(call.arguments, { signal, step: turn });
              step.status = "ok";
              step.result = raw;
              observation = summarizeResult(tool, raw);
            } catch (err) {
              step.status = "error";
              step.error = errMessage(err);
              observation = `Error: ${step.error}`;
            }
          }
        }
        step.ms = Math.round(now() - started);
        observations.push(`- ${call.name} [${step.id}]: ${observation}`);
        yield { type: "step", step: { ...step } };
      }
      messages.push(observationTurn(observations));
      if (stopReason === "max_tool_calls") break;
    }

    if (output && output.type === "json" && stopReason === "end" && !hasStructuredOutput) {
      // Function/tool calling and structured JSON both use provider tool surfaces
      // under the hood, so keep them as separate turns: first decide and observe
      // tools, then ask for the final schema-constrained answer without tools.
      const result = await wire.generate(messages, {
        system: baseSystem,
        output,
        model,
        provider,
        maxOutputTokens,
        metadata,
        signal,
      });
      ledger.turn(result);
      finalText = result.text;
      finalOutput = result.output;
      hasStructuredOutput = true;
      if (streamFinal && finalText) yield { type: "text", text: finalText };
    }
    // No discard-and-regenerate final turn: in stream mode the planning turn that
    // ended the loop already streamed its text, and that text IS `finalText`.

    if (finalText) messages.push({ role: "assistant", content: finalText });
    yield {
      type: "done",
      usage: ledger.usage,
      cost: ledger.cost,
      provider: ledger.provider,
      model: ledger.model,
      finishReason: ledger.finishReason,
      requestId: ledger.requestId,
      text: finalText,
      output: hasStructuredOutput ? finalOutput : null,
      steps,
      messages,
      stopReason,
    };
  } catch (err) {
    const cause = err instanceof LlmRunError ? err.cause : err;
    const wireError =
      cause && typeof cause === "object" && "error" in cause
        ? (cause as { error?: unknown; retryable?: boolean; requestId?: string })
        : undefined;
    yield {
      type: "error",
      error: typeof wireError?.error === "string" ? wireError.error : "tool_loop_error",
      message: errMessage(err),
      ...(wireError?.retryable !== undefined ? { retryable: wireError.retryable } : {}),
      ...(wireError?.requestId !== undefined ? { requestId: wireError.requestId } : {}),
      step: err instanceof LlmRunError ? err.step : turn,
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** The loop behind `llm.stream({ tools })` with run-bearing tools. */
export function streamToolLoop(
  input: string | LlmMessage[],
  opts: LlmOptions,
  wire: WireRunners,
): AsyncGenerator<LlmStreamEvent, void> {
  return engine(input, opts, wire, true);
}

/** Same event stream as `streamToolLoop`, but every planning turn runs through
 *  the NON-streaming `generate` wire.
 *
 *  Apps v2 note: this SDK build's `/llm/stream` refuses run-less tool defs (the
 *  streamRaw guard), so a browser tool loop can't plan through streaming turns —
 *  it plans through `generate` (which returns `toolCalls` in defs mode) instead.
 *  Trade-off: the assistant's text is not token-streamed; step events + the final
 *  answer still arrive (the answer whole, on the `done` event). */
export function generateToolLoopStream(
  input: string | LlmMessage[],
  opts: LlmOptions,
  wire: WireRunners,
): AsyncGenerator<LlmStreamEvent, void> {
  return engine(input, opts, wire, false);
}

/** The loop behind `llm.generate({ tools })` with run-bearing tools. */
export async function runToolLoop(
  input: string | LlmMessage[],
  opts: LlmOptions,
  wire: WireRunners,
): Promise<LlmResult> {
  for await (const event of engine(input, opts, wire, false)) {
    if (event.type === "done") {
      return {
        text: event.text ?? "",
        output: event.output ?? null,
        toolCalls: [],
        usage: event.usage,
        cost: event.cost,
        provider: event.provider,
        model: event.model,
        finishReason: event.finishReason,
        requestId: event.requestId,
        steps: event.steps,
        messages: event.messages,
        stopReason: event.stopReason,
      };
    }
    if (event.type === "error") {
      throw new LlmRunError(event.message, event.step ?? null, event);
    }
  }
  // Unreachable: the engine always ends with a done or error event.
  throw new LlmRunError("tool loop produced no result", null, null);
}
