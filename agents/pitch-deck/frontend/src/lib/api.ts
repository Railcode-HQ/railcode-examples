// The only module in the frontend that touches the network. Every call maps to
// one worker route in server/index.ts. Nothing here holds a credential, and
// nothing here knows a platform endpoint exists.
import type { MaterialFile, VersionRecord } from "@/lib/materials";
import { materialDisplayName } from "@/lib/materials";

export interface Me {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
}

/** A run of the deck agent, as the worker reports it. `queued` and `running`
 *  both mean "keep polling"; the rest are terminal. */
export interface RunStatus {
  requestId: string | null;
  status?: "queued" | "running" | "success" | "failed" | "cancelled" | "limit_exceeded";
  error?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
}

export const TERMINAL = ["success", "failed", "cancelled", "limit_exceeded"];

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { error?: string; message?: string; detail?: string };
      message = parsed.message || parsed.detail || parsed.error || body;
    } catch {
      /* not JSON — keep the raw body */
    }
    throw new ApiError(res.status, message || res.statusText);
  }
  return res.status === 204 ? (null as T) : ((await res.json()) as T);
}

interface FileMeta {
  name: string;
  content_type: string;
  size: number;
  updated_at: string;
}

const toMaterial = (f: FileMeta): MaterialFile => ({
  name: materialDisplayName(f.name),
  fileName: f.name,
  contentType: f.content_type,
  size: f.size,
  updatedAt: f.updated_at,
});

export const api = {
  me: () => call<{ user: Me }>("/api/me").then((r) => r.user),

  materials: () =>
    call<FileMeta[]>("/api/materials").then((rows) =>
      rows.map(toMaterial).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    ),
  // The display name is sent as a query parameter; the worker applies the
  // materials/ prefix itself, so the browser never names a storage key.
  uploadMaterial: (file: File) =>
    call<FileMeta>(`/api/materials?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    }).then(toMaterial),
  // The display name, same as on the way in — the worker owns the storage name.
  deleteMaterial: (displayName: string) =>
    call<null>(`/api/materials/${displayName.split("/").map(encodeURIComponent).join("/")}`, {
      method: "DELETE",
    }),

  versions: () => call<VersionRecord[]>("/api/versions"),

  startGenerate: (context: string) =>
    call<RunStatus>("/api/generate", { method: "POST", body: JSON.stringify({ context }) }),
  runStatus: (requestId: string) =>
    call<RunStatus>(`/api/generate/${encodeURIComponent(requestId)}`),
  liveRun: () => call<RunStatus>("/api/generate"),
};

/** Where a generated deck's bytes come from. The worker streams the PDF inline,
 *  so an <iframe> can point straight at this — no fetch-to-blob step. */
export const deckSrc = (versionId: string): string =>
  `/api/versions/${encodeURIComponent(versionId)}/pdf`;
