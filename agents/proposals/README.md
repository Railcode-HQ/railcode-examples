# Proposals

A scheduled agent reads a configured Granola account every 30 minutes and drafts
at most one editable `.docx` proposal. The companion app displays and edits the
shared results. **Refresh** reloads results; it does not start another agent run.

## Set up

1. Link the intended Granola account in Railcode's dashboard or with
   `railcode connector link granola`. Run `railcode connector list` and
   `railcode connector tools <name>` to confirm its name and tools.
2. Update `tools.connectors` and the connector name in the agent's system prompt
   if the linked name is suffixed, such as `granola-alice`.
3. Set `model` to a configured value from `railcode llm models`.
4. Deploy the companion app, then create an **org** agent and its schedule:

```bash
npm install
railcode dev
railcode deploy
railcode agent create --file agents/proposal-writer/agent.yaml --visibility org
railcode agent schedule set proposal-writer --cron "*/30 * * * *" --timezone UTC
railcode agent schedule show proposal-writer
```

The org agent uses the named account's credential and publishes into the app's
shared KV and file storage. Imported meeting content and proposals are visible to
members allowed to open this app. A personal agent writes into its owner's user
scope and is incompatible with this shared reader/editor.

Existing personal agents cannot be converted to org agents. For an existing
installation, create a new org agent with a distinct name, configure its schedule,
and retire the old schedule once the replacement is ready. Do not leave both
producing proposals. Existing private output is not automatically copied into
shared storage.

## One producer

The agent's schedule is the only run trigger in this example. Railcode's scheduler
locks the agent row and skips a tick if a run is already queued or running. This
coordinates multiple scheduler replicas and avoids overlapping ledger updates.
The app has no agent-invocation grant or run-start endpoint.

A shared KV marker cannot provide this guarantee: KV has no atomic
compare-and-set operation, and a browser's disabled button cannot stop another
request. Do not add a manual `agents.start()` route alongside the schedule without
a coordination primitive shared by both trigger paths. Use the dashboard's
schedule controls when operating the schedule.

## How drafting works

- The first run marks existing meetings as handled and drafts nothing. New calls
  count from that point; installing the example does not flood the app with old
  proposals.
- `agent_kv` holds a cross-run ledger of meeting IDs and outcomes. Bootstrap is
  recorded last so an interrupted first run can safely resume.
- Each later run checks recent meetings. A call qualifies only when there is clear
  evidence that a client asked for a proposal; internal meetings are skipped.
- Meetings awaiting notes remain eligible. The agent writes at most one proposal
  per run and leaves remaining candidates for later ticks.
- The agent publishes the `.docx`, a `proposals` record, and `state/scout` into the
  shared app store. The app polls these records and supports saving document edits.
- Agent input is free-form; its contract is in `system`. The obsolete
  `input_schema` and `personal_connectors` manifest keys are not supported.

The app only reads records/files and saves edits, so local development does not
need a live agent invocation. Check the schedule and its run logs in Railcode to
validate real Granola access and document generation after deployment.
