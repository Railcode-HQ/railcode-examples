// The Railcode worker. A Hono app IS a fetch handler, so the `export default
// app` at the bottom is the whole backend the platform runs.
//
// Everything the board can do lives here, because on apps v2 this is the only
// place with credentials and a verified caller. The frontend is static files:
// it fetches these routes and nothing else. Anyone can call /api/* directly
// from a signed-in session with curl, so a rule that is not written here is
// not a rule.
import { Hono } from "hono";
import { ApiError, appUsers, ctx, db, files } from "@railcode/sdk";

// One flat KV namespace, so keys carry whatever structure the app needs. This
// board is shared — every member reads and edits every card — so the key is
// just the card id. An app with per-user records would prefix instead
// (`${user.id}:${id}`), but a prefix is only a convention: it hides nothing on
// its own, and the check in the worker is what makes it mean something.
//
// Ownership is recorded INSIDE the record as well, so a read can be verified
// without re-parsing a key. Delete uses it below.
const CARDS = "cards";

interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  uploaded_at: string;
}

interface Card {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  tags: string[];
  assignee: string | null;
  attachments: Attachment[];
  created_by: string;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  order: number;
}

const app = new Hono();

// ── the caller ───────────────────────────────────────────────────────────────
// ctx.user was verified at the platform gate and travels in the invocation
// token. App code cannot fake it. It is null only on cron triggers, which this
// app has none of — so one guard up front lets every route below rely on it.
app.use("/api/*", async (c, next) => {
  if (!ctx.user) return c.json({ error: "no signed-in caller" }, 409);
  await next();
});

const caller = () => ctx.user!;

