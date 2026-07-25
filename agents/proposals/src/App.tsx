import { useEffect } from "react";

import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { Proposal } from "@/views/Proposal";
import { useProposalStore } from "@/store/proposal-store";

/**
 * The agent runs on a 30-minute cron and the browser is never told about it, so
 * a tab someone leaves open would otherwise never show a new proposal. Poll at
 * half the agent's period — often enough that a draft appears without a manual
 * refresh, rare enough to be free.
 */
const POLL_MS = 15 * 60 * 1000;

export function App() {
  const { loaded, error, notice, navOpen, bootstrap, refresh, setNavOpen, clearError, clearNotice } =
    useProposalStore();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

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

          <Proposal />
        </div>
      </main>
    </div>
  );
}
