import { create } from "zustand";

import {
  cleanError,
  MATERIALS_PREFIX,
  materialDisplayName,
  materialStorageName,
  MaterialFile,
  MAX_MATERIAL_BYTES,
  VersionRecord,
  formatBytes,
} from "@/lib/materials";

const AGENT_NAME = "pitch-deck-writer";

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

const versionsCol = () => db.collection<VersionRecord>("versions");

async function refreshMaterials(): Promise<MaterialFile[]> {
  const all = await files.list();
  return all
    .filter((f) => f.name.startsWith(MATERIALS_PREFIX))
    .map((f) => ({
      name: materialDisplayName(f.name),
      fileName: f.name,
      contentType: f.content_type,
      size: f.size,
      updatedAt: f.updated_at,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

async function refreshVersions(): Promise<VersionRecord[]> {
  const rows = await versionsCol().query().orderBy("createdAt", "desc").page(1, 200);
  return rows.map((r) => r.value);
}

export const useDeckStore = create<DeckState>((set, get) => ({
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
      const [identity, materials, versions] = await Promise.all([
        me(),
        refreshMaterials(),
        refreshVersions(),
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
        await files.upload(materialStorageName(file.name), file, file.type || "application/octet-stream");
      } catch (error) {
        failures.push(cleanError(error));
      }
    }
    try {
      const materials = await refreshMaterials();
      set({ materials, uploading: false, error: failures[0] || null });
    } catch (error) {
      set({ uploading: false, error: cleanError(error) });
    }
  },

  async removeMaterial(fileName) {
    try {
      await files.delete(fileName);
      set((s) => ({ materials: s.materials.filter((m) => m.fileName !== fileName) }));
    } catch (error) {
      set({ error: cleanError(error) });
    }
  },

  async generate() {
    if (get().generating) return;
    set({ generating: true, error: null, generateStartedAt: Date.now() });
    try {
      const run = await agents.invoke(AGENT_NAME, { context: get().context.trim() });
      if (run.status === "failed") {
        throw new Error(run.error || "The deck agent run failed.");
      }
      const versions = await refreshVersions();
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
  },

  selectVersion: (id) => set({ selectedVersionId: id, view: "deck" }),
  clearError: () => set({ error: null }),
}));
