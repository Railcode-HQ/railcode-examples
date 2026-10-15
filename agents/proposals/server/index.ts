// Shared proposal reader/editor. The org agent runs on its own schedule.
// Only the scheduler starts runs: it atomically skips overlap across replicas.
// The flat app KV store cannot provide an equivalent lock for manual starts.
import { Hono } from "hono";
import { ApiError, ctx, db, files } from "@railcode/sdk";

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
  const [rows, scout] = await Promise.all([
    proposals().query().orderBy("createdAt", "desc").page(1, 200),
    state().get("scout"),
  ]);
  return c.json({
    proposals: rows.map((r) => r.value),
    scout: scout ?? null,
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

export default app;
