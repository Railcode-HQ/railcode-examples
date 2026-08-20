/**
 * What a record owns, and how to delete it all.
 *
 * Deleting a company or a deal on its own leaves the things hanging off it
 * behind — people with no employer, files no page links to any more. This is
 * the other option: the set of records that would go with it, so the confirm
 * dialog can name them before anything is destroyed.
 *
 * It lives outside the stores because a cascade spans both of them: the CRM
 * records are in `crm-store`, the deal's files and generated artifacts in
 * `automation-store` (which already reads from `crm-store` — having it reach
 * back the other way would close a cycle).
 */

import { dealArtifactsPrefix, dealInputsPrefix } from "@/lib/automations";
import { CallNote, Contact, Deal, EntityType } from "@/lib/crm";
import { useAutomationStore } from "@/store/automation-store";
import { useCrmStore } from "@/store/crm-store";

/** The records a delete would take with it, beyond the record itself. */
export type Related = {
  /** People. Named in the dialog — they're the part worth being sure about. */
  contacts: Contact[];
  deals: Deal[];
  callNotes: CallNote[];
  /** Action items ride along with their deal, so these are only ever a count. */
  actionItems: number;
  /** Uploads and generated artifacts, by stored file name. */
  files: string[];
};

const EMPTY: Related = {
  contacts: [],
  deals: [],
  callNotes: [],
  actionItems: 0,
  files: [],
};

export function isEmpty(r: Related): boolean {
  return total(r) === 0;
}

/** How many records the cascade would delete, not counting the record itself. */
export function total(r: Related): number {
  return (
    r.contacts.length +
    r.deals.length +
    r.callNotes.length +
    r.actionItems +
    r.files.length
  );
}

/**
 * Everything hanging off one record.
 *
 * Deals and people are only ever collected downwards — deleting a deal offers
 * its own contact, never the company behind it, because a parent isn't
 * "related info" of its child.
 */
export function relatedTo(type: EntityType, id: string): Related {
  const { companies, contacts, deals, callNotes, actionItems } =
    useCrmStore.getState();
  const { files } = useAutomationStore.getState();

  const filesForDeals = (ids: string[]) =>
    files
      .filter((f) =>
        ids.some(
          (dealId) =>
            f.fileName.startsWith(dealInputsPrefix(dealId)) ||
            f.fileName.startsWith(dealArtifactsPrefix(dealId)),
        ),
      )
      .map((f) => f.fileName);

  if (type === "company") {
    if (!companies.some((c) => c.id === id)) return EMPTY;
    const people = contacts.filter((c) => c.companyId === id);
    const dls = deals.filter((d) => d.companyId === id);
    const dealIds = dls.map((d) => d.id);
    return {
      contacts: people,
      deals: dls,
      callNotes: notesOwnedBy(callNotes, people, id),
      actionItems: actionItems.filter((a) => dealIds.includes(a.dealId)).length,
      files: filesForDeals(dealIds),
    };
  }

  if (type === "contact") {
    const person = contacts.find((c) => c.id === id);
    if (!person) return EMPTY;
    // Deals aren't a person's to take: they belong to the company, and today's
    // delete already unlinks them.
    return {
      ...EMPTY,
      callNotes: notesOwnedBy(callNotes, [person]),
    };
  }

  const deal = deals.find((d) => d.id === id);
  if (!deal) return EMPTY;
  const person = deal.contactId
    ? contacts.find((c) => c.id === deal.contactId)
    : undefined;
  return {
    contacts: person ? [person] : [],
    deals: [],
    callNotes: person ? notesOwnedBy(callNotes, [person]) : [],
    actionItems: actionItems.filter((a) => a.dealId === id).length,
    files: filesForDeals([id]),
  };
}

/**
 * The call notes that would be left with nobody once `people` are gone. A
 * meeting attended by someone who survives the delete stays — it's still their
 * meeting.
 */
function notesOwnedBy(
  callNotes: CallNote[],
  people: Contact[],
  companyId?: string,
): CallNote[] {
  const ids = new Set(people.map((c) => c.id));
  return callNotes.filter((n) => {
    const attendees = n.contactIds ?? [];
    if (attendees.length) return attendees.every((cid) => ids.has(cid));
    // Legacy company-scoped notes have no people on them at all.
    return companyId !== undefined && n.companyId === companyId;
  });
}

/** Other deals a person is on — the reason to think twice before deleting them. */
export function otherDeals(contactId: string, exceptDealId?: string): Deal[] {
  return useCrmStore
    .getState()
    .deals.filter((d) => d.contactId === contactId && d.id !== exceptDealId);
}

/**
 * Deletes everything in `related`, children first, so nothing is orphaned if a
 * later step fails. Throws on the first failure — the caller then leaves the
 * parent record alone rather than deleting it over a half-finished cascade.
 */
export async function deleteRelated(related: Related): Promise<void> {
  const crm = () => useCrmStore.getState();
  const automation = () => useAutomationStore.getState();

  for (const fileName of related.files) {
    await automation().removeFile(fileName);
  }
  for (const note of related.callNotes) {
    await crm().deleteCallNote(note);
  }
  // A deal takes its own action items and timeline with it.
  for (const deal of related.deals) {
    await crm().deleteDeal(deal.id);
  }
  for (const contact of related.contacts) {
    await crm().deleteContact(contact.id);
  }
}
