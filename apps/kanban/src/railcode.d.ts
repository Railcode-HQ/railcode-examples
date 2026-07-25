// Ambient declarations for the Railcode SDK globals attached to `window` by
// `<script src="/_api/sdk.js"></script>` (see index.html). These run before the
// app bundle, so we call them directly — there is no module to import.

interface RailcodeKvRow<T> {
  key: string;
  value: T;
  updated_at: string;
}

interface RailcodeQuery<T> {
  where(field: string, op: string, value: unknown): RailcodeQuery<T>;
  prefix(value: string): RailcodeQuery<T>;
  updatedSince(iso: string): RailcodeQuery<T>;
  updatedBefore(iso: string): RailcodeQuery<T>;
  orderBy(field: string, dir?: "asc" | "desc"): RailcodeQuery<T>;
  page(pageNumber?: number, size?: number): Promise<RailcodeKvRow<T>[]>;
  first(): Promise<RailcodeKvRow<T> | null>;
  count(): Promise<number>;
}

interface RailcodeCollection<T> {
  get(key: string): Promise<T | null>;
  put(key: string, value: T): Promise<T>;
  delete(key: string): Promise<void>;
  list(): Promise<RailcodeKvRow<T>[]>;
  // Query starters — `updatedSince`/`updatedBefore`/`orderBy`/`page` only
  // exist on the RailcodeQuery a starter returns, not on the collection
  // itself. Use `.query()` when you need paging/ordering with no where/prefix
  // filter (e.g. `.query().orderBy("created_at", "asc").page(1, 200)`).
  query(): RailcodeQuery<T>;
  where(field: string, op: string, value: unknown): RailcodeQuery<T>;
  prefix(value: string): RailcodeQuery<T>;
}

interface RailcodeIdentity {
  user: { uuid: string; name: string; email: string };
  app: { uuid: string; slug: string; name: string };
  org: { uuid: string; slug: string; name: string };
}

declare const me: () => Promise<RailcodeIdentity>;
declare const db: {
  collection<T = unknown>(name: string): RailcodeCollection<T>;
};
declare const designSystem: () => Promise<string>;

// Org members this app's users can be assigned to. No role memberships —
// use `roles()` for that if ever needed.
interface RailcodeAppUser {
  uuid: string;
  name: string;
  email: string;
  is_admin: boolean;
}
declare const appUsers: () => Promise<RailcodeAppUser[]>;

// Files — per-app binary storage. Names are flat (no `/`, `\`, or `.`/`..`
// traversal segments) — encode hierarchy/display names via app data instead.
interface RailcodeFileEntry {
  name: string;
  content_type: string;
  size: number;
  updated_at: string;
}
declare const files: {
  upload(
    name: string,
    data: Blob | ArrayBuffer | ArrayBufferView,
    contentType?: string,
  ): Promise<void>;
  url(name: string): string;
  list(): Promise<RailcodeFileEntry[]>;
  delete(name: string): Promise<void>;
};

// LLM — admin-configured provider/model/key, called same-origin via /_api.
interface RailcodeLlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
interface RailcodeLlmJsonOutput {
  type: "json";
  schema: Record<string, unknown>;
}
interface RailcodeLlmOptions {
  model?: string;
  system?: string;
  output?: RailcodeLlmJsonOutput;
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
}
interface RailcodeLlmResult<O = unknown> {
  text: string;
  output: O; // parsed JSON when opts.output.type === "json"
  usage?: { inputTokens?: number; outputTokens?: number };
  cost?: number;
  requestId?: string;
}
declare const llm: {
  generate<O = unknown>(
    input: string | RailcodeLlmMessage[],
    opts?: RailcodeLlmOptions,
  ): Promise<RailcodeLlmResult<O>>;
};

// SQL — read-only queries against an admin-configured Postgres connection.
type RailcodeRow = Record<string, unknown>;
interface RailcodeSqlResult extends Array<RailcodeRow> {
  columns?: string[];
  rowcount?: number;
  truncated?: boolean;
}
interface RailcodePostgres {
  (name: string): {
    runSQL(query: string, params?: unknown[]): Promise<RailcodeSqlResult>;
  };
  runSQL(query: string, params?: unknown[]): Promise<RailcodeSqlResult>;
}
declare const postgres: RailcodePostgres;
declare const dataConnectors: () => Promise<{ engine: string; name: string }[]>;
