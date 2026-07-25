import { create } from "zustand";
import { generateTitle, runAgent, stopReasonNote } from "@/lib/agent";
import { deleteAttachment, uploadAttachment } from "@/lib/attachments";
import { describeError } from "@/lib/errors";
import { conversationPrefix, messageKey, newId } from "@/lib/ids";
import {
  DEFAULT_PREFS,
  type Attachment,
  type Conversation,
  type Message,
  type Prefs,
  type SourceId,
  type ToolStep,
} from "@/lib/types";

/** All chat data is per-user: `db.user` is the caller's own private namespace,
 *  so history is isolated by the server rather than by a key prefix we have to
 *  remember to apply. */
const conversationsCol = () => db.user.collection<Conversation>("conversations");
const messagesCol = () => db.user.collection<Message>("messages");
const prefsCol = () => db.user.collection<Prefs>("prefs");

const PREFS_KEY = "prefs";
const PAGE_SIZE = 200;

/** Records written before a field existed must not crash the read path — there
 *  are no migrations in KV, so every load backfills. */
function hydrateMessage(raw: Message): Message {
  return {
    ...raw,
    attachments: raw.attachments ?? [],
    steps: (raw.steps ?? []).map((step) => ({ ...step, thought: step.thought ?? "" })),
    error: raw.error ?? null,
    model: raw.model ?? null,
    usage: raw.usage ?? null,
  };
}

