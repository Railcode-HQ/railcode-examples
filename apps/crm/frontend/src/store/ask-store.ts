import { create } from "zustand";

import {
  AskMessage,
  AskStep,
  Approval,
  ToolOutcome,
  toolMeta,
} from "@/lib/ask";
import {
  AskRun,
  describeAskError,
  isModelRejection,
  pickModel,
  runAsk,
  stopReasonNote,
} from "@/lib/ask-agent";
import { ApprovalRequest } from "@/lib/ask-tools";
import { newId, nowIso } from "@/lib/crm";
import { LlmMessage, LlmToolStep } from "@/lib/railcode";
import { useCrmStore } from "@/store/crm-store";

/** Live turn being streamed. Kept apart from `messages` so a token arriving
 *  doesn't re-render the finished transcript above it. */
type StreamState = {
  messageId: string;
  content: string;
  steps: AskStep[];
};

/** How much transcript to carry into the next question. Tool turns thread back
 *  through here, so this is measured in wire messages, not user turns — enough
 *  for a long back-and-forth without an unbounded prompt. */
const MAX_WIRE_MESSAGES = 60;

/** Trim the transcript for replay.
 *
 *  A blind `slice(-n)` can start the history on a tool result whose tool call
 *  was just cut off, which providers reject outright — so the trimmed window
 *  is walked forward to the first user turn, and the system prompt is dropped
 *  because it's passed separately on every call. */
function trimWire(messages: LlmMessage[]): LlmMessage[] {
  const recent = messages.filter((m) => m.role !== "system").slice(-MAX_WIRE_MESSAGES);
  const start = recent.findIndex((m) => m.role === "user");
  return start <= 0 ? recent : recent.slice(start);
}

type AskState = {
  messages: AskMessage[];
  stream: StreamState | null;
  approvals: Approval[];
  busy: boolean;
  error: string | null;
  /** The transcript the SDK threaded, replayed to continue the conversation. */
  wire: LlmMessage[];
  model: string | null;
  modelResolved: boolean;

  init: () => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  decide: (approvalId: string, approved: boolean) => void;
  approveAll: () => void;
  reset: () => void;
  dismissError: () => void;
};

function toStep(raw: LlmToolStep, previous?: AskStep): AskStep {
  const meta = toolMeta(raw.tool);
  return {
    id: raw.id,
    tool: raw.tool,
    kind: meta.kind,
    args: (raw.args ?? {}) as Record<string, unknown>,
    status: raw.status,
    ms: raw.ms,
    error: raw.error,
    outcome: (raw.result as ToolOutcome | null) ?? null,
    approvalId: previous?.approvalId ?? null,
  };
}

/** Pair each parked write with the card it belongs to.
 *
 *  The SDK's "running" event and the tool's own approval request race — either
 *  can land first — so instead of relying on order this walks the running steps
 *  and claims the oldest unassigned approval for the same tool. Calls run one
 *  at a time in practice, which makes the pairing exact; the fallback for an
 *  unmatched approval is to render it on its own (see AskApprovalCard). */
function reconcile(steps: AskStep[], approvals: Approval[]): AskStep[] {
  const claimed = new Set(
    steps.map((s) => s.approvalId).filter((id): id is string => Boolean(id)),
  );
  const open = approvals.filter((a) => a.status === "pending" && !claimed.has(a.id));
  if (!open.length) return steps;

  return steps.map((step) => {
    if (step.approvalId || step.status !== "running") return step;
    const index = open.findIndex((a) => a.tool === step.tool);
    if (index === -1) return step;
    const [match] = open.splice(index, 1);
    return { ...step, approvalId: match.id, status: "awaiting" as const };
  });
}

