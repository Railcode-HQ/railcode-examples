import { useEffect } from "react";
import { Composer } from "./components/Composer";
import { EmptyState } from "./components/EmptyState";
import { AlertIcon, CloseIcon } from "./components/Icons";
import { MessageList } from "./components/MessageList";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { useChatStore } from "./store/chat-store";

export function App() {
  const ready = useChatStore((s) => s.ready);
  const bootError = useChatStore((s) => s.bootError);
  const error = useChatStore((s) => s.error);
  const dismissError = useChatStore((s) => s.dismissError);
  const bootstrap = useChatStore((s) => s.bootstrap);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const activeId = useChatStore((s) => s.activeId);
  const streaming = useChatStore((s) => s.stream !== null);
  const hasMessages = useChatStore((s) =>
    s.activeId ? (s.messages[s.activeId]?.length ?? 0) > 0 : false,
  );

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSidebarOpen]);

  if (bootError) {
    return (
      <div className="boot">
        <div className="boot-card">
          <AlertIcon size={18} />
          <h1>Can&apos;t start the app</h1>
          <p>{bootError}</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="boot">
        <div className="boot-spinner" aria-label="Loading" />
      </div>
    );
  }

  // The empty state stands in for the thread until there's something to show —
  // including while the very first reply streams into a brand-new conversation.
  const showEmpty = (!activeId || !hasMessages) && !streaming;

  return (
    <div className={`app${sidebarOpen ? " navopen" : ""}`}>
      <Sidebar />
      {sidebarOpen ? (
        <div className="scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      ) : null}

      <main className="main">
        <Topbar />

        {error ? (
          <div className="banner">
            <AlertIcon size={14} />
            <span className="banner-text">{error}</span>
            <button type="button" className="ghost-btn" onClick={dismissError} aria-label="Dismiss">
              <CloseIcon size={13} />
            </button>
          </div>
        ) : null}

        {showEmpty ? <EmptyState /> : <MessageList />}

        <Composer />
      </main>
    </div>
  );
}