// Relay a platform error as itself. Collapsing a 403 or a 429 into a 500 throws
// away the only thing the browser could have acted on. The body is already
// JSON, so it is passed through untouched rather than re-wrapped.
app.onError((err) => {
  if (err instanceof ApiError) {
    return new Response(err.message || JSON.stringify({ error: "error" }), {
      status: err.status,
      headers: { "content-type": "application/json" },
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new Response(JSON.stringify({ error: "worker_error", message }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
});

app.get("/api/me", (c) => c.json({ user: caller() }));

// The org member directory, for the assignee picker. This is the app's own
// authority (run_as: app), not the caller's.
app.get("/api/users", async (c) => c.json(await appUsers()));

// ── cards ────────────────────────────────────────────────────────────────────
// A flat store returns ONE page per query (default 100, max 500). Paging until
// a short page is the difference between "the board" and "the first 100 cards".
async function allCards(): Promise<Card[]> {
  const out: Card[] = [];
  const size = 500;
  for (let page = 1; ; page++) {
    const rows = await db.collection<Card>(CARDS).query().orderBy("created_at", "asc").page(page, size);
    for (const row of rows) if (row.value?.id) out.push(row.value);
    if (rows.length < size) break;
  }
  return out;
}

const findCard = (id: string) => db.collection<Card>(CARDS).get(id);

app.get("/api/cards", async (c) => c.json(await allCards()));

app.post("/api/cards", async (c) => {
  const user = caller();
  const body = (await c.req.json().catch(() => ({}))) as Partial<Card>;
  const title = String(body.title ?? "").trim().slice(0, 500) || "Untitled";
  const now = new Date().toISOString();
  const status = String(body.status ?? "todo");
  const card: Card = {
    id: crypto.randomUUID(),
    title,
    description: String(body.description ?? "").slice(0, 20_000),
    status,
    priority: Number(body.priority ?? 2),
    tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : [],
    assignee: body.assignee ? String(body.assignee) : null,
    attachments: [],
    // The creator comes from the verified caller, never from the body.
    created_by: user.id,
    created_at: now,
    updated_at: now,
    done_at: status === "done" ? now : null,
    order: Number(body.order ?? 0),
  };
  await db.collection<Card>(CARDS).put(card.id, card);
  return c.json(card, 201);
});

// Editing is open to the whole team: a shared board where only the author can
// move a card is not a shared board. What the caller may NOT do is rewrite the
// card's identity, so id/created_by/created_at are taken from the stored record
// and the patch cannot reach them.
app.patch("/api/cards/:id", async (c) => {
  const prev = await findCard(c.req.param("id"));
  if (!prev) return c.json({ error: "not found" }, 404);
  const patch = (await c.req.json().catch(() => ({}))) as Partial<Card>;
  const next: Card = {
    ...prev,
    ...patch,
    id: prev.id,
    created_by: prev.created_by,
    created_at: prev.created_at,
    attachments: prev.attachments,
    updated_at: new Date().toISOString(),
  };
  if (patch.status && patch.status !== prev.status) {
    next.done_at = patch.status === "done" ? (prev.done_at ?? next.updated_at) : null;
  }
  await db.collection<Card>(CARDS).put(next.id, next);
  return c.json(next);
});

// Delete is the one asymmetric rule, and it is the reason this app has a
// worker at all: the creator or an org admin, nobody else. `is_admin` arrives
// as information on the verified caller — turning it into permission is this
// line, in a place the browser cannot reach.
app.delete("/api/cards/:id", async (c) => {
  const user = caller();
  const card = await findCard(c.req.param("id"));
  if (!card) return c.json({ error: "not found" }, 404);
  if (card.created_by !== user.id && !user.is_admin) {
    return c.json({ error: "only the card's author or an org admin can delete it" }, 403);
  }
  await db.collection(CARDS).delete(card.id);
  // Best effort: drop the blobs too, so they don't linger as orphans.
  await Promise.all(card.attachments.map((a) => files.delete(a.id).catch(() => {})));
  return c.body(null, 204);
});

// ── attachments ──────────────────────────────────────────────────────────────
// The worker holds the bytes, so an upload is one PUT and a download is a
// streamed Response. Serving them through a route of our own also means the
// board works on every storage backend; `files.url()` / `files.urls()` mint
// signed URLs instead, but only where storage is S3-backed.
app.post("/api/cards/:id/attachments", async (c) => {
  const card = await findCard(c.req.param("id"));
  if (!card) return c.json({ error: "not found" }, 404);
  const name = c.req.query("name") || "attachment";
  const contentType = c.req.header("content-type") || "application/octet-stream";
  const bytes = await c.req.arrayBuffer();
  // The stored name is an opaque id, so one card's upload can never collide
  // with another's and the display name stays free-form.
  const attachment: Attachment = {
    id: crypto.randomUUID(),
    name: name.slice(0, 255),
    contentType,
    size: bytes.byteLength,
    uploaded_at: new Date().toISOString(),
  };
  await files.put(attachment.id, bytes, contentType);
  const next: Card = {
    ...card,
    attachments: [...card.attachments, attachment],
    updated_at: new Date().toISOString(),
  };
  await db.collection<Card>(CARDS).put(next.id, next);
  return c.json(next, 201);
});

app.delete("/api/cards/:id/attachments/:attachmentId", async (c) => {
  const card = await findCard(c.req.param("id"));
  if (!card) return c.json({ error: "not found" }, 404);
  const attachmentId = c.req.param("attachmentId");
  const next: Card = {
    ...card,
    attachments: card.attachments.filter((a) => a.id !== attachmentId),
    updated_at: new Date().toISOString(),
  };
  await db.collection<Card>(CARDS).put(next.id, next);
  await files.delete(attachmentId).catch(() => {});
  return c.json(next);
});

// Stream one attachment back. The id is checked against the card it claims to
// belong to, so the route cannot be used to enumerate the app's file store.
app.get("/api/cards/:id/attachments/:attachmentId", async (c) => {
  const card = await findCard(c.req.param("id"));
  const attachmentId = c.req.param("attachmentId");
  const attachment = card?.attachments.find((a) => a.id === attachmentId);
  if (!attachment) return c.json({ error: "not found" }, 404);
  const stored = await files.get(attachment.id);
  if (!stored) return c.json({ error: "not found" }, 404);
  return new Response(stored.body, {
    headers: {
      "content-type": attachment.contentType,
      "content-disposition": `inline; filename="${attachment.name.replace(/"/g, "")}"`,
    },
  });
});

export default app;
