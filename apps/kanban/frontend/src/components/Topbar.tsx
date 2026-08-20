import { useStore } from "../store";
import { DONE_PRESETS, type DonePreset } from "../types";
import type { ThemeSetting } from "../lib/theme";
import { SelectMenu } from "./SelectMenu";
import {
  IconCalendar,
  IconMenu,
  IconMonitor,
  IconMoon,
  IconSearch,
  IconSun,
} from "./icons";

const NEXT_THEME: Record<ThemeSetting, ThemeSetting> = {
  light: "dark",
  dark: "system",
  system: "light",
};
const THEME_LABEL: Record<ThemeSetting, string> = {
  light: "Theme: light (click for dark)",
  dark: "Theme: dark (click for system)",
  system: "Theme: system (click for light)",
};

export function Topbar() {
  const view = useStore((s) => s.view);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const doneFilter = useStore((s) => s.doneFilter);
  const setDoneFilter = useStore((s) => s.setDoneFilter);
  const setSidebar = useStore((s) => s.setSidebar);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  const doneActive = doneFilter.preset !== "all";
  const crumb = view === "board" ? "Board" : "List";
  const ThemeIcon =
    theme === "light" ? IconSun : theme === "dark" ? IconMoon : IconMonitor;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="icon-btn menu-btn"
          aria-label="Open menu"
          onClick={() => setSidebar(true)}
        >
          <IconMenu />
        </button>
        <div className="crumb">
          <span className="crumb-dim">Kanban</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-cur">{crumb}</span>
        </div>
      </div>

      <div className="topbar-right">
        <button
          className="icon-btn"
          aria-label={THEME_LABEL[theme]}
          title={THEME_LABEL[theme]}
          onClick={() => setTheme(NEXT_THEME[theme])}
        >
          <ThemeIcon />
        </button>

        <label className="search-field">
          <IconSearch />
          <input
            type="text"
            placeholder="Filter cards…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="search-clear"
              aria-label="Clear filter"
              onClick={() => setSearch("")}
            >
              ×
            </button>
          )}
        </label>

        <SelectMenu
          ariaLabel="Filter Done by date"
          align="right"
          className={`done-select${doneActive ? " on" : ""}`}
          lead={<IconCalendar />}
          value={doneFilter.preset}
          onChange={(v) =>
            setDoneFilter({ ...doneFilter, preset: v as DonePreset })
          }
          options={DONE_PRESETS.map((p) => ({
            value: p.key,
            label: p.label,
            triggerLabel: p.key === "all" ? "Done: all time" : p.label,
          }))}
        />

        {doneFilter.preset === "custom" && (
          <div className="date-range">
            <input
              type="date"
              value={doneFilter.from}
              max={doneFilter.to || undefined}
              onChange={(e) =>
                setDoneFilter({ ...doneFilter, from: e.target.value })
              }
              aria-label="Done from"
            />
            <span className="date-dash">–</span>
            <input
              type="date"
              value={doneFilter.to}
              min={doneFilter.from || undefined}
              onChange={(e) =>
                setDoneFilter({ ...doneFilter, to: e.target.value })
              }
              aria-label="Done to"
            />
          </div>
        )}
      </div>
    </header>
  );
}
