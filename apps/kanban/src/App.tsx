import { useEffect } from "react";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { Board } from "./components/Board";
import { ListView } from "./components/ListView";
import { CommandPalette } from "./components/CommandPalette";
import { CreateCardModal } from "./components/CreateCardModal";
import { CardDrawer } from "./components/CardDrawer";

export function App() {
  const init = useStore((s) => s.init);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const view = useStore((s) => s.view);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebar = useStore((s) => s.setSidebar);
  const openPalette = useStore((s) => s.openPalette);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const closePalette = useStore((s) => s.closePalette);

  useEffect(() => {
    init();
  }, [init]);

  // Global ⌘K / Ctrl-K to toggle the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Don't stack the palette over the create modal.
        if (useStore.getState().createSeed) return;
        if (useStore.getState().paletteOpen) closePalette();
        else openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette, closePalette]);

  return (
    <div className={`app${sidebarOpen ? " navopen" : ""}`}>
      <div className="scrim" onClick={() => setSidebar(false)} />
      <Sidebar />
      <main>
        <Topbar />
        <div className="content">
          {loading ? (
            <div className="state">
              <div className="spinner" />
              <p>Loading your board…</p>
            </div>
          ) : error ? (
            <div className="state">
              <div className="banner">{error}</div>
            </div>
          ) : view === "board" ? (
            <Board />
          ) : (
            <ListView />
          )}
        </div>
      </main>

      {paletteOpen && <CommandPalette />}
      <CreateCardModal />
      <CardDrawer />
    </div>
  );
}
