import { Building2, Check, Sparkles, Tag } from "lucide-react";
import { useState } from "react";

import { formatMoney, initials, stage } from "@/lib/crm";
import { ParsedCommand, parseCommand } from "@/lib/parse";
import { useCrmStore } from "@/store/crm-store";

const EXAMPLES = [
  "Add Acme Corp, Jane Doe (CTO) jane@acme.com, and a $40k deal “Platform rollout”",
  "New contact Marco Diaz, marco@northwind.io, qualified $12k deal",
  "Globex — met at the conference, follow up next week",
];

export function CommandBar() {
  const { setCommandOpen, findCompanyByName, applyCommand } = useCrmStore();

  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCommand | null>(null);
  const [saving, setSaving] = useState(false);

  const [incCompany, setIncCompany] = useState(true);
  const [incNote, setIncNote] = useState(true);
  const [incContacts, setIncContacts] = useState<boolean[]>([]);
  const [incDeals, setIncDeals] = useState<boolean[]>([]);

  const close = () => setCommandOpen(false);

  async function onParse() {
    const q = text.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setParsed(null);
    try {
      const result = await parseCommand(q);
      if (!result.company && !result.contacts.length && !result.deals.length) {
        setError(
          "Couldn't find a company, contact, or deal in that. Try naming who or what to add.",
        );
        return;
      }
      setParsed(result);
      setIncCompany(true);
      setIncNote(true);
      setIncContacts(result.contacts.map(() => true));
      setIncDeals(result.deals.map(() => true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const existing = parsed?.company
    ? findCompanyByName(parsed.company.name)
    : undefined;

  const selectedCount =
    (parsed?.company && incCompany ? 1 : 0) +
    incContacts.filter(Boolean).length +
    incDeals.filter(Boolean).length;

  async function onConfirm() {
    if (!parsed || saving || selectedCount === 0) return;
    setSaving(true);
    try {
      await applyCommand({
        company: incCompany ? parsed.company : undefined,
        contacts: parsed.contacts.filter((_, i) => incContacts[i]),
        deals: parsed.deals.filter((_, i) => incDeals[i]),
        note: incNote ? parsed.note : undefined,
      });
      // applyCommand closes the command bar on success
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="cmdoverlay" onMouseDown={close}>
      <div className="cmd" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdin">
          {loading ? <span className="spin" /> : <Sparkles />}
          <input
            autoFocus
            value={text}
            placeholder="Describe what to add — a company, people, deals…"
            onChange={(e) => {
              setText(e.target.value);
              if (parsed) setParsed(null);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (parsed) void onConfirm();
                else void onParse();
              }
            }}
          />
        </div>

        {!parsed && !error ? (
          <div className="cmdhint">
            <b>Quick add</b> turns a sentence into records. For example:
            <br />
            {EXAMPLES.map((ex) => (
              <span key={ex}>
                · {ex}
                <br />
              </span>
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="cmdhint" style={{ color: "var(--red)" }}>
            {error}
          </div>
        ) : null}

        {parsed ? (
          <div className="cmdpreview">
            {parsed.company ? (
              <div className="pvgroup">
                <div className="pvlabel">Company</div>
                <PvItem
                  on={incCompany}
                  toggle={() => setIncCompany((v) => !v)}
                  icon={<Building2 size={15} />}
                  name={parsed.company.name}
                  meta={[parsed.company.domain, parsed.company.industry]
                    .filter(Boolean)
                    .join(" · ")}
                  badge={existing ? "existing" : "new"}
                />
              </div>
            ) : null}

            {parsed.contacts.length ? (
              <div className="pvgroup">
                <div className="pvlabel">
                  {parsed.contacts.length} contact
                  {parsed.contacts.length > 1 ? "s" : ""}
                </div>
                {parsed.contacts.map((c, i) => (
                  <PvItem
                    key={i}
                    on={incContacts[i]}
                    toggle={() =>
                      setIncContacts((arr) =>
                        arr.map((v, j) => (j === i ? !v : v)),
                      )
                    }
                    avatar={initials(c.name)}
                    name={c.name}
                    meta={[c.title, c.email, c.phone].filter(Boolean).join(" · ")}
                    badge="new"
                  />
                ))}
              </div>
            ) : null}

            {parsed.deals.length ? (
              <div className="pvgroup">
                <div className="pvlabel">
                  {parsed.deals.length} deal{parsed.deals.length > 1 ? "s" : ""}
                </div>
                {parsed.deals.map((dl, i) => (
                  <PvItem
                    key={i}
                    on={incDeals[i]}
                    toggle={() =>
                      setIncDeals((arr) => arr.map((v, j) => (j === i ? !v : v)))
                    }
                    icon={<Tag size={15} />}
                    name={dl.title}
                    meta={`${stage(dl.stage ?? "new").label} · ${formatMoney(dl.value)}`}
                    badge="new"
                  />
                ))}
              </div>
            ) : null}

            {parsed.note ? (
              <div className="pvgroup">
                <div className="pvlabel">Note</div>
                <PvItem
                  on={incNote}
                  toggle={() => setIncNote((v) => !v)}
                  icon={<Sparkles size={14} />}
                  name={parsed.note}
                  meta="Logged to the timeline"
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="cmdfoot">
          {parsed && existing ? (
            <span className="hint">
              Will link to existing <b>{existing.name}</b>.
            </span>
          ) : (
            <span className="hint">
              {parsed
                ? "Toggle anything you don't want to create."
                : "Press Enter to preview · Esc to close"}
            </span>
          )}
          <div className="spacer" />
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          {parsed ? (
            <button
              className="btn"
              onClick={onConfirm}
              disabled={saving || selectedCount === 0}
            >
              {saving
                ? "Creating…"
                : `Create ${selectedCount} record${selectedCount === 1 ? "" : "s"}`}
            </button>
          ) : (
            <button className="btn" onClick={onParse} disabled={!text.trim() || loading}>
              {loading ? "Reading…" : "Preview"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PvItem({
  on,
  toggle,
  icon,
  avatar,
  name,
  meta,
  badge,
}: {
  on: boolean;
  toggle: () => void;
  icon?: React.ReactNode;
  avatar?: string;
  name: string;
  meta?: string;
  badge?: "new" | "existing";
}) {
  return (
    <div className={`pvitem${on ? "" : " off"}`}>
      <button
        className={`toggle${on ? " on" : ""}`}
        aria-label={on ? "Exclude" : "Include"}
        onClick={toggle}
      >
        {on ? <Check /> : null}
      </button>
      <span className="glyph">{avatar ?? icon}</span>
      <div className="pvbody">
        <div className="pvname">{name}</div>
        {meta ? <div className="pvmeta">{meta}</div> : null}
      </div>
      {badge === "new" ? <span className="new">New</span> : null}
      {badge === "existing" ? <span className="existing">Existing</span> : null}
    </div>
  );
}
