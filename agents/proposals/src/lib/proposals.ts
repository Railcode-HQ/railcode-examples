// Almost everything in this file describes data the AGENT wrote. The app makes
// exactly two kinds of record of its own: the `edited` fields below, and the
// in-flight marker for a run somebody started with Run now.

/** The agent behind this app. `manifest.yaml` must declare it for Run now to work. */
export const AGENT_NAME = "proposal-writer";

export type ProposalRecord = {
  id: string;
  fileName: string; // "proposals/proposal-acme-20260718-153000.docx"
  title: string;
  client: string;
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  createdAt: string;
  summary: string;
  /** Section names in order — the agent reads these back to keep house structure. */
  sections?: string[];
  /** Bracketed gaps the agent deliberately left for a human to fill in. */
  placeholders?: string[];
  /** What in the meeting made this a proposal. The agent's reasoning, shown as-is. */
  signals?: string[];
  /** Set by this app once someone saves an edit from the editor. */
  edited?: boolean;
  editedAt?: string;
  editedBy?: string;
};

/**
 * The agent's own account of its last run, written every run including the quiet
 * ones. On a schedule this is the only evidence the agent is alive: with no
 * proposals on screen, "checked 8 minutes ago, nothing new" and "hasn't run
 * since Tuesday" look identical without it.
 */
export type ScoutState = {
  lastRunAt?: string;
  outcome?: "bootstrap" | "idle" | "drafted" | "error";
  /** When the agent started watching. Everything before it was marked handled. */
  bootstrappedAt?: string;
  scanned?: number;
  candidates?: number;
  drafted?: { id: string; title: string }[];
  skipped?: { title: string; reason: string }[];
  notReady?: string[];
  /** Meetings that qualified but weren't drafted this run — one per run. */
  pending?: number;
  error?: string | null;
};

/**
 * A run someone started from Run now, held in SHARED scope on purpose.
 *
 * A run takes up to five minutes, so the tab that pressed the button will often
 * be reloaded or closed before it lands. Keeping the request id here is what
 * lets a returning tab pick the poll back up — and, more importantly, what stops
 * a second tab, or a colleague, from starting a run on top of one already going.
 * Overlapping runs are the single thing the agent's ledger cannot defend
 * against: both read the ledger before either writes to it, so both see the same
 * meeting as new and both draft it.
 *
 * The record exists only while a run is in flight. It is deleted the moment one
 * reaches a terminal status, so its presence *is* the "a run is going" flag.
 */
export type ManualRun = {
  requestId: string;
  startedAt: string;
  startedBy?: string;
};

/**
 * When to stop believing an in-flight marker. The agent's own ceiling is 300
 * seconds and queueing adds a little on top, so anything past ten minutes is a
 * record whose poller died rather than a run still working — and leaving it to
 * block the button forever would be the worse failure.
 */
export const RUN_STALE_AFTER_MS = 10 * 60 * 1000;

export function isRunStale(run: ManualRun | null, now = Date.now()): boolean {
  if (!run) return false;
  const started = new Date(run.startedAt).getTime();
  if (Number.isNaN(started)) return true;
  return now - started > RUN_STALE_AFTER_MS;
}

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDay(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "just now";
  if (diffMs < hour) return Math.round(diffMs / minute) + "m ago";
  if (diffMs < day) return Math.round(diffMs / hour) + "h ago";
  return Math.round(diffMs / day) + "d ago";
}

/**
 * The agent runs every 30 minutes, so anything much older than that means the
 * schedule is not firing — worth surfacing rather than showing a stale
 * "checked 4d ago" as though it were normal.
 */
export const STALE_AFTER_MS = 90 * 60 * 1000;

export function isStale(state: ScoutState | null): boolean {
  if (!state?.lastRunAt) return false;
  const then = new Date(state.lastRunAt).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then > STALE_AFTER_MS;
}

export function cleanError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- triggering a run ------------------------------------------------------

/**
 * A thrown SDK error from `agents.start`, turned into something with a fix in it.
 *
 * The case worth naming is `not found`, which is what a personal agent returns
 * to anyone but its owner — Railcode 404s rather than 403s so as not to confirm
 * the agent exists. It reads as a bug otherwise. Note `railcode dev` proxies
 * agent runs to the real backend, so a press here starts a real run; a 404
 * locally means the same thing it means anywhere else.
 */
export function agentCallError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  let detail = raw;
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; message?: unknown };
    if (typeof parsed?.detail === "string") detail = parsed.detail;
    else if (typeof parsed?.message === "string") detail = parsed.message;
  } catch {
    /* not JSON — the raw text is the best we have */
  }

  if (/not found|forbidden|not authorized|permission/i.test(detail)) {
    return `Couldn't start ${AGENT_NAME}. Either it hasn't been created yet, this app's manifest hasn't been ratified for it, or you aren't its owner — it's a personal agent, and only the person who created it can run it, because it reads their own Granola account. The schedule still runs either way.`;
  }
  return detail || "Couldn't start the run.";
}

const FAILURE_HELP: Record<string, string> = {
  daily_token_limit_exceeded:
    "The workspace's daily LLM token limit is used up, so the run stopped early. It resets daily, or an admin can raise the cap.",
  timeout:
    "The run hit its five-minute limit before finishing. Any meeting it closed off in the ledger stays closed, so the next run carries on rather than starting over.",
  provider_rate_limited: "The model provider is rate-limiting requests. Try again in a moment.",
  provider_auth_error:
    "The LLM provider rejected its API key. An admin needs to update the provider credentials in Railcode.",
  invalid_input:
    "The runtime rejected the run's input. Nothing should be sent at all — that's a bug in this app rather than anything you did.",
};

/**
 * Why a run ended badly. The reason lives in `error_code`/`error_message`; there
 * is no `error` field, and a run can end non-`success` without being `failed`.
 */
export function runFailureMessage(run: {
  status?: string;
  error_code?: string | null;
  error_message?: string | null;
}): string {
  const code = run.error_code ?? undefined;
  const detail = run.error_message ?? undefined;

  if (code && FAILURE_HELP[code]) return FAILURE_HELP[code];
  if (run.status === "limit_exceeded") {
    return `The run passed the agent's own limits (steps, tokens or time) before finishing.${
      detail ? ` ${detail}` : ""
    }`;
  }
  if (run.status === "cancelled") return "The run was cancelled before it finished.";
  if (detail) return code ? `${detail} (${code})` : detail;
  if (code) return `The run failed: ${code}`;
  return "The run didn't finish, and the platform reported no reason.";
}

/**
 * What to tell the person who pressed the button, read off the run's own scout
 * record. A scheduled run reports to nobody, but a manual one has someone
 * watching it — and since most runs correctly draft nothing, "it finished" is
 * not an answer. Say which of the several kinds of nothing happened.
 */
export function runOutcomeNotice(scout: ScoutState | null): string {
  const drafted = scout?.drafted?.[0];
  if (scout?.outcome === "bootstrap") {
    const n = scout.scanned ?? 0;
    return `First run — marked ${n} past meeting${n === 1 ? "" : "s"} as already handled. Nothing is drafted from your back catalogue; new meetings count from here.`;
  }
  if (drafted) return `Drafted “${drafted.title}”.`;
  if (scout?.pending) {
    return `${scout.pending} more meeting${scout.pending === 1 ? "" : "s"} still to draft — one per run, so run again or wait for the schedule.`;
  }
  if (scout?.scanned) {
    return `Checked ${scout.scanned} meeting${scout.scanned === 1 ? "" : "s"} — nothing new needs a proposal.`;
  }
  return "Nothing new needs a proposal.";
}
