import { useEffect } from "react";

import { CommandBar } from "@/components/CommandBar";
import { DealProposalModal } from "@/components/DealProposalModal";
import { GranolaModal } from "@/components/GranolaModal";
import { RecordPage } from "@/components/RecordPage";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { ActionItems } from "@/views/ActionItems";
import { Activity } from "@/views/Activity";
import { AskAi } from "@/views/AskAi";
import { Automations } from "@/views/Automations";
import { Companies } from "@/views/Companies";
import { Contacts } from "@/views/Contacts";
import { Home } from "@/views/Home";
import { Notifications } from "@/views/Notifications";
import { Pipeline } from "@/views/Pipeline";
import { useAutomationStore } from "@/store/automation-store";
import { useCrmStore } from "@/store/crm-store";
import { useGranolaStore } from "@/store/granola-store";

export function App() {
  const {
    view,
    loaded,
    error,
    navOpen,
    commandOpen,
    record,
    bootstrap,
    syncFromUrl,
    setNavOpen,
    setCommandOpen,
    clearError,
  } = useCrmStore();
  const {
    error: autoError,
    notice: autoNotice,
    bootstrap: bootstrapAutomations,
    refresh: refreshAutomations,
    clearError: clearAutoError,
    clearNotice: clearAutoNotice,
  } = useAutomationStore();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // The path names the tab. The store reads it once at creation; this keeps up
  // with Back/Forward. pushState doesn't fire popstate, so our own navigations
  // don't round-trip through here.
  useEffect(() => {
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [syncFromUrl]);

  // Automations load after the workspace, since a notification's title resolves
  // through the deals the CRM store holds.
  useEffect(() => {
    if (!loaded) return;
    void bootstrapAutomations();
  }, [loaded, bootstrapAutomations]);

  // Background Granola sync: once the workspace has loaded (so there are
  // contacts to match against) and every 10 minutes after. Auto-imports
  // email-matched meetings onto the people they were with.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void (async () => {
      await useGranolaStore.getState().checkConnection();
      if (!cancelled) void useGranolaStore.getState().autoSync({ silent: true });
    })();
    const id = window.setInterval(
      () => void useGranolaStore.getState().autoSync({ silent: true }),
      10 * 60 * 1000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [loaded]);

  // There's no push channel, so a run finished by someone else's browser (or by a
  // tab that has since closed) only becomes visible on a poll. This rides the same
  // interval as the Granola sync.
  useEffect(() => {
    if (!loaded) return;
    const id = window.setInterval(() => void refreshAutomations(), 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [loaded, refreshAutomations]);

  // global shortcuts: ⌘K / Ctrl+K opens Quick add; Esc closes layers
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(!useCrmStore.getState().commandOpen);
        return;
      }
      if (e.key === "Escape") {
        const s = useCrmStore.getState();
        if (s.commandOpen) setCommandOpen(false);
        else if (s.navOpen) setNavOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandOpen, setNavOpen]);

  if (!loaded) {
    return (
      <div className="loading">
        <span className="spin" />
        <span>Loading your workspace…</span>
      </div>
    );
  }

  return (
    <div className={`app${navOpen ? " navopen" : ""}`}>
      <Sidebar />
      {navOpen ? <div className="scrim" onClick={() => setNavOpen(false)} /> : null}

      <main>
        <Topbar />
        {/* Ask AI owns its scrolling: the transcript scrolls, the composer
            stays pinned to the bottom of the panel. */}
        <div className={`content${view === "ask" && !record ? " chatmode" : ""}`}>
          {error ? (
            <div className="banner">
              <span>{error}</span>
              <button className="link" style={{ color: "inherit" }} onClick={clearError}>
                Dismiss
              </button>
            </div>
          ) : null}

          {autoError ? (
            <div className="banner">
              <span>{autoError}</span>
              <button
                className="link"
                style={{ color: "inherit" }}
                onClick={clearAutoError}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {autoNotice ? (
            <div className="notice">
              <span>{autoNotice}</span>
              <button className="link" onClick={clearAutoNotice}>
                Dismiss
              </button>
            </div>
          ) : null}

          {record ? (
            <RecordPage />
          ) : (
            <>
              {view === "home" ? <Home /> : null}
              {view === "ask" ? <AskAi /> : null}
              {view === "pipeline" ? <Pipeline /> : null}
              {view === "companies" ? <Companies /> : null}
              {view === "contacts" ? <Contacts /> : null}
              {view === "actionItems" ? <ActionItems /> : null}
              {view === "activity" ? <Activity /> : null}
              {view === "automations" ? <Automations /> : null}
              {view === "notifications" ? <Notifications /> : null}
            </>
          )}
        </div>
      </main>

      {commandOpen ? <CommandBar /> : null}
      <GranolaModal />
      <DealProposalModal />
    </div>
  );
}
