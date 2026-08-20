import { create } from "zustand";
import { api, ApiError, streamChat } from "@/lib/api";
import { deleteAttachment, uploadAttachment } from "@/lib/attachments";
import { describeError, describeStreamError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import {
  DEFAULT_PREFS,
  type Attachment,
  type Conversation,
  type LlmProviderInfo,
  type Message,
  type Prefs,
  type SourceId,
  type ToolStep,
} from "@shared/types";

/** The store holds the transcript and the view state.
 *
 *  It knows nothing about KV, the LLM gateway, SQL or PostHog — all of that is
 *  the worker's, reached through `api`. What used to be a per-user private
 *  namespace (`db.user`) is now the worker's key scheme plus an owner check on
 *  every read; see server/keys.ts.
 *
 *  It also no longer persists anything. The worker writes both messages as part
 *  of the same request that streams the answer, so a browser that closes
 *  mid-answer still leaves a complete conversation behind. */
const PAGE_SIZE = 200;

/** Pinned first, then most recently updated. */
function sortConversations(list: Conversation[]): string[] {
  return [...list]
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .map((c) => c.id);
}

type StreamState = {
  convId: string;
  messageId: string;
  content: string;
  steps: ToolStep[];
};

type ChatState = {
  ready: boolean;
  bootError: string | null;
  error: string | null;

  userName: string;
  userEmail: string;

  providers: LlmProviderInfo[];
  prefs: Prefs;

  conversations: Record<string, Conversation>;
  order: string[];
  activeId: string | null;
  messages: Record<string, Message[]>;
  loadingMessages: boolean;

  stream: StreamState | null;
  busy: boolean;

  pending: Attachment[];
  uploading: boolean;

  sidebarOpen: boolean;
  search: string;

  bootstrap: () => Promise<void>;
  newConversation: () => void;
  selectConversation: (id: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removePending: (id: string) => Promise<void>;
  setModel: (model: string | null) => Promise<void>;
  toggleSource: (source: SourceId) => Promise<void>;
  setSearch: (value: string) => void;
  setSidebarOpen: (open: boolean) => void;
  dismissError: () => void;
};

export const useChatStore = create<ChatState>((set, get) => {
  /** Aborted by `stop()`. Hanging up the ndjson response cancels the loop in the
   *  worker, so stopping really stops the model rather than just the UI. */
  let controller: AbortController | null = null;

  /** React StrictMode mounts effects twice in development, which would
   *  otherwise fire two concurrent bootstraps and double-fetch everything. */
  let booting = false;

  /** Streaming touches state on every token. Buffering into a single
   *  rAF-aligned flush keeps a fast stream from queueing one React render per
   *  token, which is what makes long answers feel smooth rather than janky. */
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

  const applyConversation = (conv: Conversation) => {
    const conversations = { ...get().conversations, [conv.id]: conv };
    set({ conversations, order: sortConversations(Object.values(conversations)) });
  };

  const patchLocal = (convId: string, patch: Partial<Conversation>) => {
    const existing = get().conversations[convId];
    if (existing) applyConversation({ ...existing, ...patch });
  };

  return {
    ready: false,
    bootError: null,
    error: null,
    userName: "",
    userEmail: "",
    providers: [],
    prefs: DEFAULT_PREFS,
    conversations: {},
    order: [],
    activeId: null,
    messages: {},
    loadingMessages: false,
    stream: null,
    busy: false,
    pending: [],
    uploading: false,
    sidebarOpen: false,
    search: "",

    async bootstrap() {
      if (booting || get().ready) return;
      booting = true;
      try {
        const [identity, rows, storedPrefs, providers] = await Promise.all([
          api.me(),
          api.conversations(),
          api.prefs(),
          // A nice-to-have: an org with no providers configured should still
          // render the app, just without a picker.
          api.providers().catch(() => [] as LlmProviderInfo[]),
        ]);

        const conversations: Record<string, Conversation> = {};
        for (const conv of rows) conversations[conv.id] = conv;
        const order = sortConversations(Object.values(conversations));

        set({
          ready: true,
          userName: identity.name || identity.email || "You",
          userEmail: identity.email || "",
          providers,
          prefs: { ...DEFAULT_PREFS, ...(storedPrefs ?? {}) },
          conversations,
          order,
          activeId: order[0] ?? null,
        });

        if (order[0]) await get().selectConversation(order[0]);
      } catch (err) {
        set({ bootError: describeError(err) });
      }
    },

    newConversation() {
      set({ activeId: null, sidebarOpen: false, error: null });
    },

    async selectConversation(id) {
      set({ activeId: id, sidebarOpen: false, error: null });
      if (get().messages[id]) return;
      set({ loadingMessages: true });
      try {
        set({ messages: { ...get().messages, [id]: await api.messages(id) } });
      } catch (err) {
        set({ error: describeError(err) });
      } finally {
        set({ loadingMessages: false });
      }
    },

    async send(text) {
      const trimmed = text.trim();
      const attachments = get().pending;
      if ((!trimmed && attachments.length === 0) || get().busy) return;

      controller = new AbortController();
      const isNew = !get().activeId;
      // The browser picks the conversation id; the worker stores it under the
      // caller's own prefix, so a chosen id can only ever land in their space.
      const convId = get().activeId ?? newId("conv");
      const now = new Date().toISOString();

      if (isNew) {
        applyConversation({
          id: convId,
          owner: "",
          title: trimmed ? trimmed.slice(0, 60) : "New chat",
          createdAt: now,
          updatedAt: now,
          preview: trimmed.slice(0, 120),
          messageCount: 0,
          pinned: false,
        });
        set({ activeId: convId, messages: { ...get().messages, [convId]: [] } });
      }

      set({
        pending: [],
        busy: true,
        error: null,
        stream: { convId, messageId: newId("msg"), content: "", steps: [] },
      });

      const append = (message: Message) => {
        const current = get().messages[convId] ?? [];
        // The worker's record replaces the optimistic one if it is already here.
        const without = current.filter((m) => m.seq !== message.seq);
        set({ messages: { ...get().messages, [convId]: [...without, message] } });
      };

      try {
        for await (const frame of streamChat(
          { convId, question: trimmed, attachments, prefs: get().prefs },
          controller.signal,
        )) {
          if (frame.type === "text") {
            queueDelta(frame.text);
          } else if (frame.type === "step") {
            const stream = get().stream;
            if (!stream) continue;
            const steps = stream.steps.some((s) => s.id === frame.step.id)
              ? stream.steps.map((s) => (s.id === frame.step.id ? { ...frame.step } : s))
              : [...stream.steps, { ...frame.step }];
            set({ stream: { ...stream, steps } });
          } else if (frame.type === "user") {
            append(frame.message);
          } else if (frame.type === "saved") {
            flushDelta();
            append(frame.message);
            patchLocal(convId, {
              preview: (frame.message.content || trimmed).slice(0, 120),
              messageCount: (get().messages[convId] ?? []).length,
              updatedAt: frame.message.createdAt,
            });
          } else if (frame.type === "title") {
            patchLocal(convId, { title: frame.title });
          } else if (frame.type === "error") {
            set({ error: describeStreamError(frame) });
          }
        }
      } catch (err) {
        // An abort is the Stop button, not a failure — the worker already
        // recorded the partial turn.
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          set({ error: describeError(err) });
        }
      } finally {
        cancelPendingFlush();
        set({ stream: null, busy: false });
        controller = null;
      }
    },

    stop() {
      controller?.abort();
    },

    async renameConversation(id, title) {
      const clean = title.trim();
      if (!clean) return;
      patchLocal(id, { title: clean.slice(0, 60) });
      try {
        applyConversation(await api.patchConversation(id, { title: clean.slice(0, 60) }));
      } catch (err) {
        set({ error: describeError(err) });
      }
    },

    async deleteConversation(id) {
      const conversations = { ...get().conversations };
      delete conversations[id];
      const remainingMessages = { ...get().messages };
      delete remainingMessages[id];
      const order = sortConversations(Object.values(conversations));

      set({
        conversations,
        messages: remainingMessages,
        order,
        activeId: get().activeId === id ? (order[0] ?? null) : get().activeId,
      });

      // One call: the worker deletes the conversation, its messages and their
      // blobs together, so a half-deleted conversation is not a thing that can
      // survive a closed tab.
      try {
        await api.deleteConversation(id);
      } catch (err) {
        set({ error: describeError(err) });
      }

      const next = get().activeId;
      if (next) await get().selectConversation(next);
    },

    async togglePin(id) {
      const conv = get().conversations[id];
      if (!conv) return;
      patchLocal(id, { pinned: !conv.pinned });
      try {
        applyConversation(await api.patchConversation(id, { pinned: !conv.pinned }));
      } catch (err) {
        set({ error: describeError(err) });
      }
    },

    async addFiles(list) {
      const incoming = Array.from(list);
      if (incoming.length === 0) return;
      set({ uploading: true, error: null });
      try {
        const uploaded: Attachment[] = [];
        for (const file of incoming) uploaded.push(await uploadAttachment(file));
        set({ pending: [...get().pending, ...uploaded] });
      } catch (err) {
        set({ error: describeError(err) });
      } finally {
        set({ uploading: false });
      }
    },

    async removePending(id) {
      const target = get().pending.find((a) => a.id === id);
      set({ pending: get().pending.filter((a) => a.id !== id) });
      if (target) await deleteAttachment(target);
    },

    async setModel(model) {
      const prefs = { ...get().prefs, model };
      set({ prefs });
      await api.savePrefs(prefs).catch((err: unknown) => set({ error: describeError(err) }));
    },

    async toggleSource(source) {
      const prefs = {
        ...get().prefs,
        sources: { ...get().prefs.sources, [source]: !get().prefs.sources[source] },
      };
      set({ prefs });
      await api.savePrefs(prefs).catch((err: unknown) => set({ error: describeError(err) }));
    },

    setSearch(value) {
      set({ search: value });
    },

    setSidebarOpen(open) {
      set({ sidebarOpen: open });
    },

    dismissError() {
      set({ error: null });
    },
  };
});

export { ApiError };
