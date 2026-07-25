import { Menu } from "lucide-react";

import { View, useDeckStore } from "@/store/deck-store";

const TITLES: Record<View, string> = {
  materials: "Materials",
  deck: "Deck",
};

export function Topbar() {
  const { view, setNavOpen } = useDeckStore();

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
        <span>Pitch Deck</span>
        <span className="sep">/</span>
        <span className="cur">{TITLES[view]}</span>
      </div>

      <div className="spacer" />
    </div>
  );
}
