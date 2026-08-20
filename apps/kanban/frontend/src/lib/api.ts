// The only module in the frontend that touches the network. Every call maps to
// one worker route in server/index.ts; nothing here knows a platform endpoint
// exists, and nothing here holds a credential.
//
// Components and the store import `api`. They never fetch directly.
import type { Card } from "../types";

/** One org member, exactly as the worker's /api/users route returns them. */
export interface Member {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
}

/** The verified caller. Same shape — the worker hands back its own ctx.user. */
export type Me = Member;

/** A failed worker call, carrying the status the worker relayed. The status is
 *  the part the UI can act on: 403 means "not allowed", not "broken". */
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
      const parsed = JSON.parse(body) as { error?: string; message?: string };
      message = parsed.message || parsed.error || body;
    } catch {
      /* not JSON — keep the raw body */
    }
    throw new ApiError(res.status, message || res.statusText);
  }
  return res.status === 204 ? (null as T) : ((await res.json()) as T);
}

export const api = {
  me: () => call<{ user: Me }>("/api/me").then((r) => r.user),
  users: () => call<Member[]>("/api/users"),

  listCards: () => call<Card[]>("/api/cards"),
  createCard: (input: Partial<Card>) =>
    call<Card>("/api/cards", { method: "POST", body: JSON.stringify(input) }),
  patchCard: (id: string, patch: Partial<Card>) =>
    call<Card>(`/api/cards/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCard: (id: string) =>
    call<null>(`/api/cards/${encodeURIComponent(id)}`, { method: "DELETE" }),

  addAttachment: (id: string, file: File) =>
    call<Card>(
      `/api/cards/${encodeURIComponent(id)}/attachments?name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      },
    ),
  removeAttachment: (id: string, attachmentId: string) =>
    call<Card>(
      `/api/cards/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`,
      { method: "DELETE" },
    ),
};

/** Where an attachment's bytes come from. The worker streams them, so this is
 *  a plain href that works on every storage backend and needs no signed URL. */
export function attachmentHref(cardId: string, attachmentId: string): string {
  return `/api/cards/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(attachmentId)}`;
}
