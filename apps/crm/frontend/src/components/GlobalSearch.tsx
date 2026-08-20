import { Search, Tag } from "lucide-react";
import { useMemo, useState } from "react";

import { EntityType, formatMoney, initials, stage } from "@/lib/crm";
import { View, useCrmStore } from "@/store/crm-store";

type Result = {
  type: EntityType;
  id: string;
  name: string;
  meta: string;
};

const MAX_PER_GROUP = 6;

/** The list view a result opens on, so the record lands with the right tab behind it. */
const VIEW_FOR: Record<EntityType, View> = {
  company: "companies",
  contact: "contacts",
  deal: "pipeline",
};

/** 2 = a field starts with the query, 1 = contains it, 0 = no match. */
function score(q: string, fields: (string | undefined)[]): number {
  let best = 0;
  for (const f of fields) {
    if (!f) continue;
    const v = f.toLowerCase();
    if (v.startsWith(q)) return 2;
    if (v.includes(q)) best = 1;
  }
  return best;
}

export function GlobalSearch() {
  const { setSearchOpen, showRecord, companies, contacts, deals } = useCrmStore();

  const [text, setText] = useState("");
  const [sel, setSel] = useState(0);

  const close = () => setSearchOpen(false);
  const q = text.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!q) return [];
    const coName = (id?: string) => companies.find((c) => c.id === id)?.name;
    const rank = <T,>(xs: T[], fields: (x: T) => (string | undefined)[]) =>
      xs
        .map((x) => ({ x, s: score(q, fields(x)) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, MAX_PER_GROUP)
        .map((r) => r.x);

    return [
      {
        label: "Companies",
        results: rank(companies, (c) => [c.name, c.domain, c.industry]).map(
          (c): Result => ({
            type: "company",
            id: c.id,
            name: c.name,
            meta: [c.domain, c.industry].filter(Boolean).join(" · "),
          }),
        ),
      },
      {
        label: "Contacts",
        results: rank(contacts, (c) => [c.name, c.email, c.title, coName(c.companyId)]).map(
          (c): Result => ({
            type: "contact",
            id: c.id,
            name: c.name,
            meta: [c.title, coName(c.companyId), c.email].filter(Boolean).join(" · "),
          }),
        ),
      },
      {
        label: "Deals",
        results: rank(deals, (d) => [d.title, coName(d.companyId)]).map(
          (d): Result => ({
            type: "deal",
            id: d.id,
            name: d.title,
            meta: [coName(d.companyId), stage(d.stage).label, formatMoney(d.value)]
              .filter(Boolean)
              .join(" · "),
          }),
        ),
      },
    ].filter((g) => g.results.length);
  }, [q, companies, contacts, deals]);

  const flat = groups.flatMap((g) => g.results);
  const selected = Math.min(sel, Math.max(flat.length - 1, 0));

  function open(r: Result) {
    close();
    showRecord(VIEW_FOR[r.type], r.type, r.id);
  }

  return (
    <div className="cmdoverlay" onMouseDown={close}>
      <div className="cmd" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdin">
          <Search />
          <input
            autoFocus
            value={text}
            placeholder="Search companies, contacts, deals…"
            onChange={(e) => {
              setText(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, flat.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (flat[selected]) open(flat[selected]);
              }
            }}
          />
        </div>

        {q && !flat.length ? (
          <div className="cmdhint">No matches for “{text.trim()}”.</div>
        ) : null}

        {flat.length ? (
          <div className="cmdresults">
            {groups.map((g) => (
              <div className="pvgroup" key={g.label}>
                <div className="pvlabel">{g.label}</div>
                {g.results.map((r) => {
                  const i = flat.indexOf(r);
                  return (
                    <button
                      key={r.id}
                      className={`srow${i === selected ? " sel" : ""}`}
                      ref={
                        i === selected
                          ? (el) => el?.scrollIntoView({ block: "nearest" })
                          : undefined
                      }
                      onMouseEnter={() => setSel(i)}
                      onClick={() => open(r)}
                    >
                      <span className={`glyph${r.type === "company" ? " co" : r.type === "contact" ? " ct" : ""}`}>
                        {r.type === "deal" ? <Tag size={15} /> : initials(r.name)}
                      </span>
                      <div className="srbody">
                        <div className="srname">{r.name}</div>
                        {r.meta ? <div className="srmeta">{r.meta}</div> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}

        <div className="cmdfoot">
          <span className="hint">
            {flat.length
              ? "↑↓ to navigate · Enter to open · Esc to close"
              : "Jump to any company, contact, or deal."}
          </span>
        </div>
      </div>
    </div>
  );
}
