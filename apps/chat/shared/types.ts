/** The wire contract between the two halves of this app.
 *
 *  Imported by BOTH the worker (server/) and the frontend, so a change to a
 *  message shape is a compile error on both sides at once rather than a runtime
 *  surprise on one of them.
 *
 *  There is no schema/migration concept in Railcode KV — these interfaces *are*
 *  the schema, so read paths backfill fields defensively (see the worker's
 *  hydrate helpers) rather than assuming older records match. */

export type Role = "user" | "assistant";

export type ToolName = "query_postgres" | "posthog_query" | "posthog_api";

/** How each tool is labelled in the transcript. Shared because the worker maps
 *  loop steps onto these names and the browser renders them. */
export const TOOL_LABELS: Record<ToolName, string> = {
  query_postgres: "Postgres",
  posthog_query: "PostHog · HogQL",
  posthog_api: "PostHog · API",
};

export type SourceId = "postgres" | "posthog";

/** A file the user attached to a message.
 *
 *  `id` is an opaque id, NOT the storage name — the worker builds that from the
 *  verified caller (see server/keys.ts). The user-facing filename lives only in
 *  `name`. Text-ish files get an `excerpt` extracted at upload time so the model
 *  can actually read them — the LLM gateway is text-only, so binary content can
 *  only be referenced. */
export type Attachment = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  kind: "image" | "text" | "other";
  excerpt: string | null;
};

export type ToolStatus = "running" | "ok" | "error";

/** One tool invocation inside an assistant turn, rendered as a card in the
 *  transcript. Persisted with the message so reopening a conversation shows the
 *  same work rather than bare prose. */
export type ToolStep = {
  id: string;
  tool: ToolName;
  /** The query/path this step ran — the thing worth showing the user. */
  detail: string;
  /** Legacy. The hand-rolled planner made the model narrate each step in a JSON
   *  field; the SDK loop streams that reasoning as ordinary text instead, so
   *  new steps never set this. Kept so conversations saved before the switch
   *  still render their thoughts. */
  thought?: string;
  status: ToolStatus;
  ms: number | null;
  error: string | null;
  rows: Record<string, unknown>[] | null;
  columns: string[] | null;
  rowcount: number | null;
  truncated: boolean;
  /** Non-tabular results (PostHog JSON), pretty-printed and capped. */
  raw: string | null;
};

export type Message = {
  id: string;
  /** The member this record belongs to. Written by the worker from the verified
   *  caller, and checked on every read — see server/keys.ts. */
  owner: string;
  convId: string;
  seq: number;
  role: Role;
  content: string;
  createdAt: string;
  attachments: Attachment[];
  steps: ToolStep[];
  error: string | null;
  model: string | null;
  usage: LlmUsage | null;
};

export type Conversation = {
  id: string;
  /** As on Message: the worker sets this and checks it. */
  owner: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  preview: string;
  messageCount: number;
  pinned: boolean;
};

export type Prefs = {
  model: string | null;
  sources: Record<SourceId, boolean>;
};

/** Prefs as stored — the same settings plus the owner stamp. */
export type StoredPrefs = Prefs & { owner: string };

export const DEFAULT_PREFS: Prefs = {
  model: null,
  sources: { postgres: true, posthog: true },
};

// --- the /api/chat wire ------------------------------------------------------

/** What the browser sends to start one assistant turn. The worker rebuilds the
 *  transcript, the system prompt and the tool surface from THIS plus the stored
 *  conversation — the browser never names a model's tools or its authority. */
export type ChatRequest = {
  convId: string;
  question: string;
  attachments: Attachment[];
  prefs: Prefs;
};

/** One ndjson frame from the agent loop. A near-passthrough of the SDK's own
 *  stream events, with the tool step already mapped to the card the transcript
 *  renders. */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "step"; step: ToolStep }
  | {
      type: "done";
      content: string;
      steps: ToolStep[];
      usage: LlmUsage | null;
      model: string | null;
      stopReason: StopReason | null;
    }
  | { type: "error"; error: string; message: string };

/** What POST /api/chat actually writes: the loop's frames, plus the three the
 *  WORKER adds because it is the one persisting the turn.
 *
 *  `user` and `saved` carry the stored records, so the browser replaces its
 *  optimistic copies with the real ones rather than guessing their ids. That
 *  matters: the worker persists both messages, so a browser that navigates away
 *  mid-answer still leaves a complete conversation behind. */
export type ChatFrame =
  | ChatEvent
  | { type: "user"; message: Message }
  | { type: "saved"; message: Message }
  | { type: "title"; title: string };

export type StopReason = "end" | "max_steps" | "max_tool_calls" | "timeout" | "aborted";

/** Token accounting for one turn, as the gateway reports it. */
export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/** One (provider, models) pair the org has configured, for the model picker. */
export type LlmProviderInfo = {
  provider: string;
  default: boolean;
  models: { model: string; default: boolean }[];
};

/** The verified caller, as the worker's /api/me returns it. */
export type Me = {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
};
