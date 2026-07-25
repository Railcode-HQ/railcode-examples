import { useEffect } from "react";

import { CommandBar } from "@/components/CommandBar";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { Materials } from "@/views/Materials";
import { Meetings } from "@/views/Meetings";
import { Proposal } from "@/views/Proposal";
import { Settings } from "@/views/Settings";
import { Setup } from "@/views/Setup";
import { useProposalStore } from "@/store/proposal-store";

export function App() {
  const { view, loaded, error, notice, navOpen, bootstrap, setNavOpen, clearError, clearNotice } =
    useProposalStore();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(clearNotice, 3000);
    return () => clearTimeout(id);
  }, [notice, clearNotice]);

  if (!loaded) {
    return (
      <div className="loading">
        <span className="spin" />
        <span>Loading your proposals…</span>
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

          {notice ? <div className="banner ok">{notice}</div> : null}

          {view === "setup" ? <Setup /> : null}
          {view === "meetings" ? <Meetings /> : null}
          {view === "proposal" ? <Proposal /> : null}
          {view === "materials" ? <Materials /> : null}
          {view === "settings" ? <Settings /> : null}
        </div>
      </main>

      <CommandBar />
    </div>
  );
}
