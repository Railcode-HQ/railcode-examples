// Personal-connector plumbing, shared by every toolkit the CRM talks to.
//
// A personal connection belongs to the CALLER, not the app: the manifest
// declares the toolkit, each person links their own account, and these calls run
// in the browser against whoever is signed in. Two toolkits now use this — see
// `lib/granola.ts` and `lib/gcal.ts` — so the OAuth dance lives here once.

import { personalConnections } from "@/lib/railcode";

export async function isToolkitConnected(toolkit: string): Promise<boolean> {
  const connections = await personalConnections.list();
  return connections.some((c) => c.toolkit === toolkit && c.status === "active");
}

/** Opens the provider's OAuth URL; the caller owns the popup. */
export async function connectToolkit(toolkit: string): Promise<string> {
  const { redirect_url } = await personalConnections.connect(toolkit);
  // A "token" connector authenticates with a pasted key, which an app cannot
  // securely collect — there is no URL to open, and the user links it from the
  // Railcode console instead.
  if (!redirect_url) {
    throw new Error(
      "This connector is linked from the Railcode console rather than through the app.",
    );
  }
  return redirect_url;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits for a toolkit to report an active connection.
 *
 * There's no callback into the app — the OAuth redirect lands on the platform,
 * not here — so polling the connection list is the only way to learn it worked.
 * A closed popup gets one last check rather than an immediate no: the window
 * often closes a beat before the connection is recorded.
 */
export async function waitForConnection(
  toolkit: string,
  popup: Window | null,
): Promise<boolean> {
  const timeoutMs = 180_000;
  const intervalMs = 1500;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(intervalMs);
    if (await isToolkitConnected(toolkit)) return true;
    if (popup?.closed) return isToolkitConnected(toolkit);
  }
  return false;
}
