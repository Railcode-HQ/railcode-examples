import { runToolLoop, streamToolLoop, type WireRunners } from "@/lib/tool-loop";

// The app's ONE seam onto the platform.
//
// On v1 this file reached for SDK globals that `/_api/sdk.js` hung off `window`.
// On v2 there is no browser SDK and the browser has no credentials, so every
// function below `fetch()`es a worker route instead. The exported signatures are
// unchanged, which is why nothing else in the app had to move: views, stores,
// the CRM logic and the Ask AI loop all compile and run exactly as before.
//
// That is the whole migration trick — rewrite the wrapper, keep its shape.

export type IdentityRole = {
  uuid: string;
  name: string;
};

/** The verified caller. v2 identity is `ctx.user` and nothing else — there is no
 *  app record and no org record, so anything that displayed the workspace name
 *  now shows the person instead. */
export type IdentityUser = {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
  roles: IdentityRole[];
};

export type Identity = {
  user: IdentityUser;
};

export type KvRow<T = unknown> = {
  key: string;
  value: T;
  updated_at?: string;
};

export type Collection<T = unknown> = {
  get(key: string): Promise<T | null>;
  put(key: string, value: T): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(): Promise<KvRow<T>[]>;
};

export type FileEntry = {
  name: string;
  content_type?: string;
  size?: number;
  updated_at?: string;
};

export type PersonalConnectionStatus = {
  uuid: string;
  toolkit: string;
  status: string;
  created_at?: string;
  updated_at?: string;
};

export type PersonalConnectionCall = {
  result: unknown;
};

