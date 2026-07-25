import {
  Activity,
  Bell,
  Building2,
  Download,
  House,
  Kanban,
  ListChecks,
  RefreshCw,
  Sparkles,
  Users,
  Wallet,
  Workflow,
} from "lucide-react";
import type { MouseEvent } from "react";

import granolaLogo from "@/assets/granola-logo.png";
import { initials, stage } from "@/lib/crm";
import { hrefFor } from "@/lib/routes";
import { View, useCrmStore } from "@/store/crm-store";
import { unreadCount, useAutomationStore } from "@/store/automation-store";
import { useGranolaStore } from "@/store/granola-store";

const NAV: { id: View; label: string; icon: typeof House }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "ask", label: "Ask AI", icon: Sparkles },
  { id: "pipeline", label: "Pipeline", icon: Wallet },
  { id: "companies", label: "Companies", icon: Building2 },
  { id: "contacts", label: "Contacts", icon: Users },
  { id: "actionItems", label: "Action items", icon: ListChecks },
  { id: "activity", label: "Activity", icon: Activity },
];

const AUTOMATION_NAV: { id: View; label: string; icon: typeof House }[] = [
  { id: "automations", label: "Automations", icon: Workflow },
  { id: "notifications", label: "Notifications", icon: Bell },
];

/**
 * Tabs are real links so they can be copied, bookmarked, or opened in a new tab.
 * A plain click is handled in-app; a modified one is left to the browser, which
 * is what makes ⌘-click open a second window on that tab.
 */
function navClick(e: MouseEvent, id: View, setView: (v: View) => void) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  setView(id);
}

export function Sidebar() {
  const { view, setView, identity, companies, contacts, deals, actionItems } =
    useCrmStore();
  const { connected, syncing, lastSyncError, openConnect, openManualImport, autoSync } =
    useGranolaStore();
  const { artifacts, runs, notifState } = useAutomationStore();

  const user = identity?.user.name ?? "you";

  const openDeals = deals.filter((d) => !stage(d.stage).terminal).length;
  const openActions = actionItems.filter((a) => !a.done).length;
  const unread = unreadCount(artifacts, runs, notifState);
  const counts: Record<View, number | undefined> = {
    home: undefined,
    ask: undefined,
    activity: undefined,
    pipeline: openDeals,
    companies: companies.length,
    contacts: contacts.length,
    actionItems: openActions || undefined,
    automations: undefined,
    notifications: unread || undefined,
  };

  return (
    <aside>
      <div className="sidehead">
        <div className="apptitle">
          <Kanban size={15} strokeWidth={2.2} />
          <span>Template CRM</span>
        </div>
      </div>

      <div className="navgroup">
        <div className="navlabel">Workspace</div>
        <nav>
          {NAV.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={hrefFor(id)}
              className={`nav${view === id ? " active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={(e) => navClick(e, id, setView)}
            >
              <Icon />
              <span className="label">{label}</span>
              {counts[id] !== undefined ? (
                <span className="ct tab">{counts[id]}</span>
              ) : null}
            </a>
          ))}
        </nav>
      </div>

      <div className="navgroup">
        <div className="navlabel">Automation</div>
        <nav>
          {AUTOMATION_NAV.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={hrefFor(id)}
              className={`nav${view === id ? " active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={(e) => navClick(e, id, setView)}
            >
              <Icon />
              <span className="label">{label}</span>
              {counts[id] !== undefined ? (
                <span className={`ct tab${id === "notifications" ? " unread" : ""}`}>
                  {counts[id]}
                </span>
              ) : null}
            </a>
          ))}
        </nav>
      </div>

      <div className="navgroup">
        <div className="navlabel">Connectors</div>
        <nav>
          {connected ? (
            <div className="nav connrow">
              <img className="connlogo" src={granolaLogo} alt="" />
              <span className="label">Granola</span>
              <button
                className="connact"
                title="Import meetings manually"
                aria-label="Import meetings manually"
                onClick={openManualImport}
              >
                <Download size={15} />
              </button>
              <button
                className={`connact${syncing ? " spinning" : ""}`}
                title={lastSyncError ? `Sync failed: ${lastSyncError}` : "Sync now"}
                aria-label="Sync now"
                onClick={() => autoSync()}
                disabled={syncing}
              >
                <RefreshCw size={15} />
              </button>
            </div>
          ) : (
            <button className="nav" onClick={openConnect}>
              <img className="connlogo" src={granolaLogo} alt="" />
              <span className="label">Connect Granola</span>
            </button>
          )}
        </nav>
      </div>

      <div className="sidefoot">
        <span className="ava">{initials(user)}</span>
        <div className="who">
          <div className="nm">{user}</div>
          {identity?.user.email ? (
            <div className="em" title={identity.user.email}>
              {identity.user.email}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
