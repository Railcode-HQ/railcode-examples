import { create } from "zustand";

import {
  MeetingTriage,
  TRIAGE_WINDOW_DAYS,
  withinTriageWindow,
} from "@/lib/automations";
import { DealProposal, proposeFromMeeting } from "@/lib/deal-from-meeting";
import { cleanError, nowIso } from "@/lib/crm";
import {
  GranolaMeetingDetail,
  GranolaMeetingStub,
  fetchMeetingDetailResilient,
  fetchMeetingTranscript,
  isGranolaConnected,
  listRecentMeetings,
} from "@/lib/granola";
import { describeAskError, pickModel } from "@/lib/ask-agent";
import { collection } from "@/lib/railcode";
import { useCrmStore } from "@/store/crm-store";
import { granolaNoteId } from "@/store/granola-store";

/**
 * Triage decisions are SHARED, not per-user. "This meeting isn't a deal" is true for
 * the whole team; a private dismissal list would make every colleague re-triage the
 * same noise, which is the failure mode the old per-user import ledger had.
 */
const triageCol = () => collection<MeetingTriage>("meetingTriage");

type TriageState = {
  loaded: boolean;
  loading: boolean;
  error?: string;
  notice?: string;

  triage: Record<string, MeetingTriage>;
  /** Last 7 days, newest first, already filtered of decided meetings. */
  meetings: GranolaMeetingStub[];

  /** The meeting whose proposal modal is open. */
  proposalFor: GranolaMeetingStub | null;
  proposal: DealProposal | null;
  detail: GranolaMeetingDetail | null;
  proposing: boolean;
  creating: boolean;
  proposalError?: string;

  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;
  dismiss: (meetingId: string) => Promise<void>;
  undoDismiss: (meetingId: string) => Promise<void>;

  openProposal: (meetingId: string) => Promise<void>;
  closeProposal: () => void;
  editProposal: (patch: Partial<DealProposal>) => void;
  confirmProposal: () => Promise<void>;

  dismissedIds: () => Set<string>;
  clearError: () => void;
  clearNotice: () => void;
};

