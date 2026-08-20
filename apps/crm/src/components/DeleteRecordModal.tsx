import {
  FileText,
  ListChecks,
  Paperclip,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Modal } from "@/components/Modal";
import { EntityType } from "@/lib/crm";
import { Related, otherDeals, relatedTo, total } from "@/lib/related";

const TYPE_LABEL: Record<EntityType, string> = {
  company: "company",
  contact: "contact",
  deal: "deal",
};

/**
 * The delete confirmation, and the one place the choice between the two kinds
 * of delete is offered: the record on its own — what the app has always done,
 * leaving its people and deals in place with the link removed — or the record
 * and everything hanging off it.
 *
 * The linked records are itemised either way. Nothing here deletes anything on
 * its own; `onConfirm` gets the set to cascade, or null for the record alone.
 */
export function DeleteRecordModal({
  type,
  id,
  name,
  onClose,
  onConfirm,
}: {
  type: EntityType;
  id: string;
  name: string;
  onClose: () => void;
  onConfirm: (related: Related | null) => Promise<void>;
}) {
  const related = useMemo(() => relatedTo(type, id), [type, id]);
  const lines = useMemo(() => describe(related, type, id), [related, type, id]);
  const [cascade, setCascade] = useState(false);
  const [busy, setBusy] = useState(false);

  const label = TYPE_LABEL[type];
  const count = total(related);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(cascade ? related : null);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Delete this ${label}?`}
      subtitle={name}
      icon={<Trash2 size={16} />}
      width={470}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn danger" onClick={() => void confirm()} disabled={busy}>
            {busy
              ? "Deleting…"
              : cascade
                ? `Delete all ${count + 1} records`
                : `Delete ${label}`}
          </button>
        </>
      }
    >
      {count === 0 ? (
        <p className="faint" style={{ fontSize: 12.5 }}>
          Nothing else is linked to it. This can't be undone.
        </p>
      ) : (
        <>
          <label className="delopt">
            <input
              type="checkbox"
              checked={cascade}
              onChange={(e) => setCascade(e.target.checked)}
            />
            <span>Also delete everything linked to this {label}</span>
          </label>

          <div className={`dellist${cascade ? " on" : ""}`}>
            {lines.map(({ key, icon: Icon, label: text, note }) => (
              <div className="delline" key={key}>
                <Icon size={14} />
                <span className="deln">{text}</span>
                {note ? <span className="delnote">{note}</span> : null}
              </div>
            ))}
          </div>

          <p className="faint" style={{ fontSize: 12 }}>
            {cascade
              ? "All of it goes, and this can't be undone."
              : `Left unchecked, they're kept — only their link to this ${label} goes.`}
          </p>
        </>
      )}
    </Modal>
  );
}

type Line = {
  key: string;
  icon: typeof Users;
  label: string;
  note?: string;
};

/** One line per kind of linked record, named where the names matter. */
function describe(related: Related, type: EntityType, id: string): Line[] {
  const lines: Line[] = [];

  if (related.contacts.length) {
    // People are what someone would regret most, so they're listed by name,
    // and anyone still needed by another deal says so.
    const shared =
      type === "deal"
        ? related.contacts.flatMap((c) => {
            const rest = otherDeals(c.id, id);
            return rest.length ? [`on ${count(rest.length, "other deal")}`] : [];
          })
        : [];
    lines.push({
      key: "contacts",
      icon: Users,
      label: count(related.contacts.length, "person", "people"),
      note: [names(related.contacts.map((c) => c.name)), ...shared]
        .filter(Boolean)
        .join(" · "),
    });
  }

  if (related.deals.length) {
    lines.push({
      key: "deals",
      icon: Tag,
      label: count(related.deals.length, "deal"),
      note: names(related.deals.map((d) => d.title)),
    });
  }

  if (related.actionItems) {
    lines.push({
      key: "actions",
      icon: ListChecks,
      label: count(related.actionItems, "action item"),
    });
  }

  if (related.callNotes.length) {
    lines.push({
      key: "notes",
      icon: FileText,
      label: count(related.callNotes.length, "call note"),
    });
  }

  if (related.files.length) {
    lines.push({
      key: "files",
      icon: Paperclip,
      label: count(related.files.length, "file"),
    });
  }

  return lines;
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Up to two names, then a tally — enough to recognise, short enough to scan. */
function names(all: string[]): string {
  if (all.length <= 2) return all.join(", ");
  return `${all.slice(0, 2).join(", ")} +${all.length - 2}`;
}
