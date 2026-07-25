import { ChartIcon, DatabaseIcon, MenuIcon } from "./Icons";
import { useChatStore } from "@/store/chat-store";
import type { SourceId } from "@/lib/types";

const SOURCES: { id: SourceId; label: string; icon: "db" | "chart" }[] = [
  { id: "postgres", label: "Postgres", icon: "db" },
  { id: "posthog", label: "PostHog", icon: "chart" },
];

export function Topbar() {
  const activeId = useChatStore((s) => s.activeId);
  const title = useChatStore((s) => (s.activeId ? s.conversations[s.activeId]?.title : null));
  const prefs = useChatStore((s) => s.prefs);
  const providers = useChatStore((s) => s.providers);
  const setModel = useChatStore((s) => s.setModel);
  const toggleSource = useChatStore((s) => s.toggleSource);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);

  const models = providers.flatMap((p) => p.models.map((m) => m.model));

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn nav-toggle"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open conversations"
      >
        <MenuIcon size={18} />
      </button>

      <h1 className="topbar-title">{activeId ? (title ?? "Chat") : "New chat"}</h1>

      <div className="topbar-right">
        <div className="source-toggles" role="group" aria-label="Data sources">
          {SOURCES.map((source) => (
            <button
              type="button"
              key={source.id}
              className={`source-pill${prefs.sources[source.id] ? " on" : ""}`}
              onClick={() => void toggleSource(source.id)}
              aria-pressed={prefs.sources[source.id]}
              title={`${prefs.sources[source.id] ? "Disable" : "Enable"} ${source.label}`}
            >
              {source.icon === "db" ? <DatabaseIcon size={13} /> : <ChartIcon size={13} />}
              <span>{source.label}</span>
            </button>
          ))}
        </div>

        {models.length > 0 ? (
          <select
            className="model-select"
            value={prefs.model ?? ""}
            onChange={(e) => void setModel(e.target.value || null)}
            aria-label="Model"
          >
            <option value="">Org default</option>
            {models.map((model) => (
              <option value={model} key={model}>
                {model}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </header>
  );
}
