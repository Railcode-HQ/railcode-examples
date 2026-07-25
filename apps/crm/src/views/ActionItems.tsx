import { ListChecks } from "lucide-react";
import { useState } from "react";

import { ActionItemRow } from "@/components/ActionItems";
import { compareActionItems } from "@/lib/crm";
import { useCrmStore } from "@/store/crm-store";

export function ActionItems() {
  const {
    actionItems,
    deals,
    companies,
    search,
    toggleActionItem,
    deleteActionItem,
    openRecord,
  } = useCrmStore();
  const [showDone, setShowDone] = useState(false);

  const dealById = new Map(deals.map((d) => [d.id, d]));
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const q = search.trim().toLowerCase();

  const items = actionItems
    .filter((a) => (showDone ? true : !a.done))
    .filter((a) => {
      if (!q) return true;
      const deal = dealById.get(a.dealId);
      return (
        a.title.toLowerCase().includes(q) ||
        (deal?.title.toLowerCase().includes(q) ?? false)
      );
    })
    .sort(compareActionItems);

  const openCount = actionItems.filter((a) => !a.done).length;

  return (
    <>
      <div className="phead">
        <div>
          <h1>Action items</h1>
          <p>
            {openCount} open across your deals — highest priority and soonest due
            first.
          </p>
        </div>
        <div className="actions">
          <label className="aitoggle">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
            />
            Show done
          </label>
        </div>
      </div>

      {items.length ? (
        <div className="ailist">
          {items.map((it) => {
            const deal = dealById.get(it.dealId);
            const company = deal?.companyId
              ? companyById.get(deal.companyId)
              : undefined;
            return (
              <ActionItemRow
                key={it.id}
                item={it}
                context={
                  <button
                    type="button"
                    className="ailink"
                    onClick={() => deal && openRecord("deal", deal.id)}
                  >
                    {deal?.title ?? "Deleted deal"}
                    {company ? ` · ${company.name}` : ""}
                  </button>
                }
                onToggle={() => toggleActionItem(it.id)}
                onDelete={() => deleteActionItem(it.id)}
              />
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <ListChecks />
          <div className="et">
            {q
              ? "No matching action items"
              : showDone
                ? "No action items yet"
                : "Nothing outstanding"}
          </div>
          <div className="es">
            Add action items from any deal and they'll show up here.
          </div>
        </div>
      )}
    </>
  );
}
