# chat

A chat interface over your connected data sources — the reference template for
building chat apps on Railcode **apps v2**.

Ask a question in plain language; the app plans which sources to query, runs the
queries, shows you each one, and streams an answer written from the results.

- **The agent loop runs in the worker.** The browser posts a question and reads
  back an ndjson stream. It never holds the LLM gateway, the SQL connection, or
  the PostHog credential.
- **Per-user history, enforced in code.** Conversations, messages, prefs and
  uploads are keyed by the verified caller and checked on every read.
- **Streaming answers** — token-by-token, with a stop button that really stops
  the model.
- **Visible tool calls** — every query is shown inline with its SQL, timing, and
  full result table, so an answer can be audited without leaving the chat.
- **File uploads** — drag, paste, or pick. Text files are inlined into the
  prompt; everything else is stored and referenced.
- **Two sources out of the box** — Postgres (text-to-SQL) and PostHog (HogQL +
  REST), each toggleable per conversation.

## Shape

```
frontend/          the React SPA (Vite root) — static files, zero authority
server/            the Hono worker — every capability the app has
shared/types.ts    the wire contract, imported by both halves
```

The CLI builds both. There is no bundler config for the worker, no `wrangler`,
and no Cloudflare package in `package.json`.

## Run it

```bash
npm install
railcode dev          # http://127.0.0.1:7331 (or the port it prints)
railcode deploy
```

Open the URL `railcode dev` prints, **not** the raw Vite URL — the worker only
exists behind the dev proxy, so `/api/*` 404s on the bare Vite server.

`railcode dev` emulates KV and files on local disk, but forwards LLM, SQL, and
connector calls to the real instance when you're logged in. That means real spend
and real data while developing.

## Where the authority lives

```
browser ──fetch('/api/chat')──▶ worker ──@railcode/sdk──▶ platform
   │                              │
   no credentials            ctx.user (verified, unforgeable)
   renders the stream        llm · adhoc_sql · connector · db · files
```

`manifest.yaml` declares `run_as: app`, which is mandatory on v2 and is also the
honest description: the chat needs authority its individual users may not hold.
The worker holds all of it. A rule not written in `server/` is not a rule —
anyone can `curl /api/*` from a signed-in session.

## Per-user isolation is your code now

This is the part to read before adapting anything (`server/keys.ts`).

The v1 chat used `db.user` and `files.user`: private per-caller namespaces the
server enforced. A v2 app has **one flat store, shared by the whole org**. So the
isolation is rebuilt in two halves, and both are needed:

1. **Keys carry the owner** — `${userId}:${convId}`, `${userId}:${convId}:${seq}:${id}`.
   A prefix query returns one person's records. That is an **index**, not a
   fence: the store will happily return any key asked for by name.
2. **Records carry `owner`, and by-key reads check it** against `ctx.user`. That
   check is the fence.

Skipping (2) is the classic v1→v2 porting bug. It looks isolated, it reads
correctly in testing, and any member who can guess another member's id can read
their entire history. `ownedBy()` returns `null` for both "absent" and "someone
else's", so the app answers 404 rather than confirming a conversation exists.

The same rule applies to blobs: the browser posts bytes and gets back an **opaque
id**; the worker derives the storage name (`attachments/${userId}/${id}`) from
the verified caller. A caller may name something inside their own space, never
the space.

## How the agent loop works

**The SDK runs the loop, inside the worker.** `llm.stream({ tools })` takes the
tool definitions and drives everything: the model plans, the SDK validates each
call's arguments against the tool's JSON Schema, runs it in the invocation, feeds
the summarized result back, and repeats until the model writes its answer. Text
streams live throughout — including any preamble before a tool call — so tool use
and token-by-token output come from one generation.

The worker re-serializes those events as ndjson and the browser renders them, so
what the user watches arrive is the same stream the model produced.

The app supplies three things (`server/agent.ts`, `server/tools.ts`):

1. **The tools** — `{ name, description, schema, run, summarize }` objects. `run`
   is an SDK call (`data(conn).runSQL`, `connector("posthog").fetch`), and it
   runs in the worker. Only `{ name, description, schema }` crosses the wire to
   the gateway.
2. **The system prompt** — role, the introspected Postgres schema, and the rules
   for writing the answer.
3. **The bounds** — `limits: { maxSteps, maxToolCalls, timeoutMs }`.

### The display/observation split

This is the part worth copying. A tool's `run` return value is the **raw** result
and reaches the UI as `step.result`; the model only ever sees
`summarize(result)`, clipped to ~6,000 characters. So each tool here returns a
full `ToolResult` — `rows`, `columns`, `raw` for the transcript's result table —
while `summarize` hands the model just the compact `observation`. The user sees
every row; the model pays tokens for a preview.

