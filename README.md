# railcode-examples

Examples and templates for Railcode apps and agents.

| Example | What it is | Showcases |
| --- | --- | --- |
| [`apps/kanban`](apps/kanban) | A kanban board with drag-and-drop columns, a list view, and a command palette. | The plain static app: SDK globals, KV storage, Zustand state — no LLM or agents. |
| [`apps/chat`](apps/chat) | A chat interface over your connected data sources (Postgres text-to-SQL, PostHog HogQL). | Per-user scoped storage, streaming answers, auditable inline tool calls, file uploads. |
| [`apps/crm`](apps/crm) | A full CRM — companies, contacts, pipeline, activity, automations — with an **Ask AI** agent that can read and change anything a person could. | `llm.stream({ tools })` agent loops, human approval gating on writes, per-tab URL routing, managed agents deployed alongside an app. |
| [`agents/pitch-deck`](agents/pitch-deck) | An app for uploading company materials, paired with an agent that writes a polished pitch-deck PDF from them. | App-paired managed agents: `app_data`/`app_files` access, code execution, publishing runs back as tracked versions. |
| [`agents/proposals`](agents/proposals) | An agent that watches your Granola meetings on a 30-minute cron and drafts an editable `.docx` proposal whenever a call clearly ended with "send us a proposal", paired with an app that just displays them. | Scheduled agents with no caller: `agent_kv` as a processed-meeting ledger, a first run that backfills instead of flooding, and making an unattended agent's decisions visible. |

Apps live under `apps/`; the `agents/` examples pair an app with a managed agent, because agents can't own files or storage directly — they work through an app they have data access to.
