# CRM

React + Vite + Zustand + Tailwind on **Railcode apps v2**: a static frontend
plus a Hono worker.

## Run Locally

```bash
npm install
railcode dev          # http://127.0.0.1:7331 (or the port it prints)
railcode deploy
```

Open the URL `railcode dev` prints, **not** the raw Vite URL — the worker only
exists behind the dev proxy, so `/api/rc/*` 404s on the bare Vite server. Local
KV and files live under `~/.railcode/dev/crm`; LLM, agent and connector calls go
to the real instance.

## Structure

```text
frontend/                 the React SPA (Vite root) — static files, no authority
frontend/src/lib/railcode.ts  THE SEAM: one module, every platform call
frontend/src/lib/tool-loop.ts vendored agent loop (see Ask AI, below)
frontend/src/lib/routes.ts    the tab ⇄ URL path table
frontend/src/store/           Zustand state and actions
frontend/src/components/      small reusable UI primitives
server/index.ts           the Hono worker — every credential the app has
agents/                   managed-agent manifests deployed alongside the app
```

The package versions are exact pins. Keep them exact when upgrading so app
builds are reproducible.

## How the v1 → v2 port worked

Worth reading before adapting this, because it is the cheap version of the
migration.

On v1 the page called SDK globals that `/_api/sdk.js` hung off `window`. On v2
there is no browser SDK: the frontend is static files with no credentials, and
every platform call goes through the app's own worker.

Almost none of the app changed. Views, components, stores and the CRM logic are
untouched. `frontend/src/lib/railcode.ts` was already the single module every
SDK call went through, so the port was: **rewrite that wrapper, keep its exported
signatures, and add one worker route per capability it actually uses.** The
routes in `server/index.ts` mirror the wrapper one for one.

Three things did change shape, and each is commented where it lives:

- **`userCollection` is no longer free.** v1's `db.user` was a private per-caller
  namespace the server enforced. A v2 app has ONE flat store shared by the whole
  org, so the worker prefixes the key with the verified caller's id *and* stamps
  the record, then refuses to return one whose owner is someone else. The prefix
  alone would be an index; the owner check is the fence.
- **`fileStore.url()` returns a worker path, not a signed URL.** The worker
  streams the bytes, so deal attachments render on any storage backend rather
  than only on S3-backed instances.
- **`agents.invoke` polls in the browser.** A worker invocation cannot hold a
  minutes-long run open, so `invoke` is `start` plus polling from the page. Work
  that must survive a closed tab uses `start` and persists the request_id — which
  is what the document generation flow does.

## Ask AI

The **Ask AI** page is an agent over the whole CRM: it answers questions about
the workspace and makes the same changes a person could make by hand.

```text
frontend/src/lib/ask.ts            types, the tool registry, arg coercion
frontend/src/lib/ask-tools.ts      the 22 tools the agent can call
frontend/src/lib/ask-agent.ts      system prompt, workspace snapshot, model choice
frontend/src/store/ask-store.ts    transcript, streaming, approval gating
frontend/src/views/AskAi.tsx       the page
frontend/src/components/Ask*.tsx   turns, tool cards, approval gate, generated visuals
```

Four ideas carry the feature:

- **The loop stays in the browser — the one thing that could not move.** Every
  other capability went into the worker. Not this: the write tools pause for a
  human approval card and close over live browser state, and a worker invocation
  is one request with no inbound channel to deliver an "Approve" click. So
  `lib/tool-loop.ts` is vendored into the app and only each planning TURN crosses
  to the worker (`/api/rc/llm/stream`). It plans, validates each call's args
  against its schema, executes `run` in the page, feeds `summarize(result)` back,
  and repeats until the model answers. Text streams throughout, so a preamble and
  the final answer come from one generation. Only `{ name, description, schema }`
  crosses the wire — and the model's reach is still exactly the tools with a
  `run`.

- **Writes wait for a person.** A write tool's `run` awaits a promise that only
  a click resolves, so the approval card *is* the gate — nothing is saved while
  it's on screen. Reads and the render tools run immediately. Every write goes
  through the same `useCrmStore` action the UI calls, so the agent gets no
  authority the caller doesn't have and the rest of the app updates live.

