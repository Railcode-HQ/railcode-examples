# Crm

React + Vite + Zustand + Tailwind starter for a Railcode app.

## Run Locally

```bash
railcode dev
```

The Railcode dev proxy installs missing app dependencies on first run, serves
the app at `http://127.0.0.1:7331`, loads `/_api/sdk.js`, and keeps local
KV/files under `~/.railcode/dev/crm`.

## Deploy

```bash
railcode deploy
```

Deploy builds the app and publishes the generated static output for
`crm`.

## Structure

```text
src/lib/railcode.ts       typed wrappers over the Railcode SDK globals
src/lib/routes.ts         the tab ⇄ URL path table
src/store/crm-store.ts    Zustand state and API actions
src/components/           small reusable UI primitives
src/App.tsx               app shell and view routing
agents/                   managed-agent manifests deployed alongside the app
```

The package versions are exact pins. Keep them exact when upgrading so app
builds are reproducible.

## Ask AI

The **Ask AI** page is an agent over the whole CRM: it answers questions about
the workspace and makes the same changes a person could make by hand.

```text
src/lib/ask.ts            types, the tool registry, arg coercion
src/lib/ask-tools.ts      the 20 tools the agent can call
src/lib/ask-agent.ts      system prompt, workspace snapshot, model choice
src/store/ask-store.ts    transcript, streaming, approval gating
src/views/AskAi.tsx       the page
src/components/Ask*.tsx   turns, tool cards, approval gate, generated visuals
```

Four ideas carry the feature:

- **The SDK runs the loop.** `llm.stream({ tools })` plans, validates each
  call's args against its schema, executes `run` in the page with the app's own
  authority, feeds `summarize(result)` back, and repeats until the model
  answers. Text streams throughout, so a preamble and the final answer come
  from one generation. Only `{ name, description, schema }` crosses the wire.

- **Writes wait for a person.** A write tool's `run` awaits a promise that only
  a click resolves, so the approval card *is* the gate — nothing is saved while
  it's on screen. Reads and the render tools run immediately. Every write goes
  through the same `useCrmStore` action the UI calls, so the agent gets no
  authority the caller doesn't have and the rest of the app updates live.

- **The model sees a summary; the user sees everything.** Each tool returns a
  `ToolOutcome`. The model reads only its `observation`; the raw object rides
  on the SDK's `step.result`, which is what the card and the tables render. A
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
src/lib/automation-catalog.ts  the automations on offer — one entry each
src/lib/automations.ts         types, storage layout, failure vocabulary
src/lib/deal-from-meeting.ts   meeting -> proposed company/people/deal
src/store/automation-store.ts  settings, uploads, run triggering + polling
src/store/triage-store.ts      recent meetings, dismissals, deal creation
src/views/Automations.tsx      the settings page
src/views/Notifications.tsx    finished documents and failed runs
src/components/DealFiles.tsx   a deal's files, generated and uploaded
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
  (a personal connector, only reachable from the page), mints every id, uploads
  every input file, and calls `agents.start`. The agent renders the document in a
  code sandbox and writes the `artifacts`, `activities` and `automationRuns`
  records back itself. That last part is what lets a run outlive the tab that
  started it — the browser is not required to be alive for the document to land.

- **The agents are `org`, and hold no connectors.** The CRM's data is shared and
  a document belongs to the deal, not to whoever clicked Generate. A `personal`
  agent writes into its owner's private scope, where nobody else on the deal can
  see it. Meeting content therefore arrives as input rather than being fetched:
  the app already imports it into shared `callNotes`.

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
