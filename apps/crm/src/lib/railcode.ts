export type IdentityRole = {
  uuid: string;
  name: string;
};

export type IdentityUser = {
  uuid: string;
  name: string;
  email: string;
  is_admin: boolean;
  roles: IdentityRole[];
};

export type IdentityApp = {
  uuid: string;
  slug: string;
  name: string;
};

export type IdentityOrg = {
  uuid: string;
  slug: string;
  name: string;
};

export type Identity = {
  user: IdentityUser;
  app: IdentityApp;
  org: IdentityOrg;
};

export type AccessRule =
  | { type: "workspace" }
  | { type: "domain"; domain: string; role: "user" | "owner" };

export type AppUser = {
  id: string;
  username: string;
  email: string | null;
  role: "user" | "owner";
  known: boolean;
};

export type AppUsers = {
  app: string;
  mode: "private" | "workspace" | "restricted" | "local";
  complete: boolean;
  users: AppUser[];
  access_rules?: AccessRule[];
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

export type Connection = {
  name: string;
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

export type SqlRows = Array<Record<string, unknown>> & {
  columns?: string[];
  rowcount?: number;
  truncated?: boolean;
};

export type LlmMessage = {
  /** The SDK threads tool turns back through `done.messages`, so the wire
   *  transcript can carry roles the app never writes itself. */
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

/** Passed to a tool's `run` while the SDK drives the loop. */
export type LlmToolContext = {
  /** Aborts when the run is cancelled or times out — honor it in long tools. */
  signal: AbortSignal;
  /** The planning turn (1-based) this tool call belongs to. */
  step: number;
};

/** One tool handed to `llm.generate()` / `llm.stream()`.
 *
 *  With `run`, the SDK executes the tool and loops until the model answers: the
 *  raw return value reaches the UI as `step.result`, while the model sees only
 *  `summarize(result)`. Only `{ name, description, schema }` crosses the wire —
 *  `run` and `summarize` never leave the browser. */
export type LlmTool<TArgs = any> = {
  name: string;
  /** The model's only manual for this tool — what it does AND how to use it. */
  description: string;
  /** JSON Schema for the args, validated BEFORE `run`; a bad arg is fed back to
   *  the model as the tool result rather than thrown into app code. */
  schema?: Record<string, unknown>;
  run?(args: TArgs, ctx: LlmToolContext): Promise<unknown> | unknown;
  /** Projection of the result for the MODEL only. The UI sees the raw return. */
  summarize?(result: unknown): string;
};

/** One executed tool call. Emitted twice on the stream path (running, then
 *  settled) with the same `id` — upsert, don't append. */
export type LlmToolStep = {
  id: string;
  index: number;
  tool: string;
  args: unknown;
  status: "running" | "ok" | "error";
  /** The RAW tool return value, for the UI. Null while running / on error. */
  result: unknown | null;
  error: string | null;
  ms: number | null;
};

/** Bounds for a tool-loop run (only meaningful with `run`-bearing tools). */
export type LlmRunLimits = {
  /** Max planning turns. Default 8. */
  maxSteps?: number;
  /** Max tool executions across the whole run. Default 30. */
  maxToolCalls?: number;
  /** Wall-clock budget; the loop cancels between steps/chunks. Default 120_000. */
  timeoutMs?: number;
};

export type LlmStopReason = "end" | "max_steps" | "max_tool_calls" | "timeout" | "aborted";

export type LlmOptions = {
  /** A catalog model name (see `llmProviders()`); its provider is implied. */
  model?: string;
  /** A provider name; without a model, routes to that provider's default. */
  provider?: string;
  system?: string;
  output?: {
    type: "text" | "json";
    schema?: Record<string, unknown>;
  };
  /** Tools the model may call. All carrying `run` → the SDK runs the loop. */
  tools?: LlmTool[];
  /** Loop bounds; ignored unless `tools` carry `run`. */
  limits?: LlmRunLimits;
  /** Cancels the call (and a tool loop between steps/chunks). */
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

export type LlmCost = {
  amount: number;
  currency: string;
  estimated: boolean;
};

export type LlmResult = {
  text: string;
  output: unknown;
  usage?: LlmUsage;
  cost?: LlmCost | null;
  provider?: string;
  model?: string;
  finishReason?: string;
  requestId?: string;
};

export type LlmStreamEvent =
  | { type: "text"; text: string }
  /** Loop runs only: a tool call started ("running") or settled ("ok"/"error"). */
  | { type: "step"; step: LlmToolStep }
  | {
      type: "done";
      usage?: LlmUsage;
      cost?: LlmCost | null;
      provider?: string;
      model?: string;
      finishReason?: string;
      requestId?: string;
      /** Loop runs only: the finished run. */
      text?: string;
      steps?: LlmToolStep[];
      /** The full transcript incl. threaded tool turns — pass it back as the
       *  next call's input to continue the conversation. */
      messages?: LlmMessage[];
      stopReason?: LlmStopReason;
    }
  /** `error` is the failure class (`provider_auth_error`, …); `retryable` says
   *  whether repeating the same call could ever succeed. */
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

/** Terminal statuses are success | failed | cancelled | limit_exceeded — note
 *  "success", not "succeeded", and note that a run can end for a reason that
 *  isn't "failed", so anything non-success needs handling explicitly. */
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

declare global {
  interface Window {
    me?: () => Promise<Identity>;
    appUsers?: () => Promise<AppUsers>;
    db?: {
      collection<T = unknown>(name: string): Collection<T>;
      user: { collection<T = unknown>(name: string): Collection<T> };
    };
    files?: {
      upload(name: string, blob: Blob, type?: string): Promise<unknown>;
      url(name: string): string;
      list(): Promise<FileEntry[]>;
      delete(name: string): Promise<unknown>;
    };
    connections?: () => Promise<Connection[]>;
    personalConnections?: {
      list(): Promise<PersonalConnectionStatus[]>;
      connect(toolkit: string): Promise<{ redirect_url: string }>;
      tools(toolkit: string): Promise<unknown[]>;
      call(
        toolkit: string,
        tool: string,
        args?: Record<string, unknown>,
      ): Promise<PersonalConnectionCall>;
    };
    sql?: (
      query: string,
      params?: unknown[],
      opts?: { connection?: string },
    ) => Promise<SqlRows>;
    llm?: {
      generate(
        input: string | LlmMessage[],
        options?: LlmOptions,
      ): Promise<LlmResult>;
      stream(
        input: string | LlmMessage[],
        options?: LlmOptions,
      ): AsyncIterable<LlmStreamEvent>;
    };
    llmProviders?: () => Promise<LlmProviderInfo[]>;
    agents?: {
      /** Runs the agent and resolves once it reaches a terminal status. */
      invoke(name: string, input?: unknown): Promise<AgentRun>;
      /** Queues a run and returns immediately; poll with `get(request_id)`. */
      start(name: string, input?: unknown): Promise<AgentRun>;
      get(requestId: string): Promise<AgentRun>;
    };
  }
}

function requireSdk<K extends keyof Window>(key: K): NonNullable<Window[K]> {
  const value = window[key];
  if (!value) {
    throw new Error(
      `Railcode SDK global '${String(key)}' is not available. Make sure /_api/sdk.js loads before the app bundle.`,
    );
  }
  return value as NonNullable<Window[K]>;
}

export function getIdentity(): Promise<Identity> {
  return requireSdk("me")();
}

export function getAppUsers(): Promise<AppUsers> {
  return requireSdk("appUsers")();
}

export function collection<T = unknown>(name: string): Collection<T> {
  return requireSdk("db").collection<T>(name);
}

/** The caller's own private namespace — not shared with other app users. */
export function userCollection<T = unknown>(name: string): Collection<T> {
  return requireSdk("db").user.collection<T>(name);
}

export const fileStore = {
  upload(name: string, blob: Blob, type?: string) {
    return requireSdk("files").upload(name, blob, type);
  },
  url(name: string) {
    return requireSdk("files").url(name);
  },
  list() {
    return requireSdk("files").list();
  },
  delete(name: string) {
    return requireSdk("files").delete(name);
  },
};

export function listConnections(): Promise<Connection[]> {
  return requireSdk("connections")();
}

/** Managed agents this app's manifest declares. A generate run takes minutes, so
 *  the app always uses `start` + poll — `invoke` would hold one request open for
 *  the whole thing and die with the tab. */
export const agents = {
  invoke(name: string, input?: unknown) {
    return requireSdk("agents").invoke(name, input);
  },
  start(name: string, input?: unknown) {
    return requireSdk("agents").start(name, input);
  },
  get(requestId: string) {
    return requireSdk("agents").get(requestId);
  },
};

export const personalConnections = {
  list() {
    return requireSdk("personalConnections").list();
  },
  connect(toolkit: string) {
    return requireSdk("personalConnections").connect(toolkit);
  },
  tools(toolkit: string) {
    return requireSdk("personalConnections").tools(toolkit);
  },
  call(toolkit: string, tool: string, args?: Record<string, unknown>) {
    return requireSdk("personalConnections").call(toolkit, tool, args);
  },
};

export function runSql(
  query: string,
  params: unknown[] = [],
  connection?: string,
): Promise<SqlRows> {
  return requireSdk("sql")(query, params, { connection });
}

export const llm = {
  generate(input: string | LlmMessage[], options?: LlmOptions) {
    return requireSdk("llm").generate(input, options);
  },
  stream(input: string | LlmMessage[], options?: LlmOptions) {
    return requireSdk("llm").stream(input, options);
  },
};

/** The org's callable (provider, model) catalog. Absent on older SDK builds,
 *  which is not an error — callers fall back to the org default model. */
export async function listLlmProviders(): Promise<LlmProviderInfo[]> {
  const fn = window.llmProviders;
  if (!fn) return [];
  try {
    return await fn();
  } catch {
    return [];
  }
}