- **The model sees a summary; the user sees everything.** Each tool returns a
  `ToolOutcome`. The model reads only its `observation`; the raw object rides
  on the loop's `step.result`, which is what the card and the tables render. A
  20-row table costs the model a clipped preview, not 20 rows of tokens.

- **A workspace snapshot beats a lookup round-trip.** Every turn pastes a
  compact roster — ids, names, stages, values — into the system prompt, so
  "move the Acme deal to closing" resolves to an id without spending a tool
  call, and the model knows what exists before proposing a duplicate.

`render_table`, `render_chart` and `render_stats` are built from the same
primitives as the rest of the app (the funnel bars from Home, the data table
from Contacts), so a generated answer looks native and its rows link back to
the records they came from.

## Automations

The **Automations** page configures work the app hands to managed agents. One
automation ships: generating a client-ready `.docx` or `.pptx` proposal for a
deal, attached to that deal.

```text
frontend/src/lib/automation-catalog.ts  the automations on offer — one entry each
frontend/src/lib/automations.ts         types, storage layout, failure vocabulary
frontend/src/lib/deal-from-meeting.ts   meeting -> proposed company/people/deal
frontend/src/store/automation-store.ts  settings, uploads, run triggering + polling
frontend/src/store/triage-store.ts      recent meetings, dismissals, deal creation
frontend/src/views/Automations.tsx      the settings page
frontend/src/views/Notifications.tsx    finished documents and failed runs
frontend/src/components/DealFiles.tsx   a deal's files, generated and uploaded
agents/crm-artifact-writer/    the generation agent's manifest
agents/crm-style-measurer/     the template-measuring agent's manifest
```

The page is a list of collapsible rows: a **Setup** group holding the workspace
config every automation draws on, then the automations themselves. Adding one is
an entry in `automation-catalog.ts` — nothing in the page counts them. Config is
split to match: `automationSettings` holds one shared workspace record, and
`automations` holds one small record per automation. They used to be a single
object, which only worked while there was exactly one automation.

Four ideas carry the feature:

- **The app owns triggering; the agent owns the sandbox.** The app reads Granola
  (a personal connector — the worker calls it as the signed-in caller, never as
  the org), mints every id, uploads every input file, and calls `agents.start`.
  The agent renders the document in a code sandbox and writes the `artifacts`,
  `activities` and `automationRuns` records back itself — into the app's own flat
  store, which on v2 IS the scope an org agent's `app_data_write` lands in. That
  last part is what lets a run outlive the tab that started it: the browser is
  not required to be alive for the document to land.

- **The agents are `org`, and hold no connectors.** The CRM's data is shared and
  a document belongs to the deal, not to whoever clicked Generate. A `personal`
  agent writes into its owner's private scope, where nobody else on the deal can
  see it. Meeting content therefore arrives as input rather than being fetched:
  the app already imports it into shared `callNotes`.

  `agents:` in `manifest.yaml` is a refusal list under v2 — an agent not named
  there cannot be started from the worker, whatever grants the deployer holds.

- **A template beats a prompt.** The writer opens your uploaded `.docx`/`.pptx`
  and reuses its real styles, layouts and theme instead of approximating them.
  Its fonts, colours and spacing are measured once by a separate agent
  (`crm-style-measurer`, run automatically after a template upload) and cached,
  then applied literally — and the writer audits its own output against them
  before publishing, rebuilding the file if a check fails.

- **Nothing is invented.** Figures, dates and certifications come from a meeting
  or an uploaded file, or they are left as a bold bracketed placeholder that the
  app surfaces as a fill-in checklist. "We don't know our own SOC 2 status" is a
  better proposal than a confident wrong answer.

Home lists the last 7 days of meetings that aren't in the CRM yet — the
background sync only imports meetings whose attendees already match a known
contact, so a first call with a new prospect never lands anywhere. Each one can
be dismissed for good (shared, so nobody re-triages it) or turned into a deal:
one `llm.generate` call with a JSON schema proposes the company, people and
deal, a person confirms or edits it, and the writes go through the same store
actions the UI uses.
