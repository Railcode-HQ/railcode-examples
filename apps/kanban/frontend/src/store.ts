import { create } from "zustand";
import type {
  AssigneeOption,
  Card,
  DoneFilter,
  Priority,
  SortKey,
  Status,
  View,
} from "./types";
import { ApiError, api } from "./lib/api";
import { applyTheme, loadTheme, saveTheme, type ThemeSetting } from "./lib/theme";

// The store holds the board and the view state. It does not know how cards are
// stored, who may delete one, or that a platform exists — those all live in the
// worker (server/index.ts), reached through `api`.
//
// Every mutation below is optimistic: the local card changes first so the board
// stays responsive, then the worker call goes out. A rejection rolls the change
// back, because the worker's answer is the real one.

function nowIso(): string {
  return new Date().toISOString();
}

// done_at bookkeeping as a card crosses the Done boundary. The worker keeps its
// own copy of this rule — this one only makes the optimistic card look right
// until the worker's answer replaces it.
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
  userId: string;
  userName: string;
  userEmail: string;
  isAdmin: boolean;

  cards: Record<string, Card>;
  loading: boolean;
  error: string | null;

  // View / filter / sort state
  view: View;
  theme: ThemeSetting;
  sorts: Sorts;
  search: string;
  tagFilter: string[];
  priorityFilter: Priority[];
  assigneeFilter: string[];
  doneFilter: DoneFilter;
  collapsed: Collapsed;

  // Assignable org members, from the worker's /api/users route.
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
  setTheme: (theme: ThemeSetting) => void;
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
  const message = (err: unknown) =>
    err instanceof Error ? err.message : String(err);

  // Replace one card in place with whatever the worker returned. The worker is
  // the authority on the stored card, so its answer overwrites the optimistic one.
  const settle = (card: Card) => set((s) => ({ cards: { ...s.cards, [card.id]: card } }));

  // Put a card back the way it was, and surface why. Used when the worker
  // refuses (403 on someone else's delete) or the network drops.
  const rollback = (card: Card | undefined, err: unknown) => {
    if (card) set((s) => ({ cards: { ...s.cards, [card.id]: card } }));
    set({ error: message(err) });
  };

  const persistFilters = () => {
    const s = get();
    saveFilters(s.userId, {
      search: s.search,
      tagFilter: s.tagFilter,
      priorityFilter: s.priorityFilter,
      assigneeFilter: s.assigneeFilter,
      doneFilter: s.doneFilter,
    });
  };

  return {
    userId: "",
    userName: "",
    userEmail: "",
    isAdmin: false,

    cards: {},
    loading: true,
    error: null,

    view: "board",
    theme: loadTheme(),
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
        const who = await api.me();
        set({
          userId: who.id,
          userName: who.name || who.email || "You",
          userEmail: who.email || "",
          isAdmin: who.is_admin,
          collapsed: loadCollapsed(who.id),
          sorts: loadSorts(who.id),
          ...loadFilters(who.id),
        });

        // One route, one answer: the worker pages the whole shared board and
        // hands it back. Paging is its job, not the browser's.
        const rows = await api.listCards();
        const cards: Record<string, Card> = {};
        for (const card of rows) {
          // Backfill fields for cards written before they existed.
          cards[card.id] = {
            ...card,
            assignee: card.assignee ?? null,
            attachments: card.attachments ?? [],
          };
        }
        set({ cards, loading: false });

        // Load assignable teammates in the background (non-blocking).
        void get().loadAssignees();
      } catch (err) {
        set({ loading: false, error: message(err) });
      }
    },

    topOrder: (status) => {
      const inCol = Object.values(get().cards).filter((c) => c.status === status);
      if (inCol.length === 0) return 0;
      return Math.min(...inCol.map((c) => c.order)) - 1;
    },

    addCard: async (input) => {
      const status = input.status ?? "todo";
      const now = nowIso();
      // A temporary id so the card can render immediately. The worker mints the
      // real one — a client-chosen id is a client-chosen key, and the worker
      // never lets the caller pick where a record lands.
      const tempId = `pending_${now}_${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: Card = {
        id: tempId,
        title: input.title.trim() || "Untitled",
        description: input.description?.trim() ?? "",
        status,
        priority: (input.priority ?? 2) as Priority,
        tags: input.tags ?? [],
        assignee: input.assignee ?? null,
        attachments: [],
        created_by: get().userId,
        created_at: now,
        updated_at: now,
        done_at: status === "done" ? now : null,
        order: get().topOrder(status),
      };
      set((s) => ({ cards: { ...s.cards, [tempId]: optimistic } }));
      try {
        const saved = await api.createCard({
          title: optimistic.title,
          description: optimistic.description,
          status: optimistic.status,
          priority: optimistic.priority,
          tags: optimistic.tags,
          assignee: optimistic.assignee,
          order: optimistic.order,
        });
        set((s) => {
          const cards = { ...s.cards };
          delete cards[tempId];
          cards[saved.id] = saved;
          return { cards };
        });
        return saved.id;
      } catch (err) {
        set((s) => {
          const cards = { ...s.cards };
          delete cards[tempId];
          return { cards, error: message(err) };
        });
        return tempId;
      }
    },

    updateCard: async (id, patch) => {
      const prev = get().cards[id];
      if (!prev) return;
      const next: Card = { ...prev, ...patch, updated_at: nowIso() };
      if (patch.status && patch.status !== prev.status) {
        next.done_at = resolveDoneAt(patch.status, prev.done_at);
      }
      set((s) => ({ cards: { ...s.cards, [id]: next } }));
      try {
        settle(await api.patchCard(id, patch));
      } catch (err) {
        rollback(prev, err);
      }
    },

    deleteCard: async (id) => {
      const prev = get().cards[id];
      if (!prev) return;
      set((s) => {
        const cards = { ...s.cards };
        delete cards[id];
        return {
          cards,
          drawerCardId: s.drawerCardId === id ? null : s.drawerCardId,
        };
      });
      try {
        await api.deleteCard(id);
      } catch (err) {
        // The worker allows a delete only to the card's author or an org admin.
        // A 403 here is the rule working, not a fault — so say so plainly and
        // put the card back rather than leaving the board lying to the user.
        rollback(
          prev,
          err instanceof ApiError && err.status === 403
            ? new Error("Only the card's author or an org admin can delete it.")
            : err,
        );
      }
    },

    addAttachment: async (id, file) => {
      if (!get().cards[id]) return;
      try {
        // The bytes go to the worker, which stores them and returns the card
        // with the new attachment on it — one round trip, one source of truth.
        settle(await api.addAttachment(id, file));
      } catch (err) {
        set({ error: message(err) });
      }
    },

    removeAttachment: async (id, attachmentId) => {
      const prev = get().cards[id];
      if (!prev) return;
      set((s) => ({
        cards: {
          ...s.cards,
          [id]: {
            ...prev,
            attachments: prev.attachments.filter((a) => a.id !== attachmentId),
          },
        },
      }));
      try {
        settle(await api.removeAttachment(id, attachmentId));
      } catch (err) {
        rollback(prev, err);
      }
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
        settle(await api.patchCard(id, { status, order: next.order }));
      } catch (err) {
        rollback(prev, err);
      }
    },

    setView: (view) => set({ view }),
    setTheme: (theme) => {
      saveTheme(theme);
      applyTheme(theme);
      set({ theme });
    },
    setSort: (status, sort) => {
      const sorts = { ...get().sorts, [status]: sort };
      set({ sorts });
      saveSorts(get().userId, sorts);
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
      saveCollapsed(get().userId, collapsed);
    },

    loadAssignees: async () => {
      set({ assigneesLoading: true, assigneesError: null });
      try {
        const people = await api.users();
        const assignees: AssigneeOption[] = people.map((p) => ({
          id: p.id,
          name: p.name || p.email || "Unknown",
          email: p.email || "",
        }));
        set({ assignees, assigneesLoading: false });
      } catch (err) {
        set({ assigneesLoading: false, assigneesError: message(err) });
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
