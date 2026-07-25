type Me = {
  user: { uuid: string; name: string; email: string; is_admin: boolean; roles: RoleRef[] };
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

type LlmOptions = {
  /** A catalog model name (see llmProviders()); its provider is implied. */
  model?: string;
  /** A provider name; without a model, routes to that provider's default model. */
  provider?: string;
  system?: string;
  output?: LlmOutputSpec;
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
};

type LlmUsage = { inputTokens: number; outputTokens: number; totalTokens: number };

type LlmResult = {
  text: string;
  output: unknown | null;
  usage: LlmUsage;
  cost: string | null;
  provider: string;
  model: string;
  finishReason: string | null;
  requestId: string;
};

type LlmStreamEvent =
  | { type: "text"; text: string }
  | {
      type: "done";
      usage: LlmUsage;
      cost: string | null;
      provider: string;
      model: string;
      finishReason: string | null;
      requestId: string;
    }
  | { type: "error"; error: string; message: string; requestId: string };

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
type FilesNamespace = {
  upload(name: string, data: Blob | ArrayBuffer | ArrayBufferView, contentType?: string): Promise<FileMeta>;
  url(name: string): string;
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

// Terminal statuses per the SDK: success | failed | cancelled | limit_exceeded.
// Note "success", not "succeeded" — and note that a run can end for reasons that
// are not "failed", so anything non-success must be handled explicitly.
type AgentRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "limit_exceeded"
  | string;

type AgentRun = {
  /** snake_case on the wire — the SDK itself polls with run.request_id. */
  request_id: string;
  status: AgentRunStatus;
  /** Note: output_json, not "output". */
  output_json?: unknown;
  /**
   * The failure reason lives in these two fields. There is NO `error` field —
   * reading one yields undefined and throws away the only useful diagnostic.
   * e.g. error_code "daily_token_limit_exceeded" with status "failed".
   */
  error_code?: string | null;
  error_message?: string | null;
  input_json?: unknown;
  started_at?: string;
  finished_at?: string | null;
};

type PersonalConnectionInfo = {
  toolkit: string;
  name: string;
  status: string;
};

/**
 * The caller's own connected accounts (Granola, Slack, …). Tool results come
 * back MCP-style: { tool, result: [{ type: "text", text }] }.
 */
declare const personalConnections: {
  list(): Promise<PersonalConnectionInfo[]>;
  connect(toolkit: string): Promise<{ url?: string } & Record<string, unknown>>;
  tools(toolkit: string): Promise<Array<{ slug: string; description: string }>>;
  call(toolkit: string, tool: string, args?: Record<string, unknown>): Promise<unknown>;
};

declare const agents: {
  /** Invokes the agent and resolves once the run reaches a terminal status. */
  invoke(name: string, input?: unknown): Promise<AgentRun>;
  /** Queues a run and returns immediately; poll it with agents.get(requestId). */
  start(name: string, input?: unknown): Promise<AgentRun>;
  get(requestId: string): Promise<AgentRun>;
};
