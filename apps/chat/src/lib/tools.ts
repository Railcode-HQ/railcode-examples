import { prepareReadOnlySql } from "./sql";
import type { ToolName, ToolStep } from "./types";

/** The tool surface the agent loop can call.
 *
 *  These are `LlmTool` objects handed straight to `llm.stream({ tools })`, so
 *  the SDK drives the loop: it validates `args` against each `schema` before
 *  calling `run`, executes `run` in this page with the app's own SDK authority,
 *  feeds `summarize(result)` back to the model, and repeats until it answers.
 *  Only `{ name, description, schema }` crosses the wire — `run` and
 *  `summarize` never leave the browser.
 *
 *  The observation/display split the app already needed maps exactly onto that
 *  contract: `run` returns the whole `ToolResult` (the UI reads its
 *  `rows`/`columns`/`raw` off `step.result`), while `summarize` hands the model
 *  just the compact `observation`. So the transcript can show a full result
 *  table while the model only ever pays tokens for a clipped preview. */

export type ToolResult = {
  observation: string;
  detail: string;
  rows: Record<string, unknown>[] | null;
  columns: string[] | null;
  rowcount: number | null;
  truncated: boolean;
  raw: string | null;
};

/** Rows the model sees. Well past this and we're paying tokens for data it has
 *  already summarised; the user still sees every returned row in the table. */
const OBSERVATION_ROWS = 40;
const OBSERVATION_CHARS = 6000;

function clip(text: string, max = OBSERVATION_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… truncated (${text.length - max} more characters)`;
}

function tabularObservation(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "0 rows.";
  const shown = rows.slice(0, OBSERVATION_ROWS);
  const note =
    rows.length > shown.length
      ? `\n… ${rows.length - shown.length} more rows not shown (they are displayed to the user).`
      : "";
  return clip(`${rows.length} row(s):\n${JSON.stringify(shown)}${note}`);
}

/** PostHog's query endpoint returns columnar `{ columns, results }`. Reshaping
 *  it into row objects lets the same table component render Postgres and
 *  PostHog results without caring where they came from. */
function columnarToRows(payload: unknown): Record<string, unknown>[] | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as { columns?: unknown; results?: unknown };
  if (!Array.isArray(obj.columns) || !Array.isArray(obj.results)) return null;
  const columns = obj.columns.map((c) => String(c));
  return obj.results.map((row) => {
    const record: Record<string, unknown> = {};
    if (Array.isArray(row)) {
      columns.forEach((col, i) => {
        record[col] = row[i];
      });
    }
    return record;
  });
}

/** Turn a connector non-2xx into a message worth showing.
 *
 *  PostHog personal API keys are scoped per resource, so the common failure here
 *  is a 403 naming a scope the key lacks. Surfacing that verbatim tells the user
 *  exactly which checkbox to tick, instead of a generic "request failed". */
function connectorError(status: number, body: string): Error {
  try {
    const parsed = JSON.parse(body) as { detail?: string; code?: string };
    if (status === 403 && parsed.detail) {
      return new Error(
        `PostHog denied this request: ${parsed.detail}. The connector's API key needs that scope added in PostHog before this tool can work.`,
      );
    }
    if (parsed.detail) return new Error(`PostHog error ${status}: ${parsed.detail}`);
  } catch {
    /* fall through to the raw body */
  }
  return new Error(`PostHog error ${status}: ${clip(body, 400)}`);
}

