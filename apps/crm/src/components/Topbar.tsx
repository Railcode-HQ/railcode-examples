import { Menu, Search, Sparkles } from "lucide-react";

import { EntityType } from "@/lib/crm";
import { VIEW_LABELS } from "@/lib/routes";
import { View, useCrmStore } from "@/store/crm-store";

const PARENT: Record<EntityType, { view: View; label: string }> = {
  company: { view: "companies", label: "Companies" },
  contact: { view: "contacts", label: "Contacts" },
  deal: { view: "pipeline", label: "Pipeline" },
};

export function Topbar() {
  const {
    view,
    search,
    setSearch,
    setNavOpen,
    setCommandOpen,
    setView,
    record,
    companies,
    contacts,
    deals,
  } = useCrmStore();

  function recordName(): string {
    if (!record) return "";
    if (record.mode === "create") return `New ${record.type}`;
    if (record.type === "company")
      return companies.find((c) => c.id === record.id)?.name ?? "…";
    if (record.type === "contact")
      return contacts.find((c) => c.id === record.id)?.name ?? "…";
    return deals.find((d) => d.id === record.id)?.title ?? "…";
  }

  const parent = record ? PARENT[record.type] : null;

  return (
    <div className="topbar">
      <button
        className="iconbtn hamburger"
        aria-label="Open navigation"
        onClick={() => setNavOpen(true)}
      >
        <Menu />
      </button>

      <div className="crumb">
        <span>Template</span>
        <span className="sep">/</span>
        {record && parent ? (
          <>
            <button className="crumblink" onClick={() => setView(parent.view)}>
              {parent.label}
            </button>
            <span className="sep">/</span>
            <span className="cur">{recordName()}</span>
          </>
        ) : (
          <span className="cur">{VIEW_LABELS[view]}</span>
        )}
      </div>

      <div className="spacer" />

      {record || view === "ask" || view === "automations" || view === "notifications" ? null : (
        <label className="search">
          <Search />
          <input
            value={search}
            placeholder={`Search ${VIEW_LABELS[view].toLowerCase()}…`}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      )}

      <button
        className="btn"
        onClick={() => setCommandOpen(true)}
        title="Quick add (⌘K)"
      >
        <Sparkles />
        Quick add
      </button>
    </div>
  );
}
