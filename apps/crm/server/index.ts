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
  personalConnections,
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
// across the extra hop: 403 "not authorized", 409 "connect your account",
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
// One route for the whole store, because the browser wrapper is one Collection
// shape. `mine: true` is the old db.user: the worker prefixes the key with the
// verified caller's id AND stamps the record, then refuses to return one whose
// owner is somebody else.
//
// The prefix on its own would only be an index. The owner check is the fence,
// and leaving it out is the classic v1→v2 porting bug — it looks isolated right
// up until someone guesses another member's id.
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
  const mine = Boolean(body.mine);
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

// ── personal connectors ──────────────────────────────────────────────────────
// The caller's OWN connected accounts (Granola, Google Calendar), never the
// org's. Every call here acts as ctx.user, and the manifest's
// `personal_connectors:` is the bound on which of their accounts this app may
// drive — undeclared is a 403, unconnected is a 409 the UI turns into a
// "Connect your account" prompt.
app.post("/api/rc/pc", async (c) => {
  const body = (await c.req.json()) as {
    op: "list" | "connect" | "tools" | "call";
    toolkit?: string;
    tool?: string;
    args?: Record<string, unknown>;
  };
  switch (body.op) {
    case "list":
      return c.json(await personalConnections.list());
    case "connect":
      return c.json(await personalConnections.connect(String(body.toolkit)));
    case "tools":
      return c.json(await personalConnections.tools(String(body.toolkit)));
    case "call":
      return c.json(
        await personalConnections.call(String(body.toolkit), String(body.tool), body.args ?? {}),
      );
    default:
      return c.json({ error: "unknown op" }, 400);
  }
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
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        for await (const event of llm.stream(body.input, (body.opts ?? {}) as LlmOptions)) {
          send(event);
        }
      } catch (err) {
        // The 200 is already committed, so a mid-stream failure cannot be an
        // HTTP status. Dig the platform's typed code
        // (daily_token_limit_exceeded, provider_auth_error, …) out of the body
        // and ride it on the stream, exactly where the browser loop expects it.
        send(errorEvent(err));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
      // Tells any buffering proxy to pass bytes straight through; without it a
      // token-by-token stream arrives as one lump at the end.
      "x-accel-buffering": "no",
    },
  });
});

function errorEvent(err: unknown): { type: "error"; error: string; message: string } {
  if (err instanceof ApiError) {
    let error = "provider_error";
    let message = err.message;
    try {
      const body = JSON.parse(err.message) as Record<string, unknown>;
      const detail = (body.detail ?? body) as Record<string, unknown> | string;
      if (typeof detail === "object" && detail) {
        if (typeof detail.error === "string") error = detail.error;
        if (typeof detail.message === "string") message = detail.message;
      } else if (typeof detail === "string") {
        message = detail;
      }
    } catch {
      /* not JSON — keep the raw body as the message */
    }
    return { type: "error", error, message };
  }
  return {
    type: "error",
    error: "wire_error",
    message: err instanceof Error ? err.message : String(err),
  };
}

export default app;
