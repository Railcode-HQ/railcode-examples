import { FileText } from "lucide-react";

import { formatDay } from "@/lib/proposals";
import { useProposalStore } from "@/store/proposal-store";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * The proposal list IS the navigation — there is nowhere else to go. The app
 * has one screen, because the agent produces exactly one kind of thing.
 */
export function Sidebar() {
  const { proposals, selectedId, select, identity } = useProposalStore();
  const user = identity?.user.name ?? "you";

  return (
    <aside>
      <div className="brand">
        <span className="mark">
          <FileText size={15} strokeWidth={2.2} />
        </span>
        <b>Proposals</b>
      </div>

      <div className="navgroup list">
        <div className="navlabel">
          Drafted for you{proposals.length ? ` · ${proposals.length}` : ""}
        </div>
        <nav>
          {proposals.map((p) => (
            <button
              key={p.id}
              className={`nav${p.id === selectedId ? " active" : ""}`}
              onClick={() => select(p.id)}
            >
              <span className="label">
                {p.client || p.title || "Untitled"}
                <span className="sub">
                  {formatDay(p.createdAt)}
                  {p.edited ? " · edited" : ""}
                  {p.placeholders?.length ? ` · ${p.placeholders.length} to fill` : ""}
                </span>
              </span>
            </button>
          ))}
          {proposals.length === 0 ? <div className="navempty">Nothing drafted yet</div> : null}
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
