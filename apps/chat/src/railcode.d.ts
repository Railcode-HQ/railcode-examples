type Me = {
  user: {
    uuid: string;
    name: string;
    email: string;
    is_admin: boolean;
    /** Whether the caller holds this app's owner grant. A UI hint only. */
    is_app_owner?: boolean;
    roles: RoleRef[];
  };
  app: { uuid: string; slug: string; name: string };
  org: { uuid: string; slug: string; name: string };
};

type AppUser = {
  uuid: string;
  name: string;
  email: string;
  is_admin: boolean;
};

type RoleRef = { uuid: string; name: string };
type OrgRole = RoleRef & { description: string; is_member: boolean };

type KvRecord<T = unknown> = {
  key: string;
  value: T;
  updated_at: string;
};

type WhereOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in";

type KvQuery<T = unknown> = {
  where(field: string, op: WhereOp, value: unknown): KvQuery<T>;
  prefix(value: string): KvQuery<T>;
  updatedSince(value: string | Date): KvQuery<T>;
  updatedBefore(value: string | Date): KvQuery<T>;
  orderBy(field: string, direction?: "asc" | "desc"): KvQuery<T>;
  page(page?: number, size?: number): Promise<KvRecord<T>[]>;
  first(): Promise<KvRecord<T> | null>;
  count(): Promise<number>;
};

type Collection<T = unknown> = {
  get(key: string): Promise<T | null>;
  put(key: string, value: T): Promise<T>;
  delete(key: string): Promise<void>;
  list(): Promise<KvRecord<T>[]>;
  query(): KvQuery<T>;
  where(field: string, op: WhereOp, value: unknown): KvQuery<T>;
  prefix(value: string): KvQuery<T>;
};

type FileMeta = {
  name: string;
  content_type: string;
  size: number;
  updated_at: string;
};

type SqlRows = Array<Record<string, unknown>> & {
  columns?: string[];
  rowcount?: number;
  truncated?: boolean;
};

type DataConnectorInfo = {
  engine: "postgres" | "bigquery" | "turso" | string;
  name: string;
};

type DatabaseHandle = {
  runSQL(query: string, params?: unknown[]): Promise<SqlRows>;
};

type DatabaseNamespace = ((connection: string) => DatabaseHandle) & DatabaseHandle;

type SavedQueryInfo = {
  name: string;
  description: string;
  params: { name: string; type: string }[];
  version: number;
};

type ServiceConnectorInfo = {
  name: string;
  description: string | null;
  auth_type: string;
  allowed_methods: string[];
};

type ServiceConnectorResponse = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  truncated: boolean;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
};

type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

type LlmOutputSpec = { type?: "text" } | { type: "json"; schema: Record<string, unknown> };

/** A tool the model asked to call. `arguments` is already parsed from the
 *  provider's JSON string into an object. */
type LlmToolCall = { id: string; name: string; arguments: Record<string, unknown> };

/** Passed to a tool's `run` while the SDK drives the loop. */
type LlmToolContext = {
  /** Aborts when the run is cancelled or times out — honor it in long tools. */
  signal: AbortSignal;
  /** The planning turn (1-based) this tool call belongs to. */
  step: number;
};

/** One tool for `llm.generate()` / `llm.stream()`.
 *
 *  With `run`, the SDK executes the tool and loops until the model answers — the
 *  return value IS the result: the raw value reaches the UI as `step.result`,
 *  while the model sees only `summarize(result)` (default: JSON clipped to
 *  ~6000 chars). Without `run` on ANY tool, the call is a single turn and the
 *  requested calls come back on `toolCalls`. Mixing run and run-less tools throws. */
type LlmTool<TArgs = any> = {
  name: string;
  /** The model's only manual for this tool — what it's for AND how to use it well. */
  description: string;
  /** JSON Schema for the args; validated BEFORE `run` (a bad arg is fed back to
   *  the model as the tool result, never thrown into app code). */
  schema?: Record<string, unknown>;
  run?(args: TArgs, ctx: LlmToolContext): Promise<unknown> | unknown;
  /** Projection of the result for the MODEL only. The UI sees the raw return. */
  summarize?(result: unknown): string;
};

/** One executed tool call in a loop run. Emitted twice per call on the stream
 *  path (running, then settled) — upsert by `id`. */
