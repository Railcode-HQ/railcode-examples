import { UserPlus, Users, X } from "lucide-react";
import { useMemo, useState } from "react";

import { initials } from "@/lib/crm";
import { useCrmStore } from "@/store/crm-store";

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * Email/name typeahead over the contact list. A complete email that nobody
 * owns yet can be turned into a contact inline, so attaching a meeting never
 * dead-ends on "that person isn't in the CRM".
 */
export function ContactMultiSelect({
  value,
  onChange,
  companyId,
}: {
  value: string[];
  onChange: (contactIds: string[]) => void;
  /** Company assigned to contacts created from here, when the context has one. */
  companyId?: string;
}) {
  const contacts = useCrmStore((s) => s.contacts);
  const saveContact = useCrmStore((s) => s.saveContact);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [creating, setCreating] = useState(false);

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const selected = value.map((id) => byId.get(id)).filter(Boolean);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    // Every contact not already attached; narrowed by the query when there is one.
    // With an empty query this is the full list, so focusing the input shows people.
    const available = contacts.filter((c) => !value.includes(c.id));
    const filtered = q
      ? available.filter(
          (c) => c.email?.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
        )
      : available;
    return filtered.slice(0, 8);
  }, [contacts, value, q]);

  // A typed-out email is unambiguous, so it beats any partial match: without
  // this, "jane@acme.com" could add jane@acmecorp.com on Enter.
  const exact = contacts.find((c) => c.email?.toLowerCase() === q);
  const canCreate = EMAIL_RE.test(q) && !exact;

  function add(id: string) {
    onChange([...value, id]);
    setQuery("");
  }
  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
  }

  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const contact = await saveContact({
        name: nameFromEmail(q),
        email: q,
        ...(companyId ? { companyId } : {}),
      });
      onChange([...value, contact.id]);
      setQuery("");
    } finally {
      setCreating(false);
    }
  }

  function onEnter() {
    if (exact && !value.includes(exact.id)) return add(exact.id);
    if (canCreate) return void create();
    if (matches[0]) return add(matches[0].id);
  }

  return (
    <div className="cms">
      <div className="cms-control">
        {selected.map((c) => (
          <span className="cms-chip" key={c!.id}>
            <span className="ava sm">{initials(c!.name)}</span>
            {c!.name}
            <button
              type="button"
              aria-label={`Remove ${c!.name}`}
              onClick={() => remove(c!.id)}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="cms-input"
          value={query}
          placeholder={selected.length ? "Add another…" : "Type an email…"}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            } else if (e.key === "Backspace" && !query && value.length) {
              remove(value[value.length - 1]);
            }
          }}
        />
      </div>

      {focused ? (
        <div className="cms-menu">
          {canCreate ? (
            // mousedown fires before the input's blur, so the click registers
            <button
              type="button"
              className="cms-opt cms-new"
              onMouseDown={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <span className="ava sm">
                <UserPlus size={13} />
              </span>
              <span className="cms-opt-body">
                <span className="cms-opt-nm">
                  {creating ? "Creating…" : `Create ${nameFromEmail(q)}`}
                </span>
                <span className="cms-opt-em">{q}</span>
              </span>
            </button>
          ) : null}

          {matches.length ? (
            matches.map((c) => (
              <button
                type="button"
                className="cms-opt"
                key={c.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(c.id);
                }}
              >
                <span className="ava sm">{initials(c.name)}</span>
                <span className="cms-opt-body">
                  <span className="cms-opt-nm">{c.name}</span>
                  {c.email ? <span className="cms-opt-em">{c.email}</span> : null}
                </span>
              </button>
            ))
          ) : canCreate ? null : (
            <div className="cms-none">
              <Users size={13} />
              {contacts.length === 0
                ? "No contacts yet — type an email to add one"
                : q
                  ? "No matching contact"
                  : "Everyone's already added"}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** "jane.doe@acme.com" → "Jane Doe"; falls back to the address itself. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ") || email;
}
