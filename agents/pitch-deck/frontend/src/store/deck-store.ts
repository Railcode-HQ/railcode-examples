import { create } from "zustand";

import { api, ApiError, TERMINAL, type Me, type RunStatus } from "@/lib/api";
import {
  cleanError,
  MaterialFile,
  MAX_MATERIAL_BYTES,
  VersionRecord,
  formatBytes,
} from "@/lib/materials";

export type View = "materials" | "deck";

type DeckState = {
  identity: Me | null;
  loaded: boolean;
  error: string | null;

  view: View;
  navOpen: boolean;
  materials: MaterialFile[];
  versions: VersionRecord[];
  selectedVersionId: string | null;

  context: string;
  uploading: boolean;
  generating: boolean;
  generateStartedAt: number | null;

  bootstrap: () => Promise<void>;
  setView: (view: View) => void;
  setNavOpen: (open: boolean) => void;
  setContext: (text: string) => void;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeMaterial: (fileName: string) => Promise<void>;
  generate: () => Promise<void>;
  selectVersion: (id: string) => void;
  clearError: () => void;
};

// The agent writes a PDF in a sandbox: it reads every material, generates a
// build script, runs it, and publishes the result. That is minutes of work, so
// the worker starts the run and the browser waits — polling a route of its own,
// which is the only place a wait that long can live.
const POLL_MS = 3_000;

export const useDeckStore = create<DeckState>((set, get) => {
  /** Follow one run to its end, then pull the new version in. Survives a page
   *  refresh: bootstrap() reattaches to whatever run is still live. */
  async function follow(requestId: string, startedAtMs: number): Promise<void> {
    set({ generating: true, generateStartedAt: startedAtMs, error: null });
    try {
      let run: RunStatus = await api.runStatus(requestId);
      while (run.status && !TERMINAL.includes(run.status)) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        run = await api.runStatus(requestId);
      }
      if (run.status !== "success") {
        // A failed run is the agent's answer, not a broken app — say what it
        // said. `limit_exceeded` means the run hit its own step/token ceiling.
        throw new Error(
          run.error ||
            (run.status === "limit_exceeded"
              ? "The deck agent hit its run limits before finishing."
              : `The deck agent run ${run.status}.`),
        );
      }
      const versions = await api.versions();
      set({
        versions,
        selectedVersionId: versions[0]?.id ?? null,
        context: "",
        view: "deck",
      });
    } catch (error) {
      set({ error: cleanError(error) });
    } finally {
      set({ generating: false, generateStartedAt: null });
    }
  }

  return {
    identity: null,
    loaded: false,
    error: null,

    view: "materials",
    navOpen: false,
    materials: [],
    versions: [],
    selectedVersionId: null,

    context: "",
    uploading: false,
    generating: false,
    generateStartedAt: null,

    async bootstrap() {
      try {
        const [identity, materials, versions, live] = await Promise.all([
          api.me(),
          api.materials(),
          api.versions(),
          api.liveRun(),
        ]);
        set({
          identity,
          materials,
          versions,
          loaded: true,
          // First run (no materials yet) opens straight into the uploader; once
          // there's at least one material, land on the working view instead.
          view: materials.length === 0 ? "materials" : "deck",
          selectedVersionId: versions[0]?.id ?? null,
        });
        // A run started before the last page load is still going. Reattach to
        // it rather than showing an idle studio over a live sandbox.
        if (live.requestId && live.status && !TERMINAL.includes(live.status)) {
          const startedAtMs = live.startedAt ? Date.parse(live.startedAt) : Date.now();
          set({ view: "deck" });
          void follow(live.requestId, Number.isNaN(startedAtMs) ? Date.now() : startedAtMs);
        }
      } catch (error) {
        set({ error: cleanError(error), loaded: true });
      }
    },

    setView: (view) => set({ view, navOpen: false }),
    setNavOpen: (navOpen) => set({ navOpen }),
    setContext: (context) => set({ context }),

    async addFiles(fileList) {
      const list = Array.from(fileList);
      if (list.length === 0) return;
      set({ uploading: true, error: null });
      const failures: string[] = [];
      for (const file of list) {
        if (file.size > MAX_MATERIAL_BYTES) {
          failures.push(
            `${file.name} is ${formatBytes(file.size)} — materials are capped at ${formatBytes(MAX_MATERIAL_BYTES)} each.`,
          );
          continue;
        }
        try {
          await api.uploadMaterial(file);
        } catch (error) {
          failures.push(cleanError(error));
        }
      }
      try {
        const materials = await api.materials();
        set({ materials, uploading: false, error: failures[0] || null });
      } catch (error) {
        set({ uploading: false, error: cleanError(error) });
      }
    },

    async removeMaterial(fileName) {
      const material = get().materials.find((m) => m.fileName === fileName);
      if (!material) return;
      try {
        await api.deleteMaterial(material.name);
        set((s) => ({ materials: s.materials.filter((m) => m.fileName !== fileName) }));
      } catch (error) {
        set({ error: cleanError(error) });
      }
    },

    async generate() {
      if (get().generating) return;
      set({ generating: true, error: null, generateStartedAt: Date.now() });
      try {
        const started = await api.startGenerate(get().context.trim());
        if (!started.requestId) throw new Error("The deck agent did not start.");
        await follow(started.requestId, Date.now());
      } catch (error) {
        // 403 here means the manifest doesn't declare this agent (or the
        // deploying user can't grant it), not that something broke.
        set({
          error:
            error instanceof ApiError && error.status === 403
              ? "This app isn't allowed to start the deck agent. Check `agents:` in manifest.yaml, then redeploy."
              : cleanError(error),
          generating: false,
          generateStartedAt: null,
        });
      }
    },

    selectVersion: (id) => set({ selectedVersionId: id, view: "deck" }),
    clearError: () => set({ error: null }),
  };
});
