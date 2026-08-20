// The only module in the frontend that touches the network. Every call maps to
// one worker route in server/index.ts.
import type { ManualRun, ProposalRecord, ScoutState } from "@/lib/proposals";

export interface Me {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
}

/** The whole page, in one answer. The worker fans out to three collections and
 *  replies once, because it is already next to the data. */
export interface AppState {
  proposals: ProposalRecord[];
  scout: ScoutState | null;
  manualRun: ManualRun | null;
}

/** One run's status. `mine: false` means the run belongs to another member —
 *  the in-flight marker is shared, but a run is owned by (app, caller), so its
 *  status is not readable from here. Not an error: the button still greys out. */
export interface RunStatus {
  mine: boolean;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}

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

export const api = {
  me: () => call<{ user: Me }>("/api/me").then((r) => r.user),
  state: () => call<AppState>("/api/state"),

  startRun: () => call<ManualRun>("/api/run", { method: "POST" }),
  runStatus: (requestId: string) => call<RunStatus>(`/api/run/${encodeURIComponent(requestId)}`),
  clearRun: () => call<null>("/api/run", { method: "DELETE" }),

  saveDocx: (proposalId: string, blob: Blob) =>
    call<ProposalRecord>(`/api/proposals/${encodeURIComponent(proposalId)}/docx`, {
      method: "PUT",
      headers: { "content-type": blob.type || "application/octet-stream" },
      body: blob,
    }),
};

/** Where a proposal's .docx bytes come from. A plain URL the editor can fetch. */
export const docxSrc = (proposalId: string): string =>
  `/api/proposals/${encodeURIComponent(proposalId)}/docx`;