type LlmToolStep = {
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
type LlmRunLimits = {
  /** Max planning turns (LLM calls that may request tools). Default 8. */
  maxSteps?: number;
  /** Max tool executions across the whole run. Default 30. */
  maxToolCalls?: number;
  /** Wall-clock budget; the loop cancels between steps/chunks. Default 120_000. */
  timeoutMs?: number;
};

type LlmStopReason = "end" | "max_steps" | "max_tool_calls" | "timeout" | "aborted";

type LlmOptions = {
  /** A catalog model name (see llmProviders()); its provider is implied. */
  model?: string;
  /** A provider name; without a model, routes to that provider's default model. */
  provider?: string;
  system?: string;
  output?: LlmOutputSpec;
  /** Tools the model may call. All with `run` → the SDK runs the loop; none with
   *  `run` → single turn, requested calls returned on `toolCalls`. */
  tools?: LlmTool[];
  /** Loop bounds; ignored unless `tools` carry `run`. */
  limits?: LlmRunLimits;
  /** Cancels the call (and a tool loop between steps/chunks). */
  signal?: AbortSignal;
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
};

type LlmUsage = { inputTokens: number; outputTokens: number; totalTokens: number };

type LlmResult = {
  text: string;
  output: unknown | null;
  /** Run-less tools: the calls the model asked for, unexecuted. Loop runs: `[]`
   *  (every call was executed — see `steps`). Empty without `tools`. */
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
  cost: string | null;
  provider: string;
  model: string;
  finishReason: string | null;
  requestId: string;
  /** Loop runs only: every executed tool call, in order, with raw results. */
  steps?: LlmToolStep[];
  /** Loop runs only: the full transcript incl. threaded tool turns and the final
   *  answer — pass it back as the next call's input to continue. */
  messages?: LlmMessage[];
  /** Loop runs only: how the run ended. Check before rendering — `max_steps` and
   *  `timeout` can leave `text` empty. */
  stopReason?: LlmStopReason;
};

type LlmStreamEvent =
  | { type: "text"; text: string }
  // Loop runs only: a tool call started ("running") or settled ("ok"/"error").
  // Two events per call, same `step.id` — upsert, don't append.
  | { type: "step"; step: LlmToolStep }
  | {
      type: "done";
      usage: LlmUsage;
      cost: string | null;
      provider: string;
      model: string;
      finishReason: string | null;
      requestId: string;
      /** Run-less tools: the calls the model asked for, delivered complete. */
      toolCalls?: LlmToolCall[];
      /** Loop runs only: the finished run — same fields as the loop's LlmResult. */
      text?: string;
      output?: unknown | null;
      steps?: LlmToolStep[];
      messages?: LlmMessage[];
      stopReason?: LlmStopReason;
    }
  // `error` is the failure class (`provider_auth_error`, …); `retryable` says
  // whether repeating the same call could ever succeed. Absent on `timeout`.
  | {
      type: "error";
      error: string;
      message: string;
      retryable?: boolean;
      requestId?: string;
      /** Loop runs only: the planning turn (1-based) the failure happened on. */
      step?: number | null;
    };

type LlmModelInfo = { model: string; default: boolean };

type LlmProviderInfo = { provider: string; default: boolean; models: LlmModelInfo[] };

type EmailSendOptions = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
};

type EmailSendResult = {
  id: string;
  status: string;
  requestId: string;
};

declare const me: () => Promise<Me>;
declare const appUsers: () => Promise<AppUser[]>;
declare const roles: () => Promise<OrgRole[]>;
declare const designSystem: () => Promise<string>;
type DbNamespace = { collection<T = unknown>(name: string): Collection<T> };
/** Result of the batched `files.urls()` — resolves up to 100 names in one request. */
type FileUrlBatch = {
  items: { name: string; url: string; expires_in: number }[];
  missing: string[];
};

type FilesNamespace = {
  upload(name: string, data: Blob | ArrayBuffer | ArrayBufferView, contentType?: string): Promise<FileMeta>;
  url(name: string): string;
  urls(names: string[]): Promise<FileUrlBatch>;
  list(): Promise<FileMeta[]>;
  delete(name: string): Promise<void>;
};
// Storage scopes. Bare db/files are aliases for `.shared` (app-wide). `.user` is the
// signed-in caller's own private namespace; `.role(uuid)` is one org role's namespace
// (the caller must be a live member of that role — owner/admin may reach any). The same
// (collection,key) / file name never collides across scopes.
declare const db: DbNamespace & {
  shared: DbNamespace;
  user: DbNamespace;
  role(uuid: string): DbNamespace;
};
declare const files: FilesNamespace & {
  shared: FilesNamespace;
  user: FilesNamespace;
  role(uuid: string): FilesNamespace;
};
declare const data: DatabaseNamespace;
declare const postgres: DatabaseNamespace;
declare const bigquery: DatabaseNamespace;
declare const turso: DatabaseNamespace;
declare const dataConnectors: () => Promise<DataConnectorInfo[]>;
declare const savedQueries: () => Promise<SavedQueryInfo[]>;
declare const query: (name: string, params?: Record<string, unknown>) => Promise<SqlRows>;
declare const serviceConnectors: () => Promise<ServiceConnectorInfo[]>;
declare const connector: (name: string) => {
  fetch(path: string, opts?: { method?: string; body?: string }): Promise<ServiceConnectorResponse>;
};
declare const llm: {
  generate(input: string | LlmMessage[], opts?: LlmOptions): Promise<LlmResult>;
  stream(input: string | LlmMessage[], opts?: LlmOptions): AsyncIterable<LlmStreamEvent>;
};
declare const llmProviders: () => Promise<LlmProviderInfo[]>;
declare const email: { send(opts: EmailSendOptions): Promise<EmailSendResult> };
