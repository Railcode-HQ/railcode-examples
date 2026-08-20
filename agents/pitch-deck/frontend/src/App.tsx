import { useEffect } from "react";

import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { Deck } from "@/views/Deck";
import { Materials } from "@/views/Materials";
import { useDeckStore } from "@/store/deck-store";

export function App() {
  const { view, loaded, error, navOpen, bootstrap, setNavOpen, clearError } = useDeckStore();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!loaded) {
    return (
      <div className="loading">
        <span className="spin" />
        <span>Loading your studio…</span>
      </div>
    );
  }

  return (
    <div className={`app${navOpen ? " navopen" : ""}`}>
      <Sidebar />
      {navOpen ? <div className="scrim" onClick={() => setNavOpen(false)} /> : null}

      <main>
        <Topbar />
        <div className="content">
          {error ? (
            <div className="banner">
              <span>{error}</span>
              <button className="link" style={{ color: "inherit" }} onClick={clearError}>
                Dismiss
              </button>
            </div>
          ) : null}

          {view === "materials" ? <Materials /> : null}
          {view === "deck" ? <Deck /> : null}
        </div>
      </main>
    </div>
  );
}
