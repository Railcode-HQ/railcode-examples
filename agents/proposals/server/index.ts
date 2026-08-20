// The Railcode worker for the proposals reader.
//
// This app is mostly a READER: a personal agent runs on its own 30-minute
// schedule, reads the owner's Granola meetings, and writes proposal records
// and .docx files into this app's store. The worker reads what the agent left.
//
// The one thing it triggers is Run now, and the shape of that is the lesson:
//
//   The schedule lives on the AGENT, not on this app. A cron invocation has no
//   caller, a run is owned by (app, user), so agents.start() from cron is a
//   409. Correct, not a gap — a run of a PERSONAL agent with no owner has no
//   Granola account to read.
import { Hono } from "hono";
import { ApiError, agents, ctx, db, files } from "@railcode/sdk";

const AGENT = "proposal-writer";
const RUN_KEY = "manualRun";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface ProposalRecord {
  id: string;
  fileName: string;
  title: string;
  createdAt: string;
  edited?: boolean;
  editedAt?: string;
  editedBy?: string;
  [key: string]: unknown;
}

interface ManualRun {
  requestId: string;
  startedAt: string;
  startedBy?: string;
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

const proposals = () => db.collection<ProposalRecord>("proposals");
// The same `state` collection the agent writes `scout` into, under its own key.
const state = () => db.collection<Record<string, unknown>>("state");

app.get("/api/me", (c) => c.json({ user: caller() }));

// Everything the page needs, in ONE round trip. The v1 page made three separate
// platform calls from the browser; the worker is already next to the data, so
// fanning out here and answering once is strictly cheaper.
app.get("/api/state", async (c) => {
  const [rows, scout, manualRun] = await Promise.all([
    proposals().query().orderBy("createdAt", "desc").page(1, 200),
    state().get("scout"),
    state().get(RUN_KEY),
  ]);
  return c.json({
    proposals: rows.map((r) => r.value),
    scout: scout ?? null,
    manualRun: manualRun ?? null,
  });
});

// ── the document ─────────────────────────────────────────────────────────────
// Streamed through the worker, so the editor gets bytes from a plain URL on any
// storage backend. Only files a proposal record names are served.
app.get("/api/proposals/:id/docx", async (c) => {
  const record = await proposals().get(c.req.param("id"));
  if (!record) return c.json({ error: "not found" }, 404);
  const stored = await files.get(record.fileName);
  if (!stored) return c.json({ error: "document is missing" }, 404);
  return new Response(stored.body, {
    headers: {
      "content-type": DOCX_MIME,
      "content-disposition": `inline; filename="${(record.fileName.split("/").pop() ?? "proposal.docx").replace(/"/g, "")}"`,
    },
  });
});

// Save an edit. The worker writes the file under the record's OWN name — the
// browser never says where the bytes land, so an edit cannot become a write to
// some other proposal, or to one of the agent's ledger files.
app.put("/api/proposals/:id/docx", async (c) => {
  const user = caller();
  const record = await proposals().get(c.req.param("id"));
  if (!record) return c.json({ error: "not found" }, 404);
  await files.put(record.fileName, await c.req.arrayBuffer(), DOCX_MIME);
  const next: ProposalRecord = {
    ...record,
    edited: true,
    editedAt: new Date().toISOString(),
    // Attribution comes from the verified caller, not from the request body.
    editedBy: user.name || user.email,
  };
  await proposals().put(record.id, next);
  return c.json(next);
});

// ── Run now ──────────────────────────────────────────────────────────────────
app.post("/api/run", async (c) => {
  const user = caller();
  // `agents.start` rather than `agents.invoke`: a run is allowed 300 seconds and
  // invoke would spend the invocation's subrequest budget polling for all of
  // them. Nothing is passed as input, and that is not an oversight — the agent
  // declares no input_schema and decides what to do from its own ledger.
  const run = await agents.start(AGENT);
  const marker: ManualRun = {
    requestId: run.request_id,
    startedAt: new Date().toISOString(),
    startedBy: user.name || user.email,
  };
  // The marker is SHARED on purpose: it is what stops a second tab, or a
  // colleague, from starting a run on top of one already going. Overlapping
  // runs are the one thing the agent's ledger cannot defend against.
  await state().put(RUN_KEY, marker as unknown as Record<string, unknown>);
  return c.json(marker, 202);
});

// Poll one run. A run belongs to (app, caller), so the platform answers 404 for
// a colleague's run — which is not an error here: the marker is shared, so
// another member's tab knows a run is going and simply cannot watch its status.
app.get("/api/run/:requestId", async (c) => {
  try {
    const run = await agents.get(c.req.param("requestId"));
    return c.json({
      mine: true,
      status: run.status,
      errorCode: run.error_code,
      errorMessage: run.error_message,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return c.json({ mine: false, status: "running" });
    }
    throw err;
  }
});

// Release the in-flight marker once a run is done. Advisory: if this fails the
// marker ages out on the client's staleness cutoff instead of blocking forever.
app.delete("/api/run", async (c) => {
  await state().delete(RUN_KEY);
  return c.body(null, 204);
});

export default app;