async function posthogFetch(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const resp = await connector("posthog").fetch(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await resp.text();
  if (!resp.ok) throw connectorError(resp.status, text);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function runPostgres(connection: string, input: string): Promise<ToolResult> {
  const sql = prepareReadOnlySql(input);
  const rows = await data(connection).runSQL(sql);
  const plain = rows.map((r) => ({ ...r }));
  return {
    observation: tabularObservation(plain),
    detail: sql,
    rows: plain,
    columns: rows.columns ?? (plain[0] ? Object.keys(plain[0]) : []),
    rowcount: rows.rowcount ?? plain.length,
    truncated: rows.truncated ?? false,
    raw: null,
  };
}

async function runPosthogQuery(input: string): Promise<ToolResult> {
  const hogql = input.trim();
  if (!hogql) throw new Error("No HogQL query was provided.");
  const payload = await posthogFetch("POST", "/api/projects/@current/query/", {
    query: { kind: "HogQLQuery", query: hogql },
  });
  const rows = columnarToRows(payload);
  if (rows) {
    return {
      observation: tabularObservation(rows),
      detail: hogql,
      rows,
      columns: rows[0] ? Object.keys(rows[0]) : [],
      rowcount: rows.length,
      truncated: false,
      raw: null,
    };
  }
  const raw = clip(JSON.stringify(payload, null, 2));
  return {
    observation: raw,
    detail: hogql,
    rows: null,
    columns: null,
    rowcount: null,
    truncated: false,
    raw,
  };
}

async function runPosthogApi(
  rawPath: string,
  rawMethod: string,
  rawBody: string,
): Promise<ToolResult> {
  const path = rawPath.trim();
  if (!path.startsWith("/api/")) {
    throw new Error(
      "PostHog paths must start with /api/ — for example /api/projects/@current/insights/.",
    );
  }
  const method = rawMethod === "POST" ? "POST" : "GET";
  let body: unknown;
  if (method === "POST" && rawBody.trim()) {
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      throw new Error("The PostHog request body was not valid JSON.");
    }
  }
  const payload = await posthogFetch(method, path, body);
  const raw = clip(JSON.stringify(payload, null, 2));
  return {
    observation: raw,
    detail: `${method} ${path}`,
    rows: null,
    columns: null,
    rowcount: null,
    truncated: false,
    raw,
  };
}

export const TOOL_LABELS: Record<ToolName, string> = {
  query_postgres: "Postgres",
  posthog_query: "PostHog · HogQL",
  posthog_api: "PostHog · API",
};

const TOOL_NAMES = Object.keys(TOOL_LABELS) as ToolName[];

/** Every tool returns the full `ToolResult`; the model only ever sees
 *  `observation`. Errors thrown in `run` (a rejected non-SELECT, a PostHog 403)
 *  are handed back to the model as the tool result rather than thrown into app
 *  code, so a recoverable mistake costs one step instead of the whole turn. */
const summarizeResult = (result: unknown) => (result as ToolResult).observation;

/** Built per-run because the Postgres tool's description names the live
 *  connection, and because a source the user switched off must not be wired at
 *  all — an undeclared tool is simply absent from the model's options. */
export function buildTools(enabled: ToolName[], connection: string): LlmTool[] {
  const tools: LlmTool[] = [];

  if (enabled.includes("query_postgres")) {
    tools.push({
      name: "query_postgres",
      description:
        `Run ONE read-only SQL SELECT against the "${connection}" Postgres database. ` +
        "Aggregate in the query (COUNT/SUM/AVG/GROUP BY) instead of pulling raw rows " +
        "and counting yourself — you only see a clipped preview of the result, while " +
        "the user sees every row. Only SELECT or WITH … SELECT; the connection is " +
        "read-only. Prefer the pre-joined views over hand-rolling joins.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sql: { type: "string", description: "The SELECT statement to run." },
        },
        required: ["sql"],
      },
      run: ({ sql }: { sql: string }) => runPostgres(connection, sql),
      summarize: summarizeResult,
    });
  }

  if (enabled.includes("posthog_query")) {
    tools.push({
      name: "posthog_query",
      description:
        "Run HogQL (ClickHouse-flavoured SQL) against PostHog product analytics. " +
        "Tables include `events`, `persons`, `sessions`. Aggregate and LIMIT inside " +
        "the query — you only see a clipped preview of the result.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          hogql: { type: "string", description: "The HogQL query to run." },
        },
        required: ["hogql"],
      },
      run: ({ hogql }: { hogql: string }) => runPosthogQuery(hogql),
      summarize: summarizeResult,
    });
  }

  if (enabled.includes("posthog_api")) {
    tools.push({
      name: "posthog_api",
      description:
        "Call a PostHog REST endpoint, e.g. /api/projects/@current/insights/. Use this " +
        "for resources HogQL cannot reach (insights, feature flags, cohorts). Paths " +
        "must start with /api/.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "Endpoint path, starting with /api/." },
          method: { type: "string", enum: ["GET", "POST"], description: "Defaults to GET." },
          body: { type: "string", description: "JSON body for POST; omit for GET." },
        },
        // Only `path` is required: a missing optional field would fail validation
        // and cost a whole retry turn, and `run` already defaults both.
        required: ["path"],
      },
      run: ({ path, method, body }: { path: string; method?: string; body?: string }) =>
        runPosthogApi(path, method ?? "GET", body ?? ""),
      summarize: summarizeResult,
    });
  }

  return tools;
}

/** While a step is `running` the SDK has args but no result yet, so the card's
 *  `detail` comes from the args and is replaced by the executed form (the SQL
 *  after LIMIT injection, say) once the result lands. */
function detailFromArgs(tool: string, args: Record<string, unknown>): string {
  const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : "");
  if (tool === "query_postgres") return str("sql");
  if (tool === "posthog_query") return str("hogql");
  if (tool === "posthog_api") return `${str("method") || "GET"} ${str("path")}`.trim();
  return "";
}

/** Map an SDK loop step onto the card the transcript renders. The raw `run`
 *  return value rides on `step.result`, which is where the table comes from. */
export function toUiStep(step: LlmToolStep): ToolStep {
  const result = (step.result ?? null) as ToolResult | null;
  const args = (step.args ?? {}) as Record<string, unknown>;
  const tool = TOOL_NAMES.includes(step.tool as ToolName)
    ? (step.tool as ToolName)
    : ("query_postgres" as ToolName);

  return {
    id: step.id,
    tool,
    detail: result?.detail || detailFromArgs(step.tool, args),
    status: step.status,
    ms: step.ms,
    error: step.error,
    rows: result?.rows ?? null,
    columns: result?.columns ?? null,
    rowcount: result?.rowcount ?? null,
    truncated: result?.truncated ?? false,
    raw: result?.raw ?? null,
  };
}
