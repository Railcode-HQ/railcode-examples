import { create } from "zustand";

/**
 * Light/dark is a per-browser preference, not workspace data, so it lives in
 * localStorage rather than a Railcode collection — your teammates' eyes are
 * their own business.
 *
 * The OS preference stays in charge until you press the toggle. Pressing it
 * pins a side, and the app stops following the system from then on; there is
 * deliberately no third "auto" position on a two-state control, since a toggle
 * that cycles through three values can't tell you what pressing it will do.
 */
export type Theme = "light" | "dark";

const KEY = "crm.theme";

const query = () => window.matchMedia("(prefers-color-scheme: dark)");

function systemTheme(): Theme {
  return query().matches ? "dark" : "light";
}

/** The pinned choice, or null while the OS is still deciding. */
function readPinned(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null; // private mode / storage disabled: follow the system
  }
}

/** The same attribute the pre-paint snippet in index.html sets. */
function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

type ThemeState = {
  theme: Theme;
  pinned: Theme | null;
  toggle: () => void;
};

export const useThemeStore = create<ThemeState>((set, get) => {
  const pinned = readPinned();
  const theme = pinned ?? systemTheme();
  apply(theme);

  // Keeps up with the OS flipping at sunset, but only while unpinned.
  query().addEventListener("change", (e) => {
    if (get().pinned) return;
    const next: Theme = e.matches ? "dark" : "light";
    apply(next);
    set({ theme: next });
  });

  return {
    theme,
    pinned,

    toggle: () => {
      const next: Theme = get().theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // Storage is unavailable — honour the choice for this session anyway.
      }
      apply(next);
      set({ theme: next, pinned: next });
    },
  };
});
