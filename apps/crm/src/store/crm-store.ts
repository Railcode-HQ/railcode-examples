import { create } from "zustand";

import {
  ActionItem,
  Activity,
  CallNote,
  CallTranscript,
  Company,
  Contact,
  Deal,
  EntityType,
  Priority,
  StageId,
  cleanError,
  newId,
  nowIso,
  stage,
} from "@/lib/crm";
import { ParsedCommand } from "@/lib/parse";
import { Identity, collection, getIdentity } from "@/lib/railcode";
import { View, canonicalizePath, pushView, viewFromPath } from "@/lib/routes";

export type { View };

export type RecordRoute =
  | { mode: "view"; type: EntityType; id: string }
  | {
      mode: "create";
      type: EntityType;
      companyId?: string;
      contactId?: string;
    }
  | null;

type CompanyInput = Partial<Company> & { name: string };
type ContactInput = Partial<Contact> & { name: string };
type DealInput = Partial<Deal> & { title: string };
type ActionItemInput = {
  id?: string;
  dealId: string;
  title: string;
  priority: Priority;
  dueDate?: string;
  done?: boolean;
};

type CrmState = {
  identity?: Identity;
  loaded: boolean;
  error?: string;

  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
  activities: Activity[];
  callNotes: CallNote[];
  actionItems: ActionItem[];

  view: View;
  search: string;
  record: RecordRoute;
  navOpen: boolean;
  commandOpen: boolean;

  setView: (v: View) => void;
  /** Adopt the view the URL names — for the browser's Back/Forward buttons. */
  syncFromUrl: () => void;
  setSearch: (s: string) => void;
  setNavOpen: (b: boolean) => void;
  setCommandOpen: (b: boolean) => void;
  openRecord: (type: EntityType, id: string) => void;
  /** Open a record on the list view it belongs to, URL included. */
  showRecord: (view: View, type: EntityType, id: string) => void;
  openCreate: (
    type: EntityType,
    preset?: { companyId?: string; contactId?: string },
  ) => void;
  closeRecord: () => void;
  clearError: () => void;

  bootstrap: () => Promise<void>;

  saveCompany: (input: CompanyInput) => Promise<Company>;
  saveContact: (input: ContactInput) => Promise<Contact>;
  saveDeal: (input: DealInput) => Promise<Deal>;
  deleteCompany: (id: string) => Promise<void>;
  deleteContact: (id: string) => Promise<void>;
  deleteDeal: (id: string) => Promise<void>;
  moveDeal: (id: string, toStage: StageId) => Promise<void>;
  addNote: (type: EntityType, id: string, body: string) => Promise<void>;
  saveCallNote: (note: CallNote) => Promise<void>;
  deleteCallNote: (note: CallNote) => Promise<void>;
  saveActionItem: (input: ActionItemInput) => Promise<ActionItem>;
  toggleActionItem: (id: string) => Promise<void>;
  deleteActionItem: (id: string) => Promise<void>;
  loadTranscript: (meetingId: string) => Promise<string | null>;
  saveTranscript: (meetingId: string, text: string) => Promise<void>;
  setCompanyLogo: (id: string, logo: string) => Promise<void>;
  refreshActivities: () => Promise<void>;

  findCompanyByName: (name: string) => Company | undefined;
  applyCommand: (parsed: ParsedCommand) => Promise<void>;
};

const companiesCol = () => collection<Company>("companies");
const contactsCol = () => collection<Contact>("contacts");
const dealsCol = () => collection<Deal>("deals");
const activitiesCol = () => collection<Activity>("activities");
const callNotesCol = () => collection<CallNote>("callNotes");
const actionItemsCol = () => collection<ActionItem>("actionItems");
/** Transcript bodies, keyed by CallNote.meetingId — never loaded with the notes. */
const transcriptsCol = () => collection<CallTranscript>("callTranscripts");

const norm = (s: string) => s.trim().toLowerCase();

