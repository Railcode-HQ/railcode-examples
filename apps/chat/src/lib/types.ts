/** Domain types. There is no schema/migration concept in Railcode KV — these
 *  interfaces *are* the schema, so read paths backfill fields defensively
 *  (see `store/chat-store.ts`) rather than assuming older records match. */

export type Role = "user" | "assistant";

export type ToolName = "query_postgres" | "posthog_query" | "posthog_api";

export type SourceId = "postgres" | "posthog";

/** A file the user attached to a message.
 *
 *  `id` doubles as the flat storage name under the caller's private `files.user`
 *  scope; the user-facing filename lives only in `name`. Text-ish files get an
 *  `excerpt` extracted at upload time so the model can actually read them —
 *  the LLM gateway is text-only, so binary content can only be referenced. */
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

export const DEFAULT_PREFS: Prefs = {
  model: null,
  sources: { postgres: true, posthog: true },
};