function hydrateConversation(raw: Conversation): Conversation {
  return {
    ...raw,
    preview: raw.preview ?? "",
    messageCount: raw.messageCount ?? 0,
    pinned: raw.pinned ?? false,
  };
}

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
  orgName: string;

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
  /** Aborted by `stop()`. The SDK cancels the loop between steps and chunks and
   *  resolves normally with `stopReason: "aborted"`, so stopping is a branch on
   *  the result rather than a thrown error to catch. */
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

  const persistConversation = async (conv: Conversation) => {
    await conversationsCol().put(conv.id, conv);
  };

  const touchConversation = async (
    convId: string,
    patch: Partial<Conversation>,
  ): Promise<void> => {
    const existing = get().conversations[convId];
    if (!existing) return;
    const next: Conversation = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const conversations = { ...get().conversations, [convId]: next };
    set({ conversations, order: sortConversations(Object.values(conversations)) });
    await persistConversation(next);
  };

  const loadMessages = async (convId: string): Promise<Message[]> => {
    const collected: Message[] = [];
    for (let page = 1; ; page += 1) {
      const rows = await messagesCol()
        .prefix(conversationPrefix(convId))
        .orderBy("key", "asc")
        .page(page, PAGE_SIZE);
      for (const row of rows) collected.push(hydrateMessage(row.value));
      if (rows.length < PAGE_SIZE) break;
    }
    return collected;
  };

  return {
    ready: false,
    bootError: null,
    error: null,
    userName: "",
    userEmail: "",
    orgName: "",
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
      if (typeof me === "undefined") {
        set({
          bootError:
            "The Railcode SDK did not load. Open this app through `railcode dev` (usually http://127.0.0.1:7331), not the raw Vite URL.",
        });
        return;
      }
      try {
        const [identity, rows, storedPrefs] = await Promise.all([
          me(),
          conversationsCol().query().orderBy("updatedAt", "desc").page(1, PAGE_SIZE),
          prefsCol().get(PREFS_KEY),
        ]);

        // The model catalog is a nice-to-have: an org with no providers
        // configured should still render the app, just without a picker.
        const providers = await llmProviders().catch(() => [] as LlmProviderInfo[]);

        const conversations: Record<string, Conversation> = {};
        for (const row of rows) conversations[row.value.id] = hydrateConversation(row.value);
        const order = sortConversations(Object.values(conversations));

        set({
          ready: true,
          userName: identity.user.name || identity.user.email || "You",
          userEmail: identity.user.email || "",
          orgName: identity.org.name || identity.org.slug || "your organization",
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
        const loaded = await loadMessages(id);
        set({ messages: { ...get().messages, [id]: loaded } });
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
      const now = new Date().toISOString();
      let convId = get().activeId;
      let isNew = false;

      if (!convId) {
        isNew = true;
        convId = newId("conv");
        const conv: Conversation = {
          id: convId,
          title: trimmed ? trimmed.slice(0, 60) : "New chat",
          createdAt: now,
          updatedAt: now,
          preview: trimmed.slice(0, 120),
          messageCount: 0,
          pinned: false,
        };
        const conversations = { ...get().conversations, [convId]: conv };
        set({
          conversations,
          order: sortConversations(Object.values(conversations)),
          activeId: convId,
          messages: { ...get().messages, [convId]: [] },
        });
        await persistConversation(conv);
      }

      const history = get().messages[convId] ?? [];
      const userMessage: Message = {
        id: newId("msg"),
        convId,
        seq: history.length,
        role: "user",
        content: trimmed,
        createdAt: now,
        attachments,
        steps: [],
        error: null,
        model: null,
        usage: null,
      };

      set({
        messages: { ...get().messages, [convId]: [...history, userMessage] },
        pending: [],
        busy: true,
        error: null,
        stream: { convId, messageId: newId("msg"), content: "", steps: [] },
      });

      await messagesCol().put(
        messageKey(convId, userMessage.seq, userMessage.id),
        userMessage,
      );

      const { prefs, orgName, userName } = get();
      let assistant: Message;

      try {
        const run = await runAgent(
          {
            history,
            question: trimmed,
            attachments,
            prefs,
            orgName,
            userName,
            signal: controller.signal,
          },
          {
            onStep: (step) => {
              const stream = get().stream;
              if (!stream) return;
              const steps = stream.steps.some((s) => s.id === step.id)
                ? stream.steps.map((s) => (s.id === step.id ? { ...step } : s))
                : [...stream.steps, { ...step }];
              set({ stream: { ...stream, steps } });
            },
            onDelta: queueDelta,
          },
        );

        flushDelta();
        const stream = get().stream;
        const content = run.content || stream?.content || "";
        assistant = {
          id: stream?.messageId ?? newId("msg"),
          convId,
          seq: userMessage.seq + 1,
          role: "assistant",
          content,
          createdAt: new Date().toISOString(),
          attachments: [],
          steps: run.steps,
          // A bounded run is not a failure, but the turn has to say why it ended
          // early or the user reads a truncated answer as the whole answer.
          error:
            run.stopReason === "aborted"
              ? "Stopped."
              : stopReasonNote(run.stopReason, Boolean(content.trim())),
          model: run.model,
          usage: run.usage,
        };
      } catch (err) {
        flushDelta();
        const stream = get().stream;
        assistant = {
          id: stream?.messageId ?? newId("msg"),
          convId,
          seq: userMessage.seq + 1,
          role: "assistant",
          content: stream?.content ?? "",
          createdAt: new Date().toISOString(),
          attachments: [],
          steps: stream?.steps ?? [],
          error: describeError(err),
          model: null,
          usage: null,
        };
      }

      cancelPendingFlush();
      const current = get().messages[convId] ?? [];
      set({
        messages: { ...get().messages, [convId]: [...current, assistant] },
        stream: null,
        busy: false,
      });

      await messagesCol()
        .put(messageKey(convId, assistant.seq, assistant.id), assistant)
        .catch((err: unknown) => {
          set({ error: `The reply was not saved: ${describeError(err)}` });
        });

      await touchConversation(convId, {
        preview: (assistant.content || trimmed).slice(0, 120),
        messageCount: (get().messages[convId] ?? []).length,
      });

      // Title last: it costs an LLM call, and a failure here must not affect
      // the conversation that was just saved successfully.
      if (isNew && trimmed) {
        try {
          const title = await generateTitle(trimmed, get().prefs.model);
          if (title) await touchConversation(convId, { title });
        } catch {
          /* keep the truncated-question fallback */
        }
      }
    },

    stop() {
      controller?.abort();
    },

    async renameConversation(id, title) {
      const clean = title.trim();
      if (!clean) return;
      await touchConversation(id, { title: clean.slice(0, 60) });
    },

    async deleteConversation(id) {
      const messages = get().messages[id] ?? (await loadMessages(id));
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

      await Promise.all([
        ...messages.map((m) =>
          messagesCol().delete(messageKey(id, m.seq, m.id)).catch(() => undefined),
        ),
        // KV holds only the attachment metadata; the blobs need their own cleanup.
        ...messages.flatMap((m) => m.attachments.map((att) => deleteAttachment(att))),
        conversationsCol().delete(id),
      ]);

      const next = get().activeId;
      if (next) await get().selectConversation(next);
    },

    async togglePin(id) {
      const conv = get().conversations[id];
      if (!conv) return;
      await touchConversation(id, { pinned: !conv.pinned });
    },

    async addFiles(list) {
      const incoming = Array.from(list);
      if (incoming.length === 0) return;
      set({ uploading: true, error: null });
      try {
        const uploaded: Attachment[] = [];
        for (const file of incoming) {
          uploaded.push(await uploadAttachment(file));
        }
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
      await prefsCol().put(PREFS_KEY, prefs);
    },

    async toggleSource(source) {
      const prefs = {
        ...get().prefs,
        sources: { ...get().prefs.sources, [source]: !get().prefs.sources[source] },
      };
      set({ prefs });
      await prefsCol().put(PREFS_KEY, prefs);
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
