import { Files, Presentation } from "lucide-react";

import { View, useDeckStore } from "@/store/deck-store";

const NAV: { id: View; label: string; icon: typeof Files }[] = [
  { id: "materials", label: "Materials", icon: Files },
  { id: "deck", label: "Deck", icon: Presentation },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function Sidebar() {
  const { view, setView, identity, materials, versions } = useDeckStore();

  const counts: Record<View, number | undefined> = {
    materials: materials.length || undefined,
    deck: versions.length || undefined,
  };

  const user = identity?.user.name ?? "you";

  return (
    <aside>
      <div className="brand">
        <span className="mark">
          <Presentation size={15} strokeWidth={2.2} />
        </span>
        <b>Pitch Deck</b>
      </div>

      <div className="navgroup">
        <div className="navlabel">Studio</div>
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
