import { create } from "zustand";

import { cleanError } from "@/lib/crm";
import { waitForConnection } from "@/lib/connect";
import { GCAL_TOOLKIT, connectGcal, isGcalConnected } from "@/lib/gcal";
import { useTriageStore } from "@/store/triage-store";

/**
 * Connection state for Google Calendar, and nothing else.
 *
 * Deliberately much smaller than its Granola counterpart. Granola's store also
 * owns a bulk import — meeting notes, matched to the people they were with, on a
 * timer — and none of that transfers: a calendar invite has no notes to import,
 * and pouring every event into the CRM as a call note would bury the ones that
 * carry something. The calendar's whole job is to put a meeting in front of you
 * on Home so you can decide whether it's a deal, which is `triage-store`'s.
 */
type GcalState = {
  connected: boolean | null; // null = not checked yet
  connecting: boolean;
  error?: string;

  checkConnection: () => Promise<void>;
  connect: () => Promise<void>;
  clearError: () => void;
};

export const useGcalStore = create<GcalState>((set, get) => ({
  connected: null,
  connecting: false,

  async checkConnection() {
    try {
      set({ connected: await isGcalConnected() });
    } catch {
      // SDK unavailable or personal connectors disabled — treat as not connected.
      set({ connected: false });
    }
  },

  async connect() {
    if (get().connecting) return;
    set({ connecting: true, error: undefined });
    let popup: Window | null = null;
    try {
      popup = window.open(await connectGcal(), "_blank", "width=520,height=680");
      const connected = await waitForConnection(GCAL_TOOLKIT, popup);
      set({ connecting: false, connected });
      if (!connected) {
        set({ error: "Didn't finish connecting to Google Calendar — try again." });
        return;
      }
      // Connected: pull the last week in straight away, so the section the user
      // just clicked "connect" from fills rather than staying empty.
      void useTriageStore.getState().refresh();
    } catch (error) {
      set({ connecting: false, error: cleanError(error) });
    } finally {
      popup?.close();
    }
  },

  clearError: () => set({ error: undefined }),
}));
