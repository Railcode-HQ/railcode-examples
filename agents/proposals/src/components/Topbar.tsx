import { Loader2, Menu, RefreshCw } from "lucide-react";

import { useProposalStore } from "@/store/proposal-store";

export function Topbar() {
  const { setNavOpen, refresh, refreshing, proposals, selectedId } = useProposalStore();
  const selected = proposals.find((p) => p.id === selectedId);

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
        <span>Proposals</span>
        {selected ? (
          <>
            <span className="sep">/</span>
            <span className="cur">{selected.client || selected.title}</span>
          </>
        ) : null}
      </div>

      <div className="spacer" />

      {/* Nothing pushes to the browser, and the agent writes on its own cycle,
          so a tab left open goes stale silently without this. */}
      <button className="btn ghost sm" disabled={refreshing} onClick={() => void refresh()}>
        {refreshing ? <Loader2 size={14} className="icon-spin" /> : <RefreshCw size={14} />}
        {refreshing ? "Checking…" : "Refresh"}
      </button>
    </div>
  );
}
