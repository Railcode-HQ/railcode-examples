// The Railcode worker for the pitch-deck studio.
//
// The interesting half of this app is the handoff to a managed agent. The
// agent writes a real PDF in a sandbox: it reads every uploaded material,
// generates and runs a build script, and publishes the result. That takes
// minutes, and a worker invocation is ONE request with a finite subrequest
// budget and a token that expires — so the worker never waits for it.
//
// Instead: start the run, hand the browser a request_id, and let the browser
// poll. `agents.invoke()` exists for short runs and polls for you, but it
// throws AgentRunPending at its deadline, and a deck run would hit that
// deadline every time.
import { Hono } from "hono";
import { ApiError, agents, ctx, db, files } from "@railcode/sdk";

const AGENT = "pitch-deck-writer";

// Materials and generated decks share the app's one file store, so materials
// carry a prefix. The agent's system prompt knows the same rule — it treats
// `materials/*` as source and `deck-*.pdf` as its own past output.
const MATERIALS_PREFIX = "materials/";

interface VersionRecord {
  id: string;
  fileName: string;
  createdAt: string;
  context: string;
  summary: string;
  materialsUsed?: string[];
}

// The in-flight run for one member, so a page refresh reattaches to it instead
// of looking like nothing ever happened.
interface Job {
  requestId: string;
  startedAt: string;
}

const app = new Hono();

app.use("/api/*", async (c, next) => {
  if (!ctx.user) return c.json({ error: "no signed-in caller" }, 409);
  await next();
});

const caller = () => ctx.user!;

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

app.get("/api/me", (c) => c.json({ user: caller() }));

// ── materials ────────────────────────────────────────────────────────────────
app.get("/api/materials", async (c) => {
  const all = await files.list();
  return c.json(all.filter((f) => f.name.startsWith(MATERIALS_PREFIX)));
});

// The browser sends a DISPLAY name; the worker builds the storage name. That
// asymmetry is the point: a caller who could name the storage key could write
// over the agent's published decks, or read the store by naming anything in it.
// Prefixing here makes "materials only" structural rather than a check.
const storageName = (display: string) =>
  MATERIALS_PREFIX + display.replace(/^\/+/, "").replace(/\.{2,}/g, ".");

app.post("/api/materials", async (c) => {
  const display = c.req.query("name");
  if (!display) return c.json({ error: "name required" }, 400);
  const contentType = c.req.header("content-type") || "application/octet-stream";
  return c.json(await files.put(storageName(display), await c.req.arrayBuffer(), contentType));
});

app.delete("/api/materials/:name{.+}", async (c) => {
  await files.delete(storageName(c.req.param("name")));
  return c.body(null, 204);
});

// ── versions ─────────────────────────────────────────────────────────────────
// Nothing here writes a version. The AGENT does: its manifest grants it
// app_data_write on this app, and a v2 app's flat store IS the app scope the
// agent writes into. So the worker just reads a collection that fills itself.
app.get("/api/versions", async (c) => {
  const rows = await db
    .collection<VersionRecord>("versions")
    .query()
    .orderBy("createdAt", "desc")
    .page(1, 200);
  return c.json(rows.map((r) => r.value));
});

// Stream a generated deck. Named files only, and only ones a version record
// actually points at — otherwise this route would read out the whole store.
app.get("/api/versions/:id/pdf", async (c) => {
  const version = await db.collection<VersionRecord>("versions").get(c.req.param("id"));
  if (!version) return c.json({ error: "not found" }, 404);
  const stored = await files.get(version.fileName);
  if (!stored) return c.json({ error: "deck file is missing" }, 404);
  // Served inline, not as a download, so the browser can render it in an
  // <iframe> without the fetch-and-blob dance the v1 app needed.
  return new Response(stored.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${version.fileName.replace(/"/g, "")}"`,
    },
  });
});

// ── the agent handoff ────────────────────────────────────────────────────────
const jobKey = (userId: string) => `job:${userId}`;

app.post("/api/generate", async (c) => {
  const user = caller();
  const body = (await c.req.json().catch(() => ({}))) as { context?: unknown };
  const context = String(body.context ?? "").slice(0, 5_000).trim();

  // Refuse a second run while one is live. A run costs real sandbox minutes,
  // and two decks generated from the same materials at once is never what the
  // user meant.
  const existing = await db.collection<Job>("jobs").get(jobKey(user.id));
  if (existing) {
    const live = await agents.get(existing.requestId).catch(() => null);
    if (live && !["success", "failed", "cancelled", "limit_exceeded"].includes(live.status)) {
      return c.json({ requestId: existing.requestId, status: live.status }, 202);
    }
  }

  // Returns as soon as the run is QUEUED. The run outlives this invocation.
  const run = await agents.start(AGENT, { context });
  await db.collection<Job>("jobs").put(jobKey(user.id), {
    requestId: run.request_id,
    startedAt: new Date().toISOString(),
  });
  return c.json({ requestId: run.request_id, status: run.status }, 202);
});

// The poll target. A run is owned by (app, caller), so the platform already
// refuses to show one member another's run — this route adds no check of its
// own because there is nothing left to check.
app.get("/api/generate/:requestId", async (c) => {
  const run = await agents.get(c.req.param("requestId"));
  return c.json({
    requestId: run.request_id,
    status: run.status,
    error: run.error_message,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
  });
});

// What the browser asks on load: is one of my runs still going?
app.get("/api/generate", async (c) => {
  const job = await db.collection<Job>("jobs").get(jobKey(caller().id));
  if (!job) return c.json({ requestId: null });
  const run = await agents.get(job.requestId).catch(() => null);
  if (!run) return c.json({ requestId: null });
  return c.json({ requestId: run.request_id, status: run.status, startedAt: job.startedAt });
});

export default app;
