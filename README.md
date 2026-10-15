# railcode-examples

Examples and templates for Railcode apps and agents. Every app here is
**generation 2**: a static frontend plus a backend worker, built and deployed as
one unit by the Railcode CLI.

| Example | What it is | Showcases |
| --- | --- | --- |
| [`apps/kanban`](apps/kanban) | A kanban board with drag-and-drop columns, a list view, and a command palette. | The plainest worker app: a Hono worker, the flat store, and one asymmetric rule (only a card's author or an org admin may delete it) written where no caller can reach it. |
| [`apps/chat`](apps/chat) | A chat interface over your connected data sources (Postgres text-to-SQL, PostHog HogQL). | The agent loop running server-side and streaming ndjson to the page; per-user isolation rebuilt as keys plus an owner check; batched file URLs with a fallback. |
| [`apps/crm`](apps/crm) | A full CRM — companies, contacts, pipeline, activity, automations — with an **Ask AI** agent that can read and change anything a person could. | A 20k-line v1 app ported through ONE module; the tool loop that had to stay in the browser because its writes wait for a human; managed agents deployed alongside an app. |
| [`agents/pitch-deck`](agents/pitch-deck) | An app for uploading company materials, paired with an agent that writes a polished pitch-deck PDF from them. | `agents.start()` + poll, because a worker cannot hold a minutes-long run open; a run that reattaches after a refresh; agent output arriving in the app's own store with no bridge. |
| [`agents/proposals`](agents/proposals) | An agent that watches your Granola meetings on a 30-minute cron and drafts an editable `.docx` proposal whenever a call clearly ended with "send us a proposal", paired with an app that just displays them. | Why the schedule belongs to the AGENT and not the app (cron has no caller, so it cannot start a run); a scheduled org agent writing shared records/files, with scheduler-enforced overlap prevention. |

Apps live under `apps/`; the `agents/` examples pair an app with a managed
agent, because agents can't own files or storage directly — they work through an
app they have data access to.

## The shape they all share

```
frontend/          the client (Vite root) — static files, zero authority
server/index.ts    the Hono worker — every credential the app has
manifest.yaml      the authority the app declares, ratified at deploy
railcode.json      { app, type: "hono+vite", dist, server }
```

```
browser ──fetch('/api/…')──▶ your worker ──@railcode/sdk──▶ platform
   │                              │
   no credentials            ctx.user (verified, unforgeable)
   no authority              all authority lives here
```

The frontend holds nothing and proves nothing. Any check it makes is a UX
affordance: a user can call `/api/*` directly from a signed-in session, so
**every rule must also exist in the worker**. That single fact is what most of
the code comments in these examples are about.

Two consequences worth internalising before adapting any of them:

- **The flat store enforces nothing.** A v2 app has one KV namespace, shared by
  the whole org. A key prefix is a convention and an index; the check against
  `ctx.user` is what makes it a boundary. `apps/chat` and `apps/crm` both rebuild
  per-user privacy this way, and say so where they do it.
- **A worker invocation is one request.** Finite subrequests, an expiring token.
  Anything longer — a document, a deck, a research run — is a managed agent you
  `start()` and poll, never something you wait for.

## Running one

```bash
cd apps/kanban
npm install           # or pnpm install
railcode dev          # http://127.0.0.1:7331 (or the port it prints)
railcode deploy
```

Open the URL `railcode dev` prints, **not** the raw Vite URL — the worker only
exists behind the dev proxy, so `/api/*` 404s on the bare Vite server.

These examples target `@railcode/sdk` 0.5.0 and the `railcode` CLI 0.3.9.
The agent companion apps include npm lockfiles; use `npm ci` there for the
validated dependency tree. Plain app templates use their declared version ranges.

## Regression checks

Install each example's dependencies first, then run the repository tests:

```bash
npm ci
npm test
```

The suite bundles all five workers and exercises their routes through the real
SDK with a mocked platform. It tests privacy, path validation, connector policy,
attachment deletion and the scheduled proposal workflow without live calls.
Run `npm run check`, `npx vite build`, and `railcode manifest validate` from
each example as well. The root esbuild dependency is only for this test harness;
Railcode still owns each app's production worker build.
