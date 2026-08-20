// The Railcode worker for the chat.
//
// Every capability this app has lives here: the LLM gateway, ad-hoc SQL, the
// PostHog connector, the store, the files. On v1 all of that ran in the page,
// which meant the browser held the authority to do it. Now the browser posts a
// question and reads back a stream.
//
// The other half of the port is isolation. v1 stored chat history in `db.user`,
// a private per-caller namespace the server enforced. A v2 app has ONE flat
// store shared by the whole org — so per-user isolation is this file plus
// keys.ts, and nothing else. See keys.ts for why the prefix alone is not enough.
import { Hono } from "hono";
import { ApiError, ctx, db, files, llmProviders, toNdjson } from "@railcode/sdk";

import { generateTitle, runAgent } from "./agent";
import {
  attachmentName,
  conversationKey,
  conversationPrefix,
  messageKey,
  messagePrefix,
  ownedBy,
  prefsKey,
} from "./keys";
import type {
  Attachment,
  ChatRequest,
  Conversation,
  Message,
  Prefs,
  StoredPrefs,
} from "../shared/types";

const PAGE_SIZE = 200;

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

const conversations = () => db.collection<Conversation>("conversations");
const messages = () => db.collection<Message>("messages");
const prefs = () => db.collection<StoredPrefs>("prefs");

// Records written before a field existed must not crash the read path — there
// are no migrations in KV, so every load backfills.
const hydrateMessage = (raw: Message): Message => ({
  ...raw,
  attachments: raw.attachments ?? [],
  steps: (raw.steps ?? []).map((step) => ({ ...step, thought: step.thought ?? "" })),
  error: raw.error ?? null,
  model: raw.model ?? null,
  usage: raw.usage ?? null,
});

const hydrateConversation = (raw: Conversation): Conversation => ({
  ...raw,
  preview: raw.preview ?? "",
  messageCount: raw.messageCount ?? 0,
  pinned: raw.pinned ?? false,
});

// ── identity + the model catalog ─────────────────────────────────────────────
app.get("/api/me", (c) => c.json({ user: caller() }));

// A nice-to-have: an org with no providers configured should still render the
// app, just without a picker.
app.get("/api/providers", async (c) => c.json(await llmProviders().catch(() => [])));

// ── preferences ──────────────────────────────────────────────────────────────
app.get("/api/prefs", async (c) => {
  const stored = await prefs().get(prefsKey(caller().id));
  return c.json(stored ?? null);
});

app.put("/api/prefs", async (c) => {
  const user = caller();
  const body = (await c.req.json()) as Prefs;
  const next: StoredPrefs = { ...body, owner: user.id };
  await prefs().put(prefsKey(user.id), next);
  return c.json(next);
});

// ── conversations ────────────────────────────────────────────────────────────
// The prefix query is what makes this one person's list. It is an index, not a
// fence — the fence is `ownedBy` on the by-key reads below.
app.get("/api/conversations", async (c) => {
  const user = caller();
  const rows = await conversations()
    .prefix(conversationPrefix(user.id))
    .orderBy("updatedAt", "desc")
    .page(1, PAGE_SIZE);
  return c.json(rows.map((r) => hydrateConversation(r.value)));
});

app.get("/api/conversations/:id/messages", async (c) => {
  const user = caller();
  const convId = c.req.param("id");
  const collected: Message[] = [];
  for (let page = 1; ; page += 1) {
    const rows = await messages()
      .prefix(messagePrefix(user.id, convId))
      .orderBy("key", "asc")
      .page(page, PAGE_SIZE);
    for (const row of rows) collected.push(hydrateMessage(row.value));
    if (rows.length < PAGE_SIZE) break;
  }
  return c.json(collected);
});

app.patch("/api/conversations/:id", async (c) => {
  const user = caller();
  const existing = ownedBy(await conversations().get(conversationKey(user.id, c.req.param("id"))), user);
  if (!existing) return c.json({ error: "not found" }, 404);
  const patch = (await c.req.json()) as Partial<Conversation>;
  const next: Conversation = {
    ...existing,
    // Only these three are the caller's to change. Spreading the patch wholesale
    // would let a request rewrite `owner` and hand the record to someone else.
    ...(patch.title !== undefined ? { title: String(patch.title).slice(0, 60) } : {}),
    ...(patch.pinned !== undefined ? { pinned: Boolean(patch.pinned) } : {}),
    ...(patch.preview !== undefined ? { preview: String(patch.preview).slice(0, 120) } : {}),
    updatedAt: new Date().toISOString(),
  };
  await conversations().put(conversationKey(user.id, next.id), next);
  return c.json(next);
});

