# chat

A chat interface over your connected data sources — the reference template for
building chat apps on Railcode.

Ask a question in plain language; the app plans which sources to query, runs the
queries, shows you each one, and streams an answer written from the results.

- **Per-user history** — conversations, messages, prefs and uploads all live in
  the caller's private scope. No key-prefixing, no leakage between users.
- **Streaming answers** — token-by-token, with a stop button.
- **Visible tool calls** — every query is shown inline with its SQL, timing, and
  full result table, so an answer can be audited without leaving the chat.
- **File uploads** — drag, paste, or pick. Text files are inlined into the
  prompt; everything else is stored and referenced.
- **Two sources out of the box** — Postgres (text-to-SQL) and PostHog (HogQL +
  REST), each toggleable per conversation.

## Run it

```bash
npm install
railcode dev          # http://127.0.0.1:7331 (or the port it prints)
```

Open the URL `railcode dev` prints, **not** the raw Vite URL — the SDK is served
at `/_api/sdk.js` by the dev proxy, and the app fails loudly if it's missing.

`railcode dev` emulates identity, KV, and files on local disk, but forwards LLM,
SQL, and connector calls to the real instance when you're logged in. That means
real spend and real data while developing.

```bash
npm run build         # tsc + vite
railcode deploy
```

## How the agent loop works

This is the part worth understanding before adapting the template.

**The SDK runs the loop.** `llm.stream({ tools })` takes the tool definitions and
drives everything: the model plans, the SDK validates each call's arguments
against the tool's JSON Schema, runs it in the page, feeds the summarized result
back, and repeats until the model writes its answer. Text streams live
throughout — including any preamble before a tool call — so tool use and
token-by-token output come from one generation.

The app supplies three things (`src/lib/agent.ts`, `src/lib/tools.ts`):

1. **The tools** — `{ name, description, schema, run, summarize }` objects. `run`
   is just the SDK call the app already makes (`data(conn).runSQL`,
   `connector("posthog").fetch`).
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

### Errors and bounds are not exceptions

A rejected non-SELECT, a bad argument, a PostHog 403 — all are fed back to the
model as the tool result rather than thrown into app code, so a recoverable
mistake costs one step instead of the whole turn.

Cancellation works the same way: `stop()` aborts an `AbortSignal` and the run
resolves **normally** with `stopReason: "aborted"`. Branch on `stopReason`, not
`try`/`catch` — and check it before rendering, because `max_steps` and `timeout`
can leave the text empty (`stopReasonNote()` turns that into a message).

## Data model

There are no migrations in Railcode KV, so the TypeScript types in
`src/lib/types.ts` *are* the schema, and every read backfills missing fields
(`hydrateMessage` in the store).

| What | Where | Key |
| --- | --- | --- |
| Conversations | `db.user.collection("conversations")` | `convId` |
| Messages | `db.user.collection("messages")` | `${convId}:${seq}:${id}` |
| Preferences | `db.user.collection("prefs")` | `prefs` |
| Attachments | `files.user` | `attachments/${id}` |

The message key format is the one decision that's expensive to change later. The
sequence number is zero-padded because KV orders keys lexicographically — without
padding, message 10 sorts before message 9. With it, `prefix(convId + ":")`
returns a conversation already in send order and nothing is sorted client-side.

## Sources

Both are declared in `manifest.yaml` and ratified at deploy.

**Postgres** uses `adhoc_sql` — direct, model-authored SQL. This is scarce
authority and the skill's default is saved queries; it's used here because
text-to-SQL is the entire point of the template. Two things make it safe:
connections are read-only server-side, and `src/lib/sql.ts` rejects anything that
isn't a single `SELECT`/`WITH` before it leaves the browser, checking against a
copy with string literals and comments blanked out so a table named
`orders_update` doesn't trip the keyword filter. It also appends a `LIMIT`.

The schema is introspected once per session and inlined into the system prompt
(`src/lib/schema.ts`). Without it the model invents plausible-but-wrong tables.

**PostHog** goes through a service connector, so the API key never reaches the
browser. `manifest.yaml` lists the exact endpoints the tools may call, which
doubles as an allowlist — anything else is a 403 at the proxy.

PostHog keys are scoped per resource. A missing scope comes back as a 403 naming
the scope, and `src/lib/tools.ts` surfaces that verbatim so the fix is obvious
rather than showing a generic failure.

## Adapting it

- **Swap the sources** — add a tool in `buildTools()` (`src/lib/tools.ts`) and add
  its name to `ToolName`. Its `description` is the model's only manual, so say
  what the tool is for *and* how to use it well. Return a `ToolResult` from `run`
  and point `summarize` at the compact form; extend `detailFromArgs()` so the card
  shows something useful while the call is still running.
- **Swap the suggestions** — `src/components/EmptyState.tsx` is written against
  the demo support dataset.
- **Restrict access** — new apps default to `organization` access. Chat history
  is per-user, but the app itself is visible to the whole org until you set
  `private`/`restricted`.

## Notes

- No markdown or icon dependencies: `src/lib/markdown.tsx` renders a subset as
  React elements (never `dangerouslySetInnerHTML`, so model output can't inject
  markup), and icons are inline SVG.
- Streaming tokens are buffered into one `requestAnimationFrame`-aligned state
  update, so a fast stream doesn't queue a React render per token.
- The dark theme is an addition to the org design system, which is specified
  light-only. It remaps the same token names under
  `prefers-color-scheme: dark`.
