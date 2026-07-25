import { Plus, Users } from "lucide-react";
import { useMemo } from "react";

import { initials, timeAgo } from "@/lib/crm";
import { useCrmStore } from "@/store/crm-store";

export function Contacts() {
  const { contacts, companies, deals, search, openRecord, openCreate } =
    useCrmStore();

  const companyName = useMemo(() => {
    const m = new Map<string, string>();
    companies.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [companies]);

  const dealCount = useMemo(() => {
    const m = new Map<string, number>();
    deals.forEach((d) => {
      if (d.contactId) m.set(d.contactId, (m.get(d.contactId) ?? 0) + 1);
    });
    return m;
  }, [deals]);

  const q = search.trim().toLowerCase();
  const rows = (
    q
      ? contacts.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q) ||
            c.title?.toLowerCase().includes(q) ||
            (c.companyId && companyName.get(c.companyId)?.toLowerCase().includes(q)),
        )
      : contacts
  )
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return (
    <>
      <div className="phead">
        <div>
          <h1>Contacts</h1>
          <p>{contacts.length} people across your accounts.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => openCreate("contact")}>
            <Plus />
            New contact
          </button>
        </div>
      </div>

      <div className="sect">
        {rows.length ? (
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Title</th>
                  <th>Company</th>
                  <th className="num">Deals</th>
                  <th className="num">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => openRecord("contact", c.id)}>
                    <td>
                      <div className="appcell">
                        <span className="glyph ct">{initials(c.name)}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="nm">{c.name}</div>
                          {c.email ? <div className="hs mono">{c.email}</div> : null}
                        </div>
                      </div>
                    </td>
                    <td className="muted">{c.title ?? "—"}</td>
                    <td className="muted">
                      {c.companyId ? companyName.get(c.companyId) ?? "—" : "—"}
                    </td>
                    <td className="num muted tab">{dealCount.get(c.id) ?? 0}</td>
                    <td className="num faint tab">{timeAgo(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <Users />
            <div className="et">{q ? "No matches" : "No contacts yet"}</div>
            <div className="es">
              {q
                ? "Try a different search."
                : "Add one with New contact, or tell Ask AI who to add."}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