export const useCrmStore = create<CrmState>((set, get) => {
  // --- internal helpers -----------------------------------------------------

  async function logEvent(type: EntityType, id: string, body: string) {
    const activity: Activity = {
      id: newId("act"),
      entityType: type,
      entityId: id,
      kind: "event",
      body,
      createdAt: nowIso(),
      author: get().identity?.user.name,
    };
    await activitiesCol().put(activity.id, activity);
    set((s) => ({ activities: [activity, ...s.activities] }));
  }

  return {
    loaded: false,
    companies: [],
    contacts: [],
    deals: [],
    activities: [],
    callNotes: [],
    actionItems: [],
    // The URL is the source of truth for which tab is showing, from the very
    // first render — a deep link shouldn't flash Home on the way in.
    view: viewFromPath(window.location.pathname),
    search: "",
    record: null,
    navOpen: false,
    commandOpen: false,

    // Switching lists closes any open record page and returns to that list.
    setView: (view) => {
      set({ view, record: null, navOpen: false });
      pushView(view);
    },

    // Back/Forward moved the URL; follow it without pushing another entry.
    // Matching on the view we already hold is what keeps showRecord's record
    // from being closed right after it opens.
    syncFromUrl: () => {
      const view = viewFromPath(window.location.pathname);
      canonicalizePath(view);
      if (get().view === view) return;
      set({ view, record: null });
    },

    setSearch: (search) => set({ search }),
    setNavOpen: (navOpen) => set({ navOpen }),
    setCommandOpen: (commandOpen) => set({ commandOpen }),
    openRecord: (type, id) => set({ record: { mode: "view", type, id } }),
    showRecord: (view, type, id) => {
      set({ view, record: { mode: "view", type, id } });
      pushView(view);
    },
    openCreate: (type, preset) =>
      set({ record: { mode: "create", type, ...preset } }),
    closeRecord: () => set({ record: null }),
    clearError: () => set({ error: undefined }),

    async bootstrap() {
      try {
        const [identity, companies, contacts, deals, activities, callNotes, actionItems] =
          await Promise.all([
            getIdentity(),
            companiesCol().list(),
            contactsCol().list(),
            dealsCol().list(),
            activitiesCol().list(),
            callNotesCol().list(),
            actionItemsCol().list(),
          ]);
        set({
          identity,
          companies: companies.map((r) => r.value),
          contacts: contacts.map((r) => r.value),
          deals: deals.map((r) => r.value),
          activities: activities
            .map((r) => r.value)
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
          callNotes: callNotes
            .map((r) => r.value)
            .sort((a, b) => (a.date < b.date ? 1 : -1)),
          actionItems: actionItems.map((r) => r.value),
          loaded: true,
        });
      } catch (error) {
        set({ error: cleanError(error), loaded: true });
      }
    },

    async saveCompany(input) {
      const existing = input.id
        ? get().companies.find((c) => c.id === input.id)
        : undefined;
      const ts = nowIso();
      const company: Company = {
        id: existing?.id ?? newId("co"),
        name: input.name.trim(),
        domain: input.domain?.trim() || undefined,
        industry: input.industry?.trim() || undefined,
        notes: input.notes ?? existing?.notes,
        logo: input.logo ?? existing?.logo,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
      };
      try {
        await companiesCol().put(company.id, company);
        set((s) => ({
          companies: existing
            ? s.companies.map((c) => (c.id === company.id ? company : c))
            : [company, ...s.companies],
        }));
        if (!existing) await logEvent("company", company.id, "Company created");
        return company;
      } catch (error) {
        set({ error: cleanError(error) });
        throw error;
      }
    },

    async saveContact(input) {
      const existing = input.id
        ? get().contacts.find((c) => c.id === input.id)
        : undefined;
      const ts = nowIso();
      const contact: Contact = {
        id: existing?.id ?? newId("ct"),
        name: input.name.trim(),
        email: input.email?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        title: input.title?.trim() || undefined,
        companyId: "companyId" in input ? input.companyId : existing?.companyId,
        notes: input.notes ?? existing?.notes,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
      };
      try {
        await contactsCol().put(contact.id, contact);
        set((s) => ({
          contacts: existing
            ? s.contacts.map((c) => (c.id === contact.id ? contact : c))
            : [contact, ...s.contacts],
        }));
        if (!existing) await logEvent("contact", contact.id, "Contact created");
        return contact;
      } catch (error) {
        set({ error: cleanError(error) });
        throw error;
      }
    },

    async saveDeal(input) {
      const existing = input.id
        ? get().deals.find((d) => d.id === input.id)
        : undefined;
      const ts = nowIso();
      const nextStage = (input.stage ?? existing?.stage ?? "new") as StageId;
      const deal: Deal = {
        id: existing?.id ?? newId("dl"),
        title: input.title.trim(),
        value: "value" in input ? input.value : existing?.value,
        stage: nextStage,
        companyId: "companyId" in input ? input.companyId : existing?.companyId,
        contactId: "contactId" in input ? input.contactId : existing?.contactId,
        notes: input.notes ?? existing?.notes,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
      };
      try {
        await dealsCol().put(deal.id, deal);
        set((s) => ({
          deals: existing
            ? s.deals.map((d) => (d.id === deal.id ? deal : d))
            : [deal, ...s.deals],
        }));
        if (!existing) {
          await logEvent("deal", deal.id, "Deal created");
        } else if (existing.stage !== deal.stage) {
          await logEvent("deal", deal.id, `Stage → ${stage(deal.stage).label}`);
        }
        return deal;
      } catch (error) {
        set({ error: cleanError(error) });
        throw error;
      }
    },

    async moveDeal(id, toStage) {
      const deal = get().deals.find((d) => d.id === id);
      if (!deal || deal.stage === toStage) return;
      await get().saveDeal({ id, title: deal.title, stage: toStage });
    },

    async deleteCompany(id) {
      try {
        await companiesCol().delete(id);
        // unset references on contacts + deals
        const orphanContacts = get().contacts.filter((c) => c.companyId === id);
        const orphanDeals = get().deals.filter((d) => d.companyId === id);
        await Promise.all([
          ...orphanContacts.map((c) =>
            contactsCol().put(c.id, { ...c, companyId: undefined }),
          ),
          ...orphanDeals.map((d) =>
            dealsCol().put(d.id, { ...d, companyId: undefined }),
          ),
        ]);
        await purgeActivities("company", id);
        set((s) => ({
          companies: s.companies.filter((c) => c.id !== id),
          contacts: s.contacts.map((c) =>
            c.companyId === id ? { ...c, companyId: undefined } : c,
          ),
          deals: s.deals.map((d) =>
            d.companyId === id ? { ...d, companyId: undefined } : d,
          ),
          activities: s.activities.filter(
            (a) => !(a.entityType === "company" && a.entityId === id),
          ),
          record: null,
        }));
      } catch (error) {
        set({ error: cleanError(error) });
      }
    },

    async deleteContact(id) {
      try {
        await contactsCol().delete(id);
        const orphanDeals = get().deals.filter((d) => d.contactId === id);
        await Promise.all(
          orphanDeals.map((d) =>
            dealsCol().put(d.id, { ...d, contactId: undefined }),
          ),
        );
        await purgeActivities("contact", id);
        set((s) => ({
          contacts: s.contacts.filter((c) => c.id !== id),
          deals: s.deals.map((d) =>
            d.contactId === id ? { ...d, contactId: undefined } : d,
          ),
          activities: s.activities.filter(
            (a) => !(a.entityType === "contact" && a.entityId === id),
          ),
          record: null,
        }));
      } catch (error) {
        set({ error: cleanError(error) });
      }
    },

    async deleteDeal(id) {
      try {
        await dealsCol().delete(id);
        await purgeActivities("deal", id);
        // Action items belong to the deal — delete them with it.
        const orphanActions = get().actionItems.filter((a) => a.dealId === id);
        await Promise.all(orphanActions.map((a) => actionItemsCol().delete(a.id)));
        set((s) => ({
          deals: s.deals.filter((d) => d.id !== id),
          activities: s.activities.filter(
            (a) => !(a.entityType === "deal" && a.entityId === id),
          ),
          actionItems: s.actionItems.filter((a) => a.dealId !== id),
          record: null,
        }));
      } catch (error) {
        set({ error: cleanError(error) });
      }
    },

    async addNote(type, id, body) {
      const text = body.trim();
      if (!text) return;
      const activity: Activity = {
        id: newId("act"),
        entityType: type,
        entityId: id,
        kind: "note",
        body: text,
        createdAt: nowIso(),
        author: get().identity?.user.name,
      };
      try {
        await activitiesCol().put(activity.id, activity);
        set((s) => ({ activities: [activity, ...s.activities] }));
        // touch the parent so it surfaces as recently active
        await touch(type, id);
      } catch (error) {
        set({ error: cleanError(error) });
      }
    },

    /** Upsert: used by the Granola importer for new notes and by the editor for edits. */
    async saveCallNote(note) {
      try {
        await callNotesCol().put(note.id, note);
        set((s) => ({
          callNotes: s.callNotes.some((n) => n.id === note.id)
            ? s.callNotes.map((n) => (n.id === note.id ? note : n))
            : [note, ...s.callNotes],
        }));
      } catch (error) {
        set({ error: cleanError(error) });
        throw error;
      }
    },

    async deleteCallNote(note) {
      try {
        await callNotesCol().delete(note.id);
        // Drop the transcript too; nothing else references it.
        if (note.hasTranscript) await transcriptsCol().delete(note.meetingId);
        set((s) => ({ callNotes: s.callNotes.filter((n) => n.id !== note.id) }));
      } catch (error) {
        set({ error: cleanError(error) });
        throw error;
      }
    },

    /** Upsert an action item on a deal. */
    async saveActionItem(input) {
      const existing = input.id
        ? get().actionItems.find((a) => a.id === input.id)
        : undefined;
      const ts = nowIso();
      const item: ActionItem = {
        id: existing?.id ?? newId("ai"),
        dealId: input.dealId,
        title: input.title.trim(),
        priority: input.priority,
        dueDate: input.dueDate || undefined,
        done: input.done ?? existing?.done ?? false,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
      };
      try {
        await actionItemsCol().put(item.id, item);
        set((s) => ({
          actionItems: existing
            ? s.actionItems.map((a) => (a.id === item.id ? item : a))
            : [item, ...s.actionItems],
        }));
        return item;
      } catch (error) {
        set({ error: cleanError(error) });
        throw error;
      }
    },

    async toggleActionItem(id) {
      const existing = get().actionItems.find((a) => a.id === id);
      if (!existing) return;
      const next: ActionItem = {
        ...existing,
        done: !existing.done,
        updatedAt: nowIso(),
      };
      try {
        await actionItemsCol().put(id, next);
        set((s) => ({
          actionItems: s.actionItems.map((a) => (a.id === id ? next : a)),
        }));
      } catch (error) {
        set({ error: cleanError(error) });
      }
    },

    async deleteActionItem(id) {
      try {
        await actionItemsCol().delete(id);
        set((s) => ({ actionItems: s.actionItems.filter((a) => a.id !== id) }));
      } catch (error) {
        set({ error: cleanError(error) });
      }
    },

    /**
     * Re-reads the activity timeline.
     *
     * The artifact automation's agent writes its own timeline entry server-side, so
     * a run that finishes while the page is open has to be pulled — the local copy
     * has no way of knowing about a write it didn't make.
     */
    async refreshActivities() {
      try {
        const rows = await activitiesCol().list();
        set({
          activities: rows
            .map((r) => r.value)
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
        });
      } catch (error) {
        set({ error: cleanError(error) });
      }
    },

    /** Read on demand — transcripts are deliberately absent from bootstrap. */
    async loadTranscript(meetingId) {
      const row = await transcriptsCol().get(meetingId);
      return row?.text ?? null;
    },

    /** Writes the body, or clears it when the text is emptied. */
    async saveTranscript(meetingId, text) {
      const trimmed = text.trim();
      if (!trimmed) {
        await transcriptsCol().delete(meetingId);
        return;
      }
      await transcriptsCol().put(meetingId, {
        meetingId,
        text: trimmed,
        importedAt: nowIso(),
      });
    },

    // Updates only the logo, preserving every other field on the company.
    async setCompanyLogo(id, logo) {
      const existing = get().companies.find((c) => c.id === id);
      if (!existing) return;
      const next: Company = { ...existing, logo, updatedAt: nowIso() };
      try {
        await companiesCol().put(id, next);
        set((s) => ({
          companies: s.companies.map((c) => (c.id === id ? next : c)),
        }));
      } catch (error) {
        set({ error: cleanError(error) });
      }
    },

    findCompanyByName(name) {
      const n = norm(name);
      return get().companies.find((c) => norm(c.name) === n);
    },

    async applyCommand(parsed) {
      try {
        // company: reuse existing by name, else create
        let companyId: string | undefined;
        if (parsed.company) {
          const existing = get().findCompanyByName(parsed.company.name);
          if (existing) {
            companyId = existing.id;
            // backfill missing fields without clobbering
            if (
              (parsed.company.domain && !existing.domain) ||
              (parsed.company.industry && !existing.industry)
            ) {
              await get().saveCompany({
                id: existing.id,
                name: existing.name,
                domain: existing.domain ?? parsed.company.domain,
                industry: existing.industry ?? parsed.company.industry,
              });
            }
          } else {
            const created = await get().saveCompany(parsed.company);
            companyId = created.id;
          }
        }

        // contacts
        const contactIds: string[] = [];
        for (const c of parsed.contacts) {
          const created = await get().saveContact({ ...c, companyId });
          contactIds.push(created.id);
        }
        const primaryContact = contactIds[0];

        // deals
        const dealIds: string[] = [];
        for (const d of parsed.deals) {
          const created = await get().saveDeal({
            ...d,
            companyId,
            contactId: primaryContact,
          });
          dealIds.push(created.id);
        }

        // note → most specific created entity
        if (parsed.note) {
          if (dealIds[0]) await get().addNote("deal", dealIds[0], parsed.note);
          else if (contactIds[0])
            await get().addNote("contact", contactIds[0], parsed.note);
          else if (companyId)
            await get().addNote("company", companyId, parsed.note);
        }

        // land the user on the most meaningful new record
        set({ commandOpen: false });
        if (dealIds[0]) get().showRecord("pipeline", "deal", dealIds[0]);
        else if (contactIds[0]) get().showRecord("contacts", "contact", contactIds[0]);
        else if (companyId) get().showRecord("companies", "company", companyId);
      } catch (error) {
        set({ error: cleanError(error) });
        throw error;
      }
    },
  };

  // --- helpers that close over get() ----------------------------------------

  async function purgeActivities(type: EntityType, id: string) {
    const toDelete = get().activities.filter(
      (a) => a.entityType === type && a.entityId === id,
    );
    await Promise.all(toDelete.map((a) => activitiesCol().delete(a.id)));
  }

  async function touch(type: EntityType, id: string) {
    const ts = nowIso();
    if (type === "company") {
      const c = get().companies.find((x) => x.id === id);
      if (c) {
        const next = { ...c, updatedAt: ts };
        await companiesCol().put(id, next);
        set((s) => ({
          companies: s.companies.map((x) => (x.id === id ? next : x)),
        }));
      }
    } else if (type === "contact") {
      const c = get().contacts.find((x) => x.id === id);
      if (c) {
        const next = { ...c, updatedAt: ts };
        await contactsCol().put(id, next);
        set((s) => ({
          contacts: s.contacts.map((x) => (x.id === id ? next : x)),
        }));
      }
    } else {
      const d = get().deals.find((x) => x.id === id);
      if (d) {
        const next = { ...d, updatedAt: ts };
        await dealsCol().put(id, next);
        set((s) => ({ deals: s.deals.map((x) => (x.id === id ? next : x)) }));
      }
    }
  }
});
