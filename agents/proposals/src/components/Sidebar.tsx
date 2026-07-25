import { CalendarClock, FileText, Files, Settings2, Wand2 } from "lucide-react";

import { View, useProposalStore } from "@/store/proposal-store";

const NAV: { id: View; label: string; icon: typeof Files }[] = [
  { id: "meetings", label: "Meetings", icon: CalendarClock },
  { id: "proposal", label: "Proposals", icon: FileText },
  { id: "materials", label: "Materials", icon: Files },
  { id: "setup", label: "Setup guide", icon: Wand2 },
  { id: "settings", label: "Settings", icon: Settings2 },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function Sidebar() {
  const { view, setView, identity, materials, proposals, meetings } = useProposalStore();

  const undrafted = meetings.filter((m) => !m.drafted).length;

  const counts: Record<View, number | undefined> = {
    setup: undefined,
    meetings: undrafted || undefined,
    proposal: proposals.length || undefined,
    materials: materials.length || undefined,
    settings: undefined,
  };

  const user = identity?.user.name ?? "you";

  return (
    <aside>
      <div className="brand">
        <span className="mark">
          <FileText size={15} strokeWidth={2.2} />
        </span>
        <b>Proposals</b>
      </div>

      <div className="navgroup">
        <div className="navlabel">Workspace</div>
        <nav>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav${view === id ? " active" : ""}`}
              onClick={() => setView(id)}
            >
              <Icon />
              <span className="label">{label}</span>
              {counts[id] !== undefined ? <span className="ct tab">{counts[id]}</span> : null}
            </button>
          ))}
        </nav>
      </div>

      <div className="sidefoot">
        <span className="ava">{initials(user)}</span>
        <div className="who">
          <div className="nm">{user}</div>
          <div className="em">{identity?.org.name ?? "railcode"}</div>
        </div>
      </div>
    </aside>
  );
}