app.delete("/api/conversations/:id", async (c) => {
  const user = caller();
  const convId = c.req.param("id");
  const existing = ownedBy(await conversations().get(conversationKey(user.id, convId)), user);
  if (!existing) return c.json({ error: "not found" }, 404);

  const doomed: Message[] = [];
  for (let page = 1; ; page += 1) {
    const rows = await messages().prefix(messagePrefix(user.id, convId)).page(page, PAGE_SIZE);
    for (const row of rows) doomed.push(row.value);
    if (rows.length < PAGE_SIZE) break;
  }
  await Promise.all([
    ...doomed.map((m) =>
      messages().delete(messageKey(user.id, convId, m.seq, m.id)).catch(() => undefined),
    ),
    // KV holds only the attachment metadata; the blobs need their own cleanup.
    ...doomed.flatMap((m) =>
      m.attachments.map((att) => files.delete(attachmentName(user.id, att.id)).catch(() => undefined)),
    ),
    conversations().delete(conversationKey(user.id, convId)),
  ]);
  return c.body(null, 204);
});

// ── attachments ──────────────────────────────────────────────────────────────
// The browser sends bytes and a display name and gets back an opaque id. The
// STORAGE name is built from the verified caller, so no request can name
// another member's blob — which is the whole of what `files.user` used to do.
app.post("/api/attachments", async (c) => {
  const user = caller();
  const id = crypto.randomUUID();
  const contentType = c.req.header("content-type") || "application/octet-stream";
  await files.put(attachmentName(user.id, id), await c.req.arrayBuffer(), contentType);
  return c.json({ id });
});

app.delete("/api/attachments/:id", async (c) => {
  const user = caller();
  await files.delete(attachmentName(user.id, c.req.param("id"))).catch(() => undefined);
  return c.body(null, 204);
});

// Resolve MANY thumbnail URLs in one call. A loop of files.url() is what
// exhausts an invocation's subrequest budget; files.urls() is one subrequest for
// the whole message. Names that no longer exist come back under `missing` rather
// than throwing, because a transcript naming a deleted upload is normal.
//
// Signed URLs need S3-backed storage. Where storage is local the platform
// answers 501, so this falls back to streaming through the route below — which
// is slower but always works, and means the app runs on every deployment.
app.post("/api/attachments/urls", async (c) => {
  const user = caller();
  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 100) : [];
  if (ids.length === 0) return c.json({ urls: {} });
  try {
    const batch = await files.urls(ids.map((id) => attachmentName(user.id, id)));
    const urls: Record<string, string> = {};
    for (const item of batch.items) {
      const id = item.name.split("/").pop();
      if (id) urls[id] = item.url;
    }
    return c.json({ urls });
  } catch (err) {
    if (err instanceof ApiError && err.status === 501) {
      const urls: Record<string, string> = {};
      for (const id of ids) urls[id] = `/api/attachments/${encodeURIComponent(id)}`;
      return c.json({ urls, streamed: true });
    }
    throw err;
  }
});

app.get("/api/attachments/:id", async (c) => {
  const user = caller();
  const stored = await files.get(attachmentName(user.id, c.req.param("id")));
  if (!stored) return c.json({ error: "not found" }, 404);
  return stored;
});