export const useAskStore = create<AskState>((set, get) => {
  /** Aborted by `stop()`. The SDK cancels the loop between steps and chunks and
   *  resolves normally with `stopReason: "aborted"`, so stopping is a branch on
   *  the result rather than an exception to catch. */
  let controller: AbortController | null = null;
  let initialized = false;
  /** Bumped by `reset()`. A run that settles after the transcript was cleared
   *  belongs to a conversation that no longer exists. */
  let currentGeneration = 0;

  // Streaming touches state on every token; buffering into one rAF-aligned
  // flush keeps a fast stream from queueing a React render per token.
  let pendingDelta = "";
  let frame = 0;
  const flushDelta = () => {
    frame = 0;
    const chunk = pendingDelta;
    pendingDelta = "";
    if (!chunk) return;
    const stream = get().stream;
    if (!stream) return;
    set({ stream: { ...stream, content: stream.content + chunk } });
  };
  const queueDelta = (text: string) => {
    pendingDelta += text;
    if (!frame) frame = requestAnimationFrame(flushDelta);
  };
  const cancelPendingFlush = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pendingDelta = "";
  };

  const settleApproval = (id: string, approved: boolean) => {
    const approval = get().approvals.find((a) => a.id === id);
    if (!approval || approval.status !== "pending") return;
    set((s) => ({
      approvals: s.approvals.map((a) =>
        a.id === id ? { ...a, status: approved ? "approved" : "rejected" } : a,
      ),
    }));
    approval.decide(approved);
  };

  /** Handed to the tools. Parks the write until the person decides — the
   *  promise this returns is what the tool's `run` is awaiting, so nothing is
   *  saved until it resolves. */
  const requestApproval = (request: ApprovalRequest): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const approval: Approval = {
        ...request,
        id: newId("apv"),
        status: "pending",
        decide: (approved) => {
          if (settled) return;
          settled = true;
          resolve(approved);
        },
      };
      set((s) => {
        const approvals = [...s.approvals, approval];
        return {
          approvals,
          stream: s.stream ? { ...s.stream, steps: reconcile(s.stream.steps, approvals) } : s.stream,
        };
      });
    });

  return {
    messages: [],
    stream: null,
    approvals: [],
    busy: false,
    error: null,
    wire: [],
    model: null,
    modelResolved: false,

    async init() {
      if (initialized) return;
      initialized = true;
      // A missing catalog is not an error — the org default model still works.
      const model = await pickModel().catch(() => null);
      set({ model, modelResolved: true });
    },

    async send(text) {
      const question = text.trim();
      if (!question || get().busy) return;

      const generation = currentGeneration;
      controller = new AbortController();
      const userMessage: AskMessage = {
        id: newId("am"),
        role: "user",
        content: question,
        createdAt: nowIso(),
        steps: [],
        error: null,
        note: null,
      };

      set((s) => ({
        messages: [...s.messages, userMessage],
        stream: { messageId: newId("am"), content: "", steps: [] },
        busy: true,
        error: null,
      }));

      const callbacks = {
        onDelta: queueDelta,
        onStep: (raw: LlmToolStep) => {
          const stream = get().stream;
          if (!stream) return;
          const existing = stream.steps.find((s) => s.id === raw.id);
          const next = toStep(raw, existing);
          const steps = existing
            ? stream.steps.map((s) => (s.id === raw.id ? next : s))
            : [...stream.steps, next];
          set({ stream: { ...stream, steps: reconcile(steps, get().approvals) } });
        },
      };

      const attempt = (model: string | null) =>
        runAsk(
          {
            history: get().wire,
            question,
            model,
            identity: useCrmStore.getState().identity,
            signal: controller!.signal,
            requestApproval,
          },
          callbacks,
        );

      let run: AskRun | null = null;
      let failure: string | null = null;

      try {
        run = await attempt(get().model);
      } catch (err) {
        const message = describeAskError(err);
        // The catalog can advertise a model this instance can't actually call.
        // Drop back to the org default once, for this session, rather than
        // making the person's question the casualty of a config detail.
        if (get().model && isModelRejection(message)) {
          set({ model: null });
          try {
            run = await attempt(null);
          } catch (retryErr) {
            failure = describeAskError(retryErr);
          }
        } else {
          failure = message;
        }
      }

      flushDelta();
      cancelPendingFlush();

      // Anything still parked when the run ends (aborted, timed out, failed)
      // has to be released or its tool promise never settles.
      for (const approval of get().approvals) {
        if (approval.status === "pending") settleApproval(approval.id, false);
      }

      const stream = get().stream;
      const content = run?.content || stream?.content || "";
      const aborted = run?.stopReason === "aborted";

      const assistant: AskMessage = {
        id: stream?.messageId ?? newId("am"),
        role: "assistant",
        content,
        createdAt: nowIso(),
        steps: stream?.steps ?? [],
        error: failure,
        note: aborted
          ? "Stopped."
          : stopReasonNote(run?.stopReason ?? null, Boolean(content.trim())),
      };

      // "New chat" during a run would otherwise land this turn in the fresh,
      // empty transcript once it finally settles.
      if (generation !== currentGeneration) return;

      set((s) => ({
        messages: [...s.messages, assistant],
        stream: null,
        busy: false,
        // A failed turn leaves the wire transcript untouched: the SDK never
        // handed one back, and replaying a half-finished turn would confuse the
        // next question more than dropping it does.
        wire: run?.messages?.length ? trimWire(run.messages) : s.wire,
      }));
    },

    stop() {
      // Release parked writes first — the abort alone leaves their promises
      // hanging, and the person clicking Stop clearly isn't approving them.
      for (const approval of get().approvals) {
        if (approval.status === "pending") settleApproval(approval.id, false);
      }
      controller?.abort();
    },

    decide(approvalId, approved) {
      settleApproval(approvalId, approved);
    },

    approveAll() {
      for (const approval of get().approvals) {
        if (approval.status === "pending") settleApproval(approval.id, true);
      }
    },

    reset() {
      get().stop();
      cancelPendingFlush();
      currentGeneration += 1;
      set({ messages: [], stream: null, approvals: [], wire: [], error: null, busy: false });
    },

    dismissError() {
      set({ error: null });
    },
  };
});