`toUiStep()` maps an SDK step onto the card the transcript renders. Each executed
call emits a `step` event **twice** — status `running`, then `ok`/`error`, with
the same `step.id` — so the store upserts by id rather than appending.

### The worker persists the turn

Both messages are written by the same request that streams the answer, and the
`user`/`saved` frames hand the stored records back so the browser swaps its
optimistic copies for the real ones. A browser that closes mid-answer still
leaves a complete conversation behind — which the v1 app, saving from the page,
could not promise.

### Errors and bounds are not exceptions

A rejected non-SELECT, a bad argument, a PostHog 403 — all are fed back to the
model as the tool result rather than thrown into app code, so a recoverable
mistake costs one step instead of the whole turn.

The gateway's typed error codes (`daily_token_limit_exceeded`,
`provider_auth_error`, …) ride the ndjson stream and reach the browser
unchanged, so `lib/errors.ts` still turns each into advice with a fix in it.
HTTP failures are relayed with their original status for the same reason.

Cancellation: `stop()` aborts the fetch, which hangs up the response, which
cancels the loop in the worker. Bounded runs settle with a `stopReason` —
`max_steps` and `timeout` can leave the text empty, and `stopReasonNote()` turns
that into a message rather than a blank turn.

## Data model

There are no migrations in Railcode KV, so the TypeScript types in
`shared/types.ts` *are* the schema, and every read backfills missing fields
(`hydrateMessage` in the worker).

| What | Collection | Key |
| --- | --- | --- |
| Conversations | `conversations` | `${userId}:${convId}` |
| Messages | `messages` | `${userId}:${convId}:${seq}:${id}` |
| Preferences | `prefs` | `${userId}` |
| Attachments | file store | `attachments/${userId}/${id}` |

The message key format is the one decision that's expensive to change later. The
sequence number is zero-padded because KV orders keys lexicographically — without
padding, message 10 sorts before message 9. With it, a prefix query returns a
conversation already in send order and nothing is sorted afterwards.

Every list read pages until a short page. A KV query answers with **one** page
(default 100, max 500), so an un-paged read silently becomes "the first 100".

## Sources

Both are declared in `manifest.yaml` and ratified at deploy.

**Postgres** uses `adhoc_sql` — direct, model-authored SQL. This is scarce
authority and the default advice is saved queries; it's used here because
text-to-SQL is the entire point of the template. Two things make it safe:
connections are read-only server-side, and `server/sql.ts` rejects anything that
isn't a single `SELECT`/`WITH` before it is ever sent, checking against a copy
with string literals and comments blanked out so a table named `orders_update`
doesn't trip the keyword filter. It also appends a `LIMIT`.

The schema is introspected once per worker isolate and inlined into the system
prompt (`server/schema.ts`). Without it the model invents plausible-but-wrong
tables. The cache is per isolate, never per caller — the digest is org schema,
the same for everyone.

**PostHog** goes through a service connector, so the API key never reaches the
worker, let alone the browser. `manifest.yaml` lists the exact endpoints the
tools may call, which doubles as an allowlist — anything else is a 403 at the
proxy.

PostHog keys are scoped per resource. A missing scope comes back as a 403 naming
the scope, and `server/tools.ts` surfaces that verbatim so the fix is obvious.

## Attachments and the subrequest budget

Image thumbnails resolve in **one** call per message: the worker uses
`files.urls()`, a single subrequest for the whole batch. A loop of `files.url()`
is exactly what exhausts an invocation's budget.

Signed URLs need S3-backed storage. Where storage is local the platform answers
501, so the route falls back to streaming the bytes through the worker — slower,
but it means the app runs on every deployment rather than only some.

## Adapting it

- **Swap the sources** — add a tool in `buildTools()` (`server/tools.ts`) and add
  its name to `ToolName` in `shared/types.ts`. Its `description` is the model's
  only manual, so say what the tool is for *and* how to use it well. Return a
  `ToolResult` from `run` and point `summarize` at the compact form; extend
  `detailFromArgs()` so the card shows something useful while the call is still
  running.
- **Swap the suggestions** — `frontend/src/components/EmptyState.tsx` is written
  against the demo support dataset.
- **Restrict access** — new apps default to `organization` access. Chat history
  is per-user, but the app itself is visible to the whole org until you set
  `private`/`restricted`.

## Notes

- No markdown or icon dependencies: `frontend/src/lib/markdown.tsx` renders a
  subset as React elements (never `dangerouslySetInnerHTML`, so model output
  can't inject markup), and icons are inline SVG.
- Streaming tokens are buffered into one `requestAnimationFrame`-aligned state
  update, so a fast stream doesn't queue a React render per token.
- The dark theme is an addition to the org design system, which is specified
  light-only. It remaps the same token names under
  `prefers-color-scheme: dark`.
