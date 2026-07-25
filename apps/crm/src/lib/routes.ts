/**
 * URL routing for the top-level tabs.
 *
 * Real paths (`/pipeline`), driven by the History API. Railcode serves any path
 * under the app's host from index.html, so a deep link or a refresh lands on the
 * app and the table below decides which tab it opens.
 */

export type View =
  | "home"
  | "ask"
  | "activity"
  | "pipeline"
  | "companies"
  | "contacts"
  | "actionItems"
  | "automations"
  | "notifications";

/** Every tab's path. Record<View, …> keeps this exhaustive as views are added. */
export const VIEW_PATHS: Record<View, string> = {
  home: "/",
  ask: "/ask",
  pipeline: "/pipeline",
  companies: "/companies",
  contacts: "/contacts",
  actionItems: "/action-items",
  activity: "/activity",
  automations: "/automations",
  notifications: "/notifications",
};

/** What each tab is called, wherever one has to be named in prose or a crumb. */
export const VIEW_LABELS: Record<View, string> = {
  home: "Home",
  ask: "Ask AI",
  activity: "Activity",
  pipeline: "Pipeline",
  companies: "Companies",
  contacts: "Contacts",
  actionItems: "Action items",
  automations: "Automations",
  notifications: "Notifications",
};

const VIEW_BY_PATH = new Map(
  Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as View]),
);

/** The href for a tab — what a nav link points at. */
export function hrefFor(view: View): string {
  return VIEW_PATHS[view];
}

/** Drop a trailing slash so "/pipeline/" and "/pipeline" are the same route. */
function normalize(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

/** The view the current URL names; anything unrecognized lands on Home. */
export function viewFromPath(pathname: string): View {
  return VIEW_BY_PATH.get(normalize(pathname)) ?? "home";
}

/**
 * Point the URL at a view, adding a history entry so Back returns to the previous
 * tab. Re-selecting the current tab doesn't pile up entries.
 */
export function pushView(view: View): void {
  const href = hrefFor(view);
  if (normalize(window.location.pathname) === href) return;
  window.history.pushState(null, "", href);
}

/**
 * Tidy a URL the app didn't write — an unknown path, or "/pipeline/" — to the
 * canonical path for the view actually being shown. replaceState so landing on a
 * stale link doesn't leave a dead entry behind.
 */
export function canonicalizePath(view: View): void {
  const href = hrefFor(view);
  if (window.location.pathname !== href) {
    window.history.replaceState(null, "", href);
  }
}