export const useTriageStore = create<TriageState>((set, get) => ({
  loaded: false,
  loading: false,
  triage: {},
  meetings: [],
  proposalFor: null,
  proposal: null,
  detail: null,
  proposing: false,
  creating: false,

  async bootstrap() {
    try {
      const rows = await triageCol().list();
      const triage: Record<string, MeetingTriage> = {};
      rows.forEach((r) => {
        triage[r.value.meetingId] = r.value;
      });
      set({ triage, loaded: true });
    } catch (error) {
      set({ error: cleanError(error), loaded: true });
    }
  },

  /**
   * Lists recent meetings straight from Granola rather than from the CRM's call
   * notes.
   *
   * That's the whole point of this list: the background sync only imports meetings
   * whose attendees already match a known contact, so a first conversation with a
   * brand-new prospect never lands in the CRM at all. Those are exactly the meetings
   * worth turning into a deal, and they only exist upstream.
   */
  async refresh() {
    if (get().loading) return;
    set({ loading: true, error: undefined });
    try {
      if (!(await isGranolaConnected())) {
        set({ meetings: [], loading: false });
        return;
      }
      const stubs = await listRecentMeetings();
      const decided = get().triage;
      set({
        meetings: stubs.filter(
          (s) => withinTriageWindow(s.date) && !decided[s.id],
        ),
        loading: false,
      });
    } catch (error) {
      set({ error: cleanError(error), loading: false });
    }
  },

  async dismiss(meetingId) {
    const stub = get().meetings.find((m) => m.id === meetingId);
    const record: MeetingTriage = {
      meetingId,
      status: "dismissed",
      title: stub?.title,
      decidedAt: nowIso(),
      decidedBy: useCrmStore.getState().identity?.user.name,
    };
    set((s) => ({
      triage: { ...s.triage, [meetingId]: record },
      meetings: s.meetings.filter((m) => m.id !== meetingId),
      notice: `Dismissed “${stub?.title ?? "meeting"}”. It won't come back.`,
    }));
    try {
      await triageCol().put(meetingId, record);
    } catch (error) {
      set({ error: cleanError(error) });
    }
  },

  /** For the moment right after a dismissal, while the notice is still up. */
  async undoDismiss(meetingId) {
    const next = { ...get().triage };
    delete next[meetingId];
    set({ triage: next, notice: undefined });
    try {
      await triageCol().delete(meetingId);
      await get().refresh();
    } catch (error) {
      set({ error: cleanError(error) });
    }
  },

  async openProposal(meetingId) {
    const stub = get().meetings.find((m) => m.id === meetingId);
    if (!stub) return;
    set({
      proposalFor: stub,
      proposal: null,
      detail: null,
      proposing: true,
      proposalError: undefined,
    });
    try {
      // The listing carries no notes body — the deal's shape comes from the write-up,
      // so it has to be fetched before anything can be extracted.
      const detail = await fetchMeetingDetailResilient(stub);
      const model = await pickModel().catch(() => null);
      const proposal = await proposeFromMeeting(detail, model);
      // The modal may have been closed while this was in flight.
      if (get().proposalFor?.id !== meetingId) return;
      set({ detail, proposal, proposing: false });
    } catch (error) {
      if (get().proposalFor?.id !== meetingId) return;
      // Shares the LLM error vocabulary with Ask AI — a token-limit or provider
      // failure has the same fix wherever it surfaces.
      set({ proposing: false, proposalError: describeAskError(error) });
    }
  },

  closeProposal: () =>
    set({
      proposalFor: null,
      proposal: null,
      detail: null,
      proposing: false,
      proposalError: undefined,
    }),

  editProposal: (patch) =>
    set((s) => (s.proposal ? { proposal: { ...s.proposal, ...patch } } : {})),

  /**
   * Commits the proposal: company, people, deal, and the meeting itself as the
   * deal's first call note.
   *
   * Saving the note is not incidental — the artifact automation finds a deal's
   * meetings through the call notes, so a deal created here would otherwise have
   * nothing to generate from.
   */
  async confirmProposal() {
    const { proposal, detail, proposalFor } = get();
    if (!proposal || !proposalFor || get().creating) return;
    set({ creating: true, proposalError: undefined });

    const crm = useCrmStore.getState();
    try {
      let companyId = proposal.companyId;
      if (companyId) {
        // Backfill what we learned without clobbering what's already there.
        const existing = crm.companies.find((c) => c.id === companyId);
        if (
          existing &&
          ((proposal.domain && !existing.domain) ||
            (proposal.industry && !existing.industry))
        ) {
          await crm.saveCompany({
            id: existing.id,
            name: existing.name,
            domain: existing.domain ?? proposal.domain,
            industry: existing.industry ?? proposal.industry,
          });
        }
      } else {
        const created = await crm.saveCompany({
          name: proposal.companyName,
          domain: proposal.domain,
          industry: proposal.industry,
        });
        companyId = created.id;
      }

      const contactIds: string[] = [];
      for (const person of proposal.contacts) {
        const saved = await crm.saveContact({
          ...(person.existingId ? { id: person.existingId } : {}),
          name: person.name,
          email: person.email,
          title: person.title,
          companyId,
        });
        contactIds.push(saved.id);
      }

      const deal = await crm.saveDeal({
        title: proposal.dealTitle,
        value: proposal.value,
        stage: proposal.stage,
        companyId,
        contactId: contactIds[0],
        notes: proposal.summary || undefined,
      });

      if (detail) {
        const hasTranscript = await fetchMeetingTranscript(detail.id)
          .then(async (result) => {
            if (result.status !== "ok") return false;
            await crm.saveTranscript(detail.id, result.text);
            return true;
          })
          .catch(() => false);

        await crm.saveCallNote({
          id: granolaNoteId(detail.id),
          contactIds,
          meetingId: detail.id,
          title: detail.title,
          date: detail.date,
          attendees: detail.attendees,
          notesMarkdown: detail.notesMarkdown,
          createdAt: nowIso(),
          source: "granola",
          importedBy: crm.identity?.user.name,
          ...(hasTranscript ? { hasTranscript: true } : {}),
        });
      }

      const record: MeetingTriage = {
        meetingId: proposalFor.id,
        status: "linked",
        dealId: deal.id,
        title: proposalFor.title,
        decidedAt: nowIso(),
        decidedBy: crm.identity?.user.name,
      };
      await triageCol().put(record.meetingId, record);

      set((s) => ({
        triage: { ...s.triage, [record.meetingId]: record },
        meetings: s.meetings.filter((m) => m.id !== record.meetingId),
        creating: false,
        proposalFor: null,
        proposal: null,
        detail: null,
      }));

      useCrmStore.getState().showRecord("pipeline", "deal", deal.id);
    } catch (error) {
      set({ creating: false, proposalError: cleanError(error) });
    }
  },

  dismissedIds() {
    return new Set(
      Object.values(get().triage)
        .filter((t) => t.status === "dismissed")
        .map((t) => t.meetingId),
    );
  },

  clearError: () => set({ error: undefined }),
  clearNotice: () => set({ notice: undefined }),
}));

export { TRIAGE_WINDOW_DAYS };
