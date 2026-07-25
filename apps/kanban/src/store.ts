import { create } from "zustand";
import type {
  Attachment,
  AssigneeOption,
  Card,
  DoneFilter,
  Priority,
  SortKey,
  Status,
  View,
} from "./types";

const COLLECTION = "cards";

// Cards are a shared team board — every org member sees every card, so they
// can be assigned to (and filtered by) each other. New card keys keep the
// `creatorUuid:id` shape for continuity with cards written before the board
// was shared, but nothing scopes reads by it anymore (see loadCards below).
function keyFor(userUuid: string, id: string): string {
  return `${userUuid}:${id}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// done_at bookkeeping as a card crosses the Done boundary.
function resolveDoneAt(next: Status, prevDoneAt: string | null): string | null {
  if (next === "done") return prevDoneAt ?? nowIso();
  return null;
}

// Collapsed-column state is a per-user view preference, so it lives in
// localStorage (namespaced by uuid) rather than churning the KV store.
type Collapsed = Record<Status, boolean>;
const NO_COLLAPSE: Collapsed = {
  future: false,
  todo: false,
  in_progress: false,
  done: false,
};

function collapseKey(uuid: string): string {
  return `kanban.collapsed.${uuid}`;
}
function loadCollapsed(uuid: string): Collapsed {
  try {
    const raw = localStorage.getItem(collapseKey(uuid));
    return raw ? { ...NO_COLLAPSE, ...JSON.parse(raw) } : { ...NO_COLLAPSE };
  } catch {
    return { ...NO_COLLAPSE };
  }
}
function saveCollapsed(uuid: string, c: Collapsed): void {
  try {
    localStorage.setItem(collapseKey(uuid), JSON.stringify(c));
  } catch {
    /* storage unavailable — keep it in memory only */
  }
}

// Per-column sort is likewise a persisted per-user view preference.
type Sorts = Record<Status, SortKey>;
const DEFAULT_SORTS: Sorts = {
  future: "manual",
  todo: "manual",
  in_progress: "manual",
  done: "manual",
};

function sortsKey(uuid: string): string {
  return `kanban.sorts.${uuid}`;
}
function loadSorts(uuid: string): Sorts {
  try {
    const raw = localStorage.getItem(sortsKey(uuid));
    return raw ? { ...DEFAULT_SORTS, ...JSON.parse(raw) } : { ...DEFAULT_SORTS };
  } catch {
    return { ...DEFAULT_SORTS };
  }
}
function saveSorts(uuid: string, s: Sorts): void {
  try {
    localStorage.setItem(sortsKey(uuid), JSON.stringify(s));
  } catch {
    /* storage unavailable — keep it in memory only */
  }
}

// Filters (search text, tag filter, done-date filter) persist per user too, so
// a board opens back up filtered the way it was left.
interface PersistedFilters {
  search: string;
  tagFilter: string[];
  priorityFilter: Priority[];
  assigneeFilter: string[];
  doneFilter: DoneFilter;
}
const DEFAULT_FILTERS: PersistedFilters = {
  search: "",
  tagFilter: [],
  priorityFilter: [],
  assigneeFilter: [],
  doneFilter: { preset: "all", from: "", to: "" },
};

function filtersKey(uuid: string): string {
  return `kanban.filters.${uuid}`;
}
function loadFilters(uuid: string): PersistedFilters {
  try {
    const raw = localStorage.getItem(filtersKey(uuid));
    return raw ? { ...DEFAULT_FILTERS, ...JSON.parse(raw) } : { ...DEFAULT_FILTERS };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}
function saveFilters(uuid: string, f: PersistedFilters): void {
  try {
    localStorage.setItem(filtersKey(uuid), JSON.stringify(f));
  } catch {
    /* storage unavailable — keep it in memory only */
  }
}

export interface NewCardInput {
  title: string;
  description?: string;
  tags?: string[];
  assignee?: string | null;
  priority?: Priority | null;
  status?: Status;
}

interface KanbanState {
  userUuid: string;
  userName: string;
  userEmail: string;

  cards: Record<string, Card>;
  loading: boolean;
  error: string | null;

  // View / filter / sort state
  view: View;
  sorts: Sorts;
  search: string;
  tagFilter: string[];
  priorityFilter: Priority[];
  assigneeFilter: string[];
  doneFilter: DoneFilter;
  collapsed: Collapsed;

  // Assignable org members, from the Railcode appUsers() SDK global
  assignees: AssigneeOption[];
  assigneesLoading: boolean;
  assigneesError: string | null;

  // Transient UI
  paletteOpen: boolean;
  createSeed: { title: string; tags: string[]; priority: Priority | null } | null;
  drawerCardId: string | null;
  sidebarOpen: boolean;
  flashCardId: string | null;

  init: () => Promise<void>;
  addCard: (input: NewCardInput) => Promise<string>;
  updateCard: (id: string, patch: Partial<Card>) => Promise<void>;
  deleteCard: (id: string) => Promise<void>;
  addAttachment: (id: string, file: File) => Promise<void>;
  removeAttachment: (id: string, attachmentId: string) => Promise<void>;
  setCardStatus: (id: string, status: Status) => Promise<void>;
  reorderCard: (id: string, status: Status, order: number) => Promise<void>;
  topOrder: (status: Status) => number;

  setView: (view: View) => void;
  setSort: (status: Status, sort: SortKey) => void;
  setSearch: (search: string) => void;
  toggleTagFilter: (tag: string) => void;
  clearTagFilter: () => void;
  togglePriorityFilter: (p: Priority) => void;
  clearPriorityFilter: () => void;
  toggleAssigneeFilter: (uuid: string) => void;
  clearAssigneeFilter: () => void;
  setDoneFilter: (f: DoneFilter) => void;
  toggleCollapse: (status: Status) => void;
  loadAssignees: () => Promise<void>;

  openPalette: () => void;
  closePalette: () => void;
  openCreate: (seed: { title: string; tags: string[]; priority: Priority | null }) => void;
  closeCreate: () => void;
  openDrawer: (id: string) => void;
  closeDrawer: () => void;
  setSidebar: (open: boolean) => void;
  flash: (id: string | null) => void;
}

export const useStore = create<KanbanState>((set, get) => {
  const collection = () => db.collection<Card>(COLLECTION);
  const persist = (card: Card) => collection().put(keyFor(get().userUuid, card.id), card);
  const persistFilters = () => {
    const s = get();
    saveFilters(s.userUuid, {
      search: s.search,
      tagFilter: s.tagFilter,
      priorityFilter: s.priorityFilter,
      assigneeFilter: s.assigneeFilter,
      doneFilter: s.doneFilter,
    });
  };

  return {
    userUuid: "",
    userName: "",
    userEmail: "",

    cards: {},
    loading: true,
    error: null,

    view: "board",
    sorts: { ...DEFAULT_SORTS },
    search: "",
    tagFilter: [],
    priorityFilter: [],
    assigneeFilter: [],
    doneFilter: { preset: "all", from: "", to: "" },
    collapsed: { ...NO_COLLAPSE },

    assignees: [],
    assigneesLoading: true,
    assigneesError: null,

    paletteOpen: false,
    createSeed: null,
    drawerCardId: null,
    sidebarOpen: false,
    flashCardId: null,

    init: async () => {
      try {
        if (typeof me === "undefined") {
          throw new Error(
            "Railcode SDK not loaded — open the app through `railcode dev`, not the raw Vite URL.",
          );
        }
        const who = await me();
        set({
          userUuid: who.user.uuid,
          userName: who.user.name || who.user.email || "You",
          userEmail: who.user.email || "",
          collapsed: loadCollapsed(who.user.uuid),
          sorts: loadSorts(who.user.uuid),
          ...loadFilters(who.user.uuid),
        });

        // Cards are the shared team board — load every card in the
        // collection (not just this user's), paging through in a stable
        // order since there's no prefix to scan by anymore.
        const cards: Record<string, Card> = {};
        let pageNum = 1;
        const size = 200;
        for (;;) {
          const rows = await collection()
            .query()
            .orderBy("created_at", "asc")
            .page(pageNum, size);
          for (const row of rows) {
            if (row.value && row.value.id) {
              // Backfill assignee/attachments for cards created before those fields existed.
              cards[row.value.id] = {
                ...row.value,
                assignee: row.value.assignee ?? null,
                attachments: row.value.attachments ?? [],
              };
            }
          }
          if (rows.length < size) break;
          pageNum += 1;
        }
        set({ cards, loading: false });

        // Load assignable teammates in the background (non-blocking).
        void get().loadAssignees();
      } catch (err) {
        set({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    topOrder: (status) => {
      const inCol = Object.values(get().cards).filter((c) => c.status === status);
      if (inCol.length === 0) return 0;
      return Math.min(...inCol.map((c) => c.order)) - 1;
    },

    addCard: async (input) => {
      const status = input.status ?? "todo";
      const id = newId();
      const now = nowIso();
      const card: Card = {
        id,
        title: input.title.trim() || "Untitled",
        description: input.description?.trim() ?? "",
        status,
        priority: (input.priority ?? 2) as Priority,
        tags: input.tags ?? [],
        assignee: input.assignee ?? null,
        attachments: [],
        created_at: now,
        updated_at: now,
        done_at: status === "done" ? now : null,
        order: get().topOrder(status),
      };
      set((s) => ({ cards: { ...s.cards, [id]: card } }));
      try {
        await persist(card);
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
      return id;
    },

    updateCard: async (id, patch) => {
      const prev = get().cards[id];
      if (!prev) return;
      const next: Card = { ...prev, ...patch, updated_at: nowIso() };
      // Keep done_at consistent if status changed through this path.
      if (patch.status && patch.status !== prev.status) {
        next.done_at = resolveDoneAt(patch.status, prev.done_at);
      }
      set((s) => ({ cards: { ...s.cards, [id]: next } }));
      try {
        await persist(next);
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    deleteCard: async (id) => {
      const prev = get().cards[id];
      set((s) => {
        const cards = { ...s.cards };
        delete cards[id];
        return {
          cards,
          drawerCardId: s.drawerCardId === id ? null : s.drawerCardId,
        };
      });
      if (!prev) return;
      try {
        await collection().delete(keyFor(get().userUuid, id));
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
      // Best-effort: drop the card's uploaded blobs too, so they don't
      // linger as orphans in the app's shared file store.
      await Promise.all(
        prev.attachments.map((a) => files.delete(a.id).catch(() => {})),
      );
    },

    addAttachment: async (id, file) => {
      const prev = get().cards[id];
      if (!prev) return;
      const attachment: Attachment = {
        id: newId(),
        name: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        uploaded_at: nowIso(),
      };
      await files.upload(attachment.id, file, attachment.contentType);
      const next: Card = {
        ...prev,
        attachments: [...prev.attachments, attachment],
        updated_at: nowIso(),
      };
      set((s) => ({ cards: { ...s.cards, [id]: next } }));
      await persist(next);
    },

    removeAttachment: async (id, attachmentId) => {
      const prev = get().cards[id];
      if (!prev) return;
      const next: Card = {
        ...prev,
        attachments: prev.attachments.filter((a) => a.id !== attachmentId),
        updated_at: nowIso(),
      };
      set((s) => ({ cards: { ...s.cards, [id]: next } }));
      try {
        await persist(next);
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
      await files.delete(attachmentId).catch(() => {});
    },

    setCardStatus: async (id, status) => {
      const prev = get().cards[id];
      if (!prev || prev.status === status) return;
      await get().reorderCard(id, status, get().topOrder(status));
    },

    reorderCard: async (id, status, order) => {
      const prev = get().cards[id];
      if (!prev) return;
      const next: Card = {
        ...prev,
        status,
        order,
        done_at: status === prev.status ? prev.done_at : resolveDoneAt(status, prev.done_at),
        updated_at: nowIso(),
      };
      set((s) => ({ cards: { ...s.cards, [id]: next } }));
      try {
        await persist(next);
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    setView: (view) => set({ view }),
    setSort: (status, sort) => {
      const sorts = { ...get().sorts, [status]: sort };
      set({ sorts });
      saveSorts(get().userUuid, sorts);
    },
    setSearch: (search) => {
      set({ search });
      persistFilters();
    },
    toggleTagFilter: (tag) => {
      set((s) => ({
        tagFilter: s.tagFilter.includes(tag)
          ? s.tagFilter.filter((t) => t !== tag)
          : [...s.tagFilter, tag],
      }));
      persistFilters();
    },
    clearTagFilter: () => {
      set({ tagFilter: [] });
      persistFilters();
    },
    togglePriorityFilter: (p) => {
      set((s) => ({
        priorityFilter: s.priorityFilter.includes(p)
          ? s.priorityFilter.filter((x) => x !== p)
          : [...s.priorityFilter, p],
      }));
      persistFilters();
    },
    clearPriorityFilter: () => {
      set({ priorityFilter: [] });
      persistFilters();
    },
    toggleAssigneeFilter: (uuid) => {
      set((s) => ({
        assigneeFilter: s.assigneeFilter.includes(uuid)
          ? s.assigneeFilter.filter((a) => a !== uuid)
          : [...s.assigneeFilter, uuid],
      }));
      persistFilters();
    },
    clearAssigneeFilter: () => {
      set({ assigneeFilter: [] });
      persistFilters();
    },
    setDoneFilter: (doneFilter) => {
      set({ doneFilter });
      persistFilters();
    },

    toggleCollapse: (status) => {
      const collapsed = { ...get().collapsed, [status]: !get().collapsed[status] };
      set({ collapsed });
      saveCollapsed(get().userUuid, collapsed);
    },

    loadAssignees: async () => {
      set({ assigneesLoading: true, assigneesError: null });
      try {
        if (typeof appUsers === "undefined") {
          throw new Error("appUsers() unavailable");
        }
        const people = await appUsers();
        const assignees: AssigneeOption[] = people.map((p) => ({
          uuid: p.uuid,
          name: p.name || p.email || "Unknown",
          email: p.email || "",
        }));
        set({ assignees, assigneesLoading: false });
      } catch (err) {
        set({
          assigneesLoading: false,
          assigneesError: err instanceof Error ? err.message : String(err),
        });
      }
    },

    openPalette: () => set({ paletteOpen: true }),
    closePalette: () => set({ paletteOpen: false }),
    openCreate: (seed) => set({ createSeed: seed, paletteOpen: false }),
    closeCreate: () => set({ createSeed: null }),
    openDrawer: (id) => set({ drawerCardId: id }),
    closeDrawer: () => set({ drawerCardId: null }),
    setSidebar: (open) => set({ sidebarOpen: open }),
    flash: (id) => set({ flashCardId: id }),
  };
});
