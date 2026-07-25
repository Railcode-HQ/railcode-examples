# proposals

A proposal writer that nobody triggers.

Every 30 minutes `proposal-writer` reads your recent Granola meetings, decides
which ones clearly ended with *"send us a proposal"*, and drafts an editable
`.docx` for one of them. The app is a reader: it shows what the agent produced,
why it thought a proposal was warranted, and when it last looked.

The interesting part is not the drafting — it's everything around running
unattended on a short cycle: not reprocessing a meeting, not flooding you with
proposals for your entire back catalogue on day one, and staying visible when
most runs correctly do nothing.

## The two pieces

| | |
| --- | --- |
| `agents/proposal-writer/agent.yaml` | The agent. Personal (Granola is a personal connector), scheduled, `agent_kv` for its ledger, `app_data_write` to publish into the app. |
| everything else | The companion app, slug `proposals`. Lists drafts, opens them in an editor, saves edits back. |

The app holds no authority of its own — `manifest.yaml` is `run_as: app` and
nothing else. It never calls Granola and never invokes the agent. That split is
the point: agents can't own files or storage, so the app exists to *be* the
agent's storage and its window.

## Run it

```bash
railcode agent create --file agents/proposal-writer/agent.yaml --visibility personal
railcode agent schedule set proposal-writer --cron "*/30 * * * *" --timezone UTC
railcode agent schedule show proposal-writer
```

`--visibility personal` is not optional: `personal_connectors` is rejected on an
org agent, and runs act as the owner's own Granola account. `*/30` is also the
floor — schedules are capped at 48 fires a day.

Then the app:

```bash
npm install
railcode dev          # http://127.0.0.1:7331 (or the port it prints)
railcode deploy
```

Set `model:` to a row from `railcode llm models` before creating the agent — the
value is org-specific and validated for an exact match.

To watch a run instead of waiting for the cron:

```bash
railcode agent run proposal-writer --trace
```

## How it stays out of its own way

**The first run drafts nothing.** It lists the last 30 days of meetings, writes
every one into its ledger as `backfill`, and stops. Without that, installing the
agent on a Tuesday means a dozen proposals about deals that already closed. The
bootstrap marker is written *last*, so a run that dies partway just redoes the
backfill next time instead of leaving meetings looking new.

**The ledger is `agent_kv`.** One record per meeting it has dealt with, keyed by
the Granola meeting id, in the agent's own private cross-run store:

```
collection "meetings", key <meeting id>
  { id, title, date, outcome, reason, proposalId, at }

collection "state", key "bootstrap"
  { bootstrappedAt, backfilled }
```

`outcome` is `backfill`, `skipped`, `drafted`, or `unusable`. All four mean
*closed* — the meeting is never read or judged again. Skipped meetings get a
record too, and that's what makes a 30-minute cycle affordable: a run that finds
nothing new costs one listing call.

It reads the ledger back with a single `agent_kv_query` ordered by `updatedAt`,
limited to 200. Meetings only ever come from a one-week listing window, so the
200 most recently touched records always cover it — no paging through a store
that grows forever.

The one deliberate gap: a meeting that just happened and has no notes yet gets
**no** ledger record, so a later run picks it up. If it's still empty six hours
on, it's closed as `unusable` rather than retried forever.

**One proposal per run.** Runs are killed at 300 seconds and a single document
uses most of that. Extra qualifying meetings are left unrecorded and reported as
`pending`; the next run takes the next one. The schedule drains the queue.

**Most runs do nothing, visibly.** Every run — including the quiet ones — writes
`state/scout` into the app with what it scanned, what it passed over and why.
Without it an empty screen can't distinguish "nothing qualified" from "the
schedule was never created", which is the failure mode of every unattended
agent. `AgentStatus.tsx` renders it, and flags a last-run older than 90 minutes.

## Traps worth knowing

These cost real debugging time and none of them fail loudly.

- **Don't declare `input_schema` on a scheduled agent.** A cron run passes input
  `null`, the runtime validates that `null` against the schema with no
  exemption, and `{type: object}` fails **every** scheduled run with
  `invalid_input` before step one. This agent takes no input at all.
- **`agent_kv` tools don't exist on a draft.** `railcode agent test` runs
  without an `Agent` row, so the ledger tools are omitted entirely — a draft
  test can't exercise any of the logic above. Use `create` + `run`.
- **`list_meetings` takes `time_range` and nothing else.** Its own description
  mentions a `folder_id`; the schema rejects it. There is no folder, date, or
  hour filter, which is why triage is the model's judgement.
- **Granola's listing isn't well-formed XML.** Titles carry raw `<>` (the
  "Dana <> Priya" convention) so a title doesn't end at the first `>`, and dates
  carry a timezone abbreviation.
- **`publish_artifact_to_app`'s `name` must match the saved path exactly.** If
  it doesn't, the publish is silently skipped, the run still reports success,
  and no file ever arrives.
- **The agent has no clock.** It reads `date -u` from the sandbox on every run.
  A guessed timestamp corrupts both the app's ordering and the ledger's
  age-based decisions.

## Adapting it

- **Change what qualifies.** The triage rules live in the `system` prompt, step
  4. That's the whole business logic — an explicit ask, agreed scope plus a
  write-up request, pricing as a next action. It's written to skip when
  ambiguous, because an unattended false positive costs more attention than a
  miss.
- **Change the cadence.** `schedule set --cron`. Nothing in the agent assumes 30
  minutes except the "less than 6 hours old" grace period and the app's staleness
  threshold (`STALE_AFTER_MS`).
- **Give it materials to draw on.** This version writes from the meeting alone,
  so expect bracketed placeholders for pricing. Add `app_files: [proposals]` to
  the manifest and an upload view to the app, and have it read a rate card — the
  sibling [`agents/pitch-deck`](../pitch-deck) example does exactly that.
- **Let a human trigger one.** Add `agents: [proposal-writer]` to the app's
  manifest and call `agents.start(...)`; poll the run rather than
  `agents.invoke`, which would hold a request open for minutes.
