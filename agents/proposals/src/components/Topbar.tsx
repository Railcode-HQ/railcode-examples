import { Menu, Search } from "lucide-react";

import { View, useProposalStore } from "@/store/proposal-store";

const TITLES: Record<View, string> = {
  setup: "Setup",
  meetings: "Meetings",
  proposal: "Proposals",
  materials: "Materials",
  settings: "Settings",
};

export function Topbar() {
  const { view, setNavOpen, setCommandOpen } = useProposalStore();

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
        <span className="sep">/</span>
        <span className="cur">{TITLES[view]}</span>
      </div>

      <div className="spacer" />

      {/* A keyboard shortcut nobody knows about may as well not exist. */}
      <button className="cmd-trigger" onClick={() => setCommandOpen(true)}>
        <Search size={13} />
        <span>Search or jump to…</span>
        <kbd>⌘</kbd>
        <kbd>K</kbd>
      </button>
    </div>
  );
}