export type LlmMessage = {
  /** The loop threads tool turns back as plain text, so the wire transcript can
   *  carry roles the app never writes itself. */
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

/** Passed to a tool's `run` while the loop drives it. */
export type LlmToolContext = {
  /** Aborts when the run is cancelled or times out — honor it in long tools. */
  signal: AbortSignal;
  /** The planning turn (1-based) this tool call belongs to. */
  step: number;
  version?: number;
};

/** One tool handed to `llm.generate()` / `llm.stream()`. With `run`, the loop
 *  executes the tool and continues until the model answers: the raw return value
 *  reaches the UI as `step.result`, while the model sees only `summarize(result)`.
 *  Only `{ name, description, schema }` crosses the wire. */
export type LlmTool<TArgs = any> = {
  name: string;
  description: string;
  schema?: Record<string, unknown>;
  run?(args: TArgs, ctx: LlmToolContext): Promise<unknown> | unknown;
  summarize?(result: unknown): string;
};

export type LlmToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/** One executed tool call. Emitted twice on the stream path (running, then
 *  settled) with the same `id` — upsert, don't append. */
export type LlmToolStep = {
  id: string;
  index: number;
  tool: string;
  args: unknown;
  status: "running" | "ok" | "error";
  result: unknown | null;
  error: string | null;
  ms: number | null;
};

export type LlmRunLimits = {
  maxSteps?: number;
  maxToolCalls?: number;
  timeoutMs?: number;
};

export type LlmStopReason = "end" | "max_steps" | "max_tool_calls" | "timeout" | "aborted";

export type LlmOptions = {
  model?: string;
  provider?: string;
  system?: string;
  output?: { type: "text" | "json"; schema?: Record<string, unknown> };
  tools?: LlmTool[];
  limits?: LlmRunLimits;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type LlmResult = {
  text: string;
  output: unknown | null;
  toolCalls?: LlmToolCall[];
  usage: LlmUsage;
  cost: string | null;
  provider: string;
  model: string;
  finishReason: string | null;
  requestId: string;
  steps?: LlmToolStep[];
  messages?: LlmMessage[];
  stopReason?: LlmStopReason;
};

export type LlmStreamEvent =
  | { type: "text"; text: string }
  | { type: "step"; step: LlmToolStep }
  | {
      type: "done";
      usage: LlmUsage;
      cost: string | null;
      provider: string;
      model: string;
      finishReason: string | null;
      requestId: string;
      toolCalls?: LlmToolCall[];
      text?: string;
      output?: unknown | null;
      steps?: LlmToolStep[];
      messages?: LlmMessage[];
      stopReason?: LlmStopReason;
    }
  | {
      type: "error";
      error: string;
      message: string;
      retryable?: boolean;
      requestId?: string;
      step?: number | null;
    };

export type LlmModelInfo = { model: string; default: boolean };
export type LlmProviderInfo = {
  provider: string;
  default: boolean;
  models: LlmModelInfo[];
};

// ── transport ─────────────────────────────────────────────────────────────

/** Mirrors the SDK's ApiError so callers can branch on `.status` and parse the
 *  data-plane error body out of `.message` exactly as they did in v1. */

export type AgentRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "limit_exceeded"
  | (string & {});

export type AgentRun = {
  /** snake_case on the wire; this is what `agents.get` polls with. */
  request_id: string;
  status: AgentRunStatus;
  /** Note: output_json, not "output". */
  output_json?: unknown;
  /** The failure reason lives in these two. There is no `error` field — reading
   *  one yields undefined and throws away the only useful diagnostic. */
  error_code?: string | null;
  error_message?: string | null;
  input_json?: unknown;
  started_at?: string;
  finished_at?: string | null;
};


// ── the wire ─────────────────────────────────────────────────────────────────

/** Mirrors the SDK's ApiError so callers branch on `.status` and read the
 *  platform's error body out of `.message` exactly as they did on v1. The worker
 *  relays both verbatim, so the extra hop is invisible to error handling. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  return resp.status === 204 ? (undefined as T) : ((await resp.json()) as T);
}

// ── identity ─────────────────────────────────────────────────────────────────

export async function getIdentity(): Promise<Identity> {
  const resp = await fetch("/api/rc/me", { headers: { accept: "application/json" } });
  if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  return (await resp.json()) as Identity;
}

// ── kv store ─────────────────────────────────────────────────────────────────

/** The workspace's shared records: companies, contacts, deals, activity. */
export function collection<T = unknown>(name: string): Collection<T> {
  return kv<T>(name, false);
}

/** Records that belong to ONE person — read notification state, here.
 *
 *  v1 had `db.user`, a private per-caller namespace the server enforced. A v2
 *  app has one flat store shared by the whole org, so "private" is now the
 *  worker's doing: it prefixes the key with the verified caller's id and refuses
 *  to serve a record whose owner is someone else. Same signature, same calls,
 *  the guarantee rebuilt one layer down (see server/index.ts). */
export function userCollection<T = unknown>(name: string): Collection<T> {
  return kv<T>(name, true);
}

function kv<T>(name: string, mine: boolean): Collection<T> {
  const call = <R>(op: string, extra: Record<string, unknown> = {}) =>
    apiJson<R>("/api/rc/kv", { collection: name, op, mine, ...extra });
  return {
    async get(key: string) {
      const { value } = await call<{ value: T | null }>("get", { key });
      return value;
    },
    async put(key: string, value: T) {
      const res = await call<{ value: T }>("put", { key, value });
      return res.value;
    },
    delete(key: string) {
      return call<{ ok: true }>("delete", { key });
    },
    async list() {
      const { items } = await call<{ items: KvRow<T>[] }>("list");
      return items;
    },
  };
}

// ── files ────────────────────────────────────────────────────────────────────

export const fileStore = {
  async upload(name: string, blob: Blob, type?: string): Promise<void> {
    const resp = await fetch(`/api/rc/files?name=${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "content-type": type || blob.type || "application/octet-stream" },
      body: blob,
    });
    if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  },
  /** v1 returned a signed URL string; the worker streams the bytes instead, so
   *  this is a plain same-origin path. Same call site, and it works whatever the
   *  instance's storage backend is (signed URLs need S3). */
  url(name: string): string {
    return `/api/rc/files/${name.split("/").map(encodeURIComponent).join("/")}`;
  },
  async list(): Promise<FileEntry[]> {
    return apiJson<FileEntry[]>("/api/rc/files/list", {});
  },
  delete(name: string): Promise<unknown> {
    return apiJson("/api/rc/files/delete", { name });
  },
};

// ── managed agents ───────────────────────────────────────────────────────────

/** Managed agents this app's manifest declares. A generate run takes minutes, so
 *  the app always uses `start` + poll — and on v2 that is not merely preferable
 *  but required: a worker invocation is ONE request with a finite subrequest
 *  budget and a token that expires, so it cannot hold a run open. */
const AGENT_TERMINAL = ["success", "failed", "cancelled", "limit_exceeded"];

export const agents = {
  start(name: string, input?: unknown): Promise<AgentRun> {
    return apiJson<AgentRun>("/api/rc/agent", { op: "start", name, input });
  },
  get(requestId: string): Promise<AgentRun> {
    return apiJson<AgentRun>("/api/rc/agent", { op: "get", requestId });
  },

  /** Start a run and resolve with the finished one.
   *
   *  The polling moved into the BROWSER. The SDK does offer `agents.invoke()`,
   *  but it spends one of the invocation's subrequests per poll and throws at a
   *  60-second deadline, so a worker route wrapping it would time out on a run
   *  the model spends minutes on. The page has no such budget: it can wait, and
   *  it keeps waiting across a slow run without holding anything open server-side.
   *
   *  Callers that must survive a closed tab should use `start` and persist the
   *  request_id instead — which is what the generate flow does. */
  async invoke(name: string, input?: unknown, pollMs = 3000): Promise<AgentRun> {
    let run = await agents.start(name, input);
    while (!AGENT_TERMINAL.includes(run.status)) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      run = await agents.get(run.request_id);
    }
    return run;
  },
};

// ── personal connectors ──────────────────────────────────────────────────────

export const personalConnections = {
  list() {
    return apiJson<PersonalConnectionStatus[]>("/api/rc/pc", { op: "list" });
  },
  connect(toolkit: string) {
    return apiJson<{ redirect_url?: string; mode?: string }>("/api/rc/pc", {
      op: "connect",
      toolkit,
    });
  },
  tools(toolkit: string) {
    return apiJson<unknown[]>("/api/rc/pc", { op: "tools", toolkit });
  },
  call(toolkit: string, tool: string, args?: Record<string, unknown>) {
    return apiJson<PersonalConnectionCall>("/api/rc/pc", {
      op: "call",
      toolkit,
      tool,
      args: args ?? {},
    });
  },
};

// ── llm ──────────────────────────────────────────────────────────────────────

type SerializableOpts = {
  system?: string;
  model?: string;
  provider?: string;
  output?: LlmOptions["output"];
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
  tools?: { name: string; description: string; schema?: Record<string, unknown> }[];
};

/** Pick only the JSON-safe fields of an options bag — `signal` and every `run`
 *  handler stay in the page, which is the point (see the loop note below). */
function wireOpts(opts: LlmOptions): SerializableOpts {
  const out: SerializableOpts = {};
  if (opts.system !== undefined) out.system = opts.system;
  if (opts.model !== undefined) out.model = opts.model;
  if (opts.provider !== undefined) out.provider = opts.provider;
  if (opts.output !== undefined) out.output = opts.output;
  if (opts.maxOutputTokens !== undefined) out.maxOutputTokens = opts.maxOutputTokens;
  if (opts.metadata !== undefined) out.metadata = opts.metadata;
  if (opts.tools) {
    out.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: t.schema,
    }));
  }
  return out;
}

async function* parseNdjson(resp: Response): AsyncGenerator<LlmStreamEvent> {
  if (!resp.body) throw new Error("LLM stream response has no body.");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line) as LlmStreamEvent;
        nl = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) yield JSON.parse(tail) as LlmStreamEvent;
  } finally {
    reader.releaseLock();
  }
}

/** The raw per-turn wire the tool loop drives: each planning turn is one worker
 *  call, carrying the tool DEFINITIONS only. */
const wire: WireRunners = {
  generate(input, opts) {
    return apiJson<LlmResult>(
      "/api/rc/llm/generate",
      { input, opts: wireOpts(opts) },
      opts.signal ?? undefined,
    );
  },
  async *stream(input, opts) {
    const resp = await fetch("/api/rc/llm/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, opts: wireOpts(opts) }),
      signal: opts.signal ?? undefined,
    });
    if (!resp.ok) throw new ApiError(resp.status, await resp.text());
    yield* parseNdjson(resp);
  },
};

const hasRunTools = (tools?: LlmTool[]) =>
  Array.isArray(tools) && tools.some((t) => typeof t.run === "function");

/** THE ONE THING THAT COULD NOT MOVE INTO THE WORKER.
 *
 *  Everywhere else in this port, work moved server-side. Not the Ask AI loop:
 *  its write tools pause for a human approval card, and they close over live
 *  browser state. A worker invocation is one request — there is no inbound
 *  channel to deliver an "Approve" click to a running invocation, and the tools'
 *  `run` closures do not exist server-side.
 *
 *  So the loop stays in the page (lib/tool-loop.ts, vendored) and only each
 *  planning TURN crosses to the worker. The model's authority is unchanged: it
 *  can reach exactly the tools with a `run`, and those still execute here. */
export const llm = {
  generate(input: string | LlmMessage[], options: LlmOptions = {}): Promise<LlmResult> {
    if (hasRunTools(options.tools)) return runToolLoop(input, options, wire);
    return wire.generate(input as LlmMessage[], options);
  },
  stream(input: string | LlmMessage[], options: LlmOptions = {}): AsyncIterable<LlmStreamEvent> {
    if (hasRunTools(options.tools)) return streamToolLoop(input, options, wire);
    return wire.stream(input as LlmMessage[], options);
  },
};

/** The org's callable (provider, model) catalog. An error is not fatal —
 *  callers fall back to the org default model. */
export async function listLlmProviders(): Promise<LlmProviderInfo[]> {
  try {
    const resp = await fetch("/api/rc/llm/providers", { headers: { accept: "application/json" } });
    if (!resp.ok) return [];
    return (await resp.json()) as LlmProviderInfo[];
  } catch {
    return [];
  }
}
