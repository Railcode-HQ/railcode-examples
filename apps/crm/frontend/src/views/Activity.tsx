import { Activity as ActivityIcon } from "lucide-react";
import { useMemo } from "react";

import { EntityType, timeAgo } from "@/lib/crm";
import { useCrmStore } from "@/store/crm-store";

export function Activity() {
  const { companies, contacts, deals, activities, openRecord } = useCrmStore();

  const names = useMemo(() => {
    const m = new Map<string, string>();
    companies.forEach((c) => m.set(`company:${c.id}`, c.name));
    contacts.forEach((c) => m.set(`contact:${c.id}`, c.name));
    deals.forEach((d) => m.set(`deal:${d.id}`, d.title));
    return m;
  }, [companies, contacts, deals]);

  return (
    <>
      <div className="phead">
        <div>
          <h1>Activity</h1>
          <p>Everything that's happened across your workspace.</p>
        </div>
      </div>

      <div className="sect">
        <div className="sh">
          <h2>Recent activity</h2>
          <span className="hint">
            {activities.length} {activities.length === 1 ? "event" : "events"}
          </span>
        </div>
        {activities.length ? (
          <div className="rows">
            {activities.map((a) => {
              const label = names.get(`${a.entityType}:${a.entityId}`);
              return (
                <button
                  key={a.id}
                  className="crow click"
                  style={{
                    textAlign: "left",
                    border: 0,
                    background: "none",
                    width: "100%",
                  }}
                  onClick={() =>
                    label && openRecord(a.entityType as EntityType, a.entityId)
                  }
                >
                  <span className={`led ${a.kind === "note" ? "accent" : "dim"}`} />
                  <div className="body">
                    <div className="cname" style={{ fontWeight: 450, fontSize: 13 }}>
                      {a.kind === "note" ? "📝 " : ""}
                      {a.body}
                    </div>
                    <div className="meta">
                      {label ?? "deleted record"}
                      {a.author ? ` · ${a.author}` : ""}
                    </div>
                  </div>
                  <div className="when">{timeAgo(a.createdAt)}</div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <ActivityIcon />
            <div className="et">No activity yet</div>
            <div className="es">
              Create your first company, contact, or deal — or tell Ask AI who
              to add.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