// ── one assistant turn ───────────────────────────────────────────────────────
// The only streaming route. The agent loop runs here; the browser reads ndjson
// and renders it. Both messages are persisted here too, so a turn cannot be
// half-saved by a browser that navigated away mid-answer.
app.post("/api/chat", async (c) => {
  const user = caller();
  const body = (await c.req.json()) as ChatRequest;
  const question = String(body.question ?? "").trim();
  const attachments: Attachment[] = Array.isArray(body.attachments) ? body.attachments : [];
  const convId = String(body.convId ?? "");
  if (!convId) return c.json({ error: "convId required" }, 400);
  if (!question && attachments.length === 0) return c.json({ error: "empty turn" }, 400);

  const now = new Date().toISOString();
  let conv = ownedBy(await conversations().get(conversationKey(user.id, convId)), user);
  const isNew = !conv;
  if (!conv) {
    conv = {
      id: convId,
      owner: user.id,
      title: question ? question.slice(0, 60) : "New chat",
      createdAt: now,
      updatedAt: now,
      preview: question.slice(0, 120),
      messageCount: 0,
      pinned: false,
    };
    await conversations().put(conversationKey(user.id, convId), conv);
  }

  const history: Message[] = [];
  for (let page = 1; ; page += 1) {
    const rows = await messages()
      .prefix(messagePrefix(user.id, convId))
      .orderBy("key", "asc")
      .page(page, PAGE_SIZE);
    for (const row of rows) history.push(hydrateMessage(row.value));
    if (rows.length < PAGE_SIZE) break;
  }

  const userMessage: Message = {
    id: crypto.randomUUID(),
    owner: user.id,
    convId,
    seq: history.length,
    role: "user",
    content: question,
    createdAt: now,
    attachments,
    steps: [],
    error: null,
    model: null,
    usage: null,
  };
  await messages().put(messageKey(user.id, convId, userMessage.seq, userMessage.id), userMessage);

  // The browser can hang up (the user pressed Stop, or navigated). Cancelling
  // the response closes the generator below, which aborts the loop — so an
  // abandoned turn stops costing tokens rather than running on unwatched.
  const conversation = conv;

  async function* frames(): AsyncGenerator<unknown> {
    // The stored user turn first, so the browser can swap its optimistic copy
    // for the record that actually exists.
    yield { type: "user", message: userMessage };

    let content = "";
    let saved: Message | null = null;
    // Closing the generator (a hang-up, or Stop) aborts this, which stops the
    // in-flight model request instead of letting it run on unwatched.
    const abort = new AbortController();

    try {
      for await (const event of runAgent({
        history,
        question,
        attachments,
        prefs: body.prefs,
        userName: user.name || user.email,
        signal: abort.signal,
      })) {
        yield event;
        if (event.type === "text") content += event.text;
        if (event.type === "done") {
          saved = {
            id: crypto.randomUUID(),
            owner: user.id,
            convId,
            seq: userMessage.seq + 1,
            role: "assistant",
            content: event.content || content,
            createdAt: new Date().toISOString(),
            attachments: [],
            steps: event.steps,
            error: event.stopReason === "aborted" ? "Stopped." : null,
            model: event.model,
            usage: event.usage,
          };
        }
        if (event.type === "error") {
          saved = {
            id: crypto.randomUUID(),
            owner: user.id,
            convId,
            seq: userMessage.seq + 1,
            role: "assistant",
            content,
            createdAt: new Date().toISOString(),
            attachments: [],
            steps: [],
            error: event.message,
            model: null,
            usage: null,
          };
        }
      }
    } finally {
      abort.abort();
      // Runs on a client hang-up too, so whatever streamed is still recorded.
      // Without this the browser's "Stop" would leave a conversation whose last
      // turn exists on screen and nowhere else.
      if (!saved && content) {
        saved = {
          id: crypto.randomUUID(),
          owner: user.id,
          convId,
          seq: userMessage.seq + 1,
          role: "assistant",
          content,
          createdAt: new Date().toISOString(),
          attachments: [],
          steps: [],
          error: "Stopped.",
          model: null,
          usage: null,
        };
      }
      if (saved) {
        await messages()
          .put(messageKey(user.id, convId, saved.seq, saved.id), saved)
          .catch(() => undefined);
        await conversations()
          .put(conversationKey(user.id, convId), {
            ...conversation,
            preview: (saved.content || question).slice(0, 120),
            messageCount: history.length + 2,
            updatedAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
    }

    if (saved) yield { type: "saved", message: saved };

    // Title last: it costs an LLM call, and a failure here must not affect the
    // conversation that was just saved successfully.
    if (isNew && question) {
      try {
        const title = await generateTitle(question, body.prefs?.model ?? null);
        if (title) {
          const current = await conversations().get(conversationKey(user.id, convId));
          if (current) {
            await conversations().put(conversationKey(user.id, convId), { ...current, title });
            yield { type: "title", title };
          }
        }
      } catch {
        /* keep the truncated-question fallback */
      }
    }
  }

  // toNdjson owns the parts that are easy to get wrong: a throw mid-stream
  // becomes a terminal error frame (the 200 is already sent by then, so it
  // cannot be a status), and a disconnect closes the generator.
  return toNdjson(frames());
});

export default app;
