// The Railcode worker for the CRM.
//
// Deliberately thin. The app's product logic — the CRM model, the Ask AI loop,
// the automations — stayed in the frontend where it already worked; what moved
// here is everything that needs a credential, which on apps v2 is everything
// that touches the platform at all.
//
// The routes mirror `frontend/src/lib/railcode.ts` one for one, so the port was
// a rewrite of that single wrapper module rather than a rewrite of the app.
import { Hono } from "hono";
import {
  ApiError,
  agents,
  ctx,
  db,
  files,
  llm,
  llmProviders,
  connector,
  toNdjson,
  type LlmMessage,
  type LlmOptions,
} from "@railcode/sdk";

const app = new Hono();

app.use("/api/*", async (c, next) => {
  if (!ctx.user) return c.json({ error: "no signed-in caller" }, 409);
  await next();
});

const caller = () => ctx.user!;

// Relay the platform's status and body verbatim. The browser wrapper rebuilds an
// ApiError from them, so every `.status` check written against v1 keeps working
// across the extra hop: 403 "not authorized", 409 "conflict",
// 429 "rate limited".
app.onError((err) => {
  if (err instanceof ApiError) {
    return new Response(err.message || JSON.stringify({ error: "error" }), {
      status: err.status,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({ error: "worker_error", message: err instanceof Error ? err.message : String(err) }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
});

// ── identity ─────────────────────────────────────────────────────────────────
app.get("/api/rc/me", (c) => c.json({ user: caller() }));

// ── kv ───────────────────────────────────────────────────────────────────────
// The worker decides privacy by collection, never by a request flag. Unknown
// collections are refused so a new private collection cannot silently be shared.
const SHARED_COLLECTIONS = new Set([
  "companies", "contacts", "deals", "activities", "callNotes", "actionItems",
  "callTranscripts", "automations", "automationSettings", "artifacts",
  "automationRuns", "meetingTriage",
]);
const PRIVATE_COLLECTIONS = new Set(["notifRead"]);

interface Owned {
  __owner?: string;
}

app.post("/api/rc/kv", async (c) => {
  const user = caller();
  const body = (await c.req.json()) as {
    collection: string;
    op: "get" | "put" | "delete" | "list";
    key?: string;
    value?: unknown;
    mine?: boolean;
  };
  if (!PRIVATE_COLLECTIONS.has(body.collection) && !SHARED_COLLECTIONS.has(body.collection)) {
    return c.json({ error: "unknown collection" }, 400);
  }
  const mine = PRIVATE_COLLECTIONS.has(body.collection);
  // Slash/dot segments must never reach the SDK's URL builder. Colons remain
  // valid for legacy shared keys; a private key is always prefixed here.
  if (body.op !== "list" && (typeof body.key !== "string" || !body.key ||
      body.key.length > 200 || /[\/\\]/.test(body.key) || body.key === "." || body.key === "..")) {
    return c.json({ error: "invalid key" }, 400);
  }
  const store = db.collection<Owned & Record<string, unknown>>(body.collection);
  const scoped = (key: string) => (mine ? `${user.id}:${key}` : key);

  switch (body.op) {
    case "get": {
      const record = await store.get(scoped(String(body.key)));
      if (mine && record && record.__owner !== user.id) return c.json({ value: null });
      return c.json({ value: record ?? null });
    }
    case "put": {
      const value = body.value as Record<string, unknown>;
      const stored = mine ? { ...value, __owner: user.id } : value;
      await store.put(scoped(String(body.key)), stored);
      return c.json({ value: stored });
    }
    case "delete": {
      if (mine) {
        const record = await store.get(scoped(String(body.key)));
        if (record && record.__owner !== user.id) return c.json({ ok: true });
      }
      await store.delete(scoped(String(body.key)));
      return c.json({ ok: true });
    }
    case "list": {
      // A KV query answers with ONE page (default 100, max 500), so the loop is
      // what makes this "the collection" rather than "the first hundred rows".
      const items: { key: string; value: unknown; updated_at?: string }[] = [];
      const size = 500;
      for (let page = 1; ; page++) {
        const query = mine ? store.prefix(`${user.id}:`) : store.query();
        const rows = await query.page(page, size);
        for (const row of rows) {
          if (mine && (row.value as Owned).__owner !== user.id) continue;
          items.push({
            // Hand back the key the BROWSER used, not the stored one — the
            // owner prefix is the worker's business.
            key: mine ? row.key.slice(user.id.length + 1) : row.key,
            value: row.value,
            updated_at: row.updated_at,
          });
        }
        if (rows.length < size) break;
      }
      return c.json({ items });
    }
    default:
      return c.json({ error: "unknown op" }, 400);
  }
});

// ── files ────────────────────────────────────────────────────────────────────
app.put("/api/rc/files", async (c) => {
  const name = c.req.query("name");
  if (!name) return c.json({ error: "name required" }, 400);
  const contentType = c.req.header("content-type") || "application/octet-stream";
  return c.json(await files.put(name, await c.req.arrayBuffer(), contentType));
});

app.post("/api/rc/files/list", async (c) => c.json(await files.list()));

app.post("/api/rc/files/delete", async (c) => {
  const { name } = (await c.req.json()) as { name: string };
  await files.delete(name);
  return c.json({ ok: true });
});

// v1 handed the browser a signed URL. The worker streams the bytes instead, so
// deal attachments render on any storage backend rather than only on S3-backed
// instances (where `files.url()` works and elsewhere answers 501).
app.get("/api/rc/files/:name{.+}", async (c) => {
  const stored = await files.get(c.req.param("name"));
  if (!stored) return c.json({ error: "not found" }, 404);
  return stored;
});

// ── managed agents ───────────────────────────────────────────────────────────
// Automations hand sandbox work to agents: one measures an uploaded template's
// design system, another renders the .docx/.pptx and writes the result back into
// this app's store. Start-and-poll only — see the wrapper for why a worker
// cannot hold a run open.
app.post("/api/rc/agent", async (c) => {
  const body = (await c.req.json()) as { op: "start" | "get"; name?: string; requestId?: string; input?: unknown };
  if (body.op === "start") {
    if (!body.name) return c.json({ error: "name required" }, 400);
    return c.json(await agents.start(body.name, body.input));
  }
  if (body.op === "get") {
    if (!body.requestId) return c.json({ error: "requestId required" }, 400);
    return c.json(await agents.get(body.requestId));
  }
  return c.json({ error: "unknown op" }, 400);
});

// ── connectors ───────────────────────────────────────────────────────────────
// One named Granola connector. Change this name AND the manifest key when yours
// is called something else (for example granola-team).
//
// It MUST be a PER-USER connector (`railcode connector link granola --per-user`):
// each call then goes out with the signed-in member's own Granola account, so a
// member can only ever list and read their own meetings. A SHARED connector is
// refused. It holds one person's account, and every member who can open the CRM
// would be able to read all of that person's meetings and transcripts, not just
// the ones imported here. Only what someone imports becomes shared.
const GRANOLA_CONNECTOR = "granola";
const GRANOLA_TOOLS = new Set(["list_meetings", "get_meetings", "get_meeting_transcript"]);

type GranolaState =
  | { status: "ready" | "not_connected" | "linking" | "consent_required"; connectUrl: string | null }
  | { status: "shared" | "missing"; connectUrl: null };

// Asked before every call, and it fails closed: anything other than a per-user
// connector is "not usable". Under `railcode dev` this reads the DEPLOYED app's
// manifest, so deploy once before Granola works locally.
async function granolaState(): Promise<GranolaState> {
  try {
    const state = await connector(GRANOLA_CONNECTOR).connection();
    if (state.credentialMode !== "per_user") return { status: "shared", connectUrl: null };
    return { status: state.status, connectUrl: state.connectUrl };
  } catch (err) {
    // Not declared, not created yet, or withdrawn: setup to do.
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      return { status: "missing", connectUrl: null };
    }
    throw err;
  }
}

app.post("/api/rc/connectors", async (c) => {
  const body = (await c.req.json()) as {
    op: "connection" | "call"; name?: string; tool?: string; args?: Record<string, unknown>;
  };
  if (body.op === "connection") return c.json(await granolaState());
  if (body.op === "call") {
    if (body.name !== "granola" || !GRANOLA_TOOLS.has(body.tool ?? "")) {
      return c.json({ error: "connector tool not allowed" }, 403);
    }
    const state = await granolaState();
    if (state.status === "shared") {
      return c.json({ error: "Granola must be a per-user connector for this app" }, 403);
    }
    if (state.status === "missing") return c.json({ error: "Granola is not set up" }, 404);
    // A per-user call that still needs linking refuses with `connectionRequired`,
    // relayed verbatim by onError.
    return c.json(await connector(GRANOLA_CONNECTOR).call(body.tool!, body.args ?? {}));
  }
  return c.json({ error: "unknown op" }, 400);
});

// ── llm ──────────────────────────────────────────────────────────────────────
// ONE PLANNING TURN PER CALL. The tool loop runs in the browser, because Ask
// AI's write tools pause for a human approval card and a worker invocation has
// no inbound channel for that click. So these routes carry tool DEFINITIONS and
// hand back what the model asked for; the page executes the tools and threads
// the next turn.
type LlmBody = { input: string | LlmMessage[]; opts?: Partial<LlmOptions> };

app.get("/api/rc/llm/providers", async (c) => c.json(await llmProviders().catch(() => [])));

app.post("/api/rc/llm/generate", async (c) => {
  const body = (await c.req.json()) as LlmBody;
  return c.json(await llm.generate(body.input, (body.opts ?? {}) as LlmOptions));
});

app.post("/api/rc/llm/stream", async (c) => {
  const body = (await c.req.json()) as LlmBody;
  // toNdjson owns the two parts that are easy to get wrong: the 200 is already
  // committed when a mid-stream failure happens, so it rides the stream as an
  // error frame carrying the platform's typed code
  // (daily_token_limit_exceeded, provider_auth_error, …) — exactly where the
  // browser loop expects it — and a client that hangs up closes the run.
  return toNdjson(llm.stream(body.input, (body.opts ?? {}) as LlmOptions));
});

export default app;
