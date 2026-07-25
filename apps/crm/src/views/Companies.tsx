import { Building2, Plus } from "lucide-react";
import { useMemo } from "react";

import { initials, stage, timeAgo } from "@/lib/crm";
import { useCrmStore } from "@/store/crm-store";

export function Companies() {
  const { companies, contacts, deals, search, openRecord, openCreate } =
    useCrmStore();

  const stats = useMemo(() => {
    const m = new Map<string, { contacts: number; openDeals: number }>();
    companies.forEach((c) => m.set(c.id, { contacts: 0, openDeals: 0 }));
    contacts.forEach((c) => {
      if (c.companyId && m.has(c.companyId)) m.get(c.companyId)!.contacts += 1;
    });
    deals.forEach((d) => {
      if (d.companyId && m.has(d.companyId) && !stage(d.stage).terminal)
        m.get(d.companyId)!.openDeals += 1;
    });
    return m;
  }, [companies, contacts, deals]);

  const q = search.trim().toLowerCase();
  const rows = (
    q
      ? companies.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.domain?.toLowerCase().includes(q) ||
            c.industry?.toLowerCase().includes(q),
        )
      : companies
  )
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return (
    <>
      <div className="phead">
        <div>
          <h1>Companies</h1>
          <p>{companies.length} organizations in your book.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => openCreate("company")}>
            <Plus />
            New company
          </button>
        </div>
      </div>

      <div className="sect">
        {rows.length ? (
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Industry</th>
                  <th className="num">Contacts</th>
                  <th className="num">Open deals</th>
                  <th className="num">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const s = stats.get(c.id);
                  return (
                    <tr key={c.id} onClick={() => openRecord("company", c.id)}>
                      <td>
                        <div className="appcell">
                          <span className="glyph co">{initials(c.name)}</span>
                          <div style={{ minWidth: 0 }}>
                            <div className="nm">{c.name}</div>
                            {c.domain ? (
                              <div className="hs mono">{c.domain}</div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="muted">{c.industry ?? "—"}</td>
                      <td className="num muted tab">{s?.contacts ?? 0}</td>
                      <td className="num muted tab">{s?.openDeals ?? 0}</td>
                      <td className="num faint tab">{timeAgo(c.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <Building2 />
            <div className="et">{q ? "No matches" : "No companies yet"}</div>
            <div className="es">
              {q
                ? "Try a different search."
                : "Add one with New company, or use Quick add (⌘K)."}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
