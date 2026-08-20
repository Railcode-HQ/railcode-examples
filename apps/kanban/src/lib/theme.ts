// Theme preference is global (not per-user), so it can be applied to <html>
// before the Railcode SDK identifies anyone — see the inline script in
// index.html that does this synchronously to avoid a flash of the wrong theme.
export type ThemeSetting = "light" | "dark" | "system";

const THEME_KEY = "kanban.theme";

function systemTheme(): "light" | "dark" {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function loadTheme(): ThemeSetting {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* storage unavailable — fall back to system */
  }
  return "system";
}

export function saveTheme(theme: ThemeSetting): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable — theme just won't persist across reloads */
  }
}

export function resolveTheme(theme: ThemeSetting): "light" | "dark" {
  return theme === "system" ? systemTheme() : theme;
}

export function applyTheme(theme: ThemeSetting): void {
  document.documentElement.setAttribute("data-theme", resolveTheme(theme));
}
