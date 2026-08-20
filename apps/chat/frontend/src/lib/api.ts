// The only module in the frontend that touches the network. Every call maps to
// one worker route in server/index.ts.
//
// Note what is NOT here: no LLM call, no SQL, no connector. Those live in the
// worker now, which is the point — the browser has no authority to lend.
import type {
  ChatFrame,
  Conversation,
  LlmProviderInfo,
  Me,
  Message,
  Prefs,
  StoredPrefs,
} from "@shared/types";

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
  // The worker relays the platform's status and body verbatim, so the raw body
  // is handed on unchanged — lib/errors.ts reads the typed code out of it.
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.status === 204 ? (null as T) : ((await res.json()) as T);
}

export const api = {
  me: () => call<{ user: Me }>("/api/me").then((r) => r.user),
  providers: () => call<LlmProviderInfo[]>("/api/providers"),

  prefs: () => call<StoredPrefs | null>("/api/prefs"),
  savePrefs: (prefs: Prefs) =>
    call<StoredPrefs>("/api/prefs", { method: "PUT", body: JSON.stringify(prefs) }),

  conversations: () => call<Conversation[]>("/api/conversations"),
  messages: (convId: string) =>
    call<Message[]>(`/api/conversations/${encodeURIComponent(convId)}/messages`),
  patchConversation: (convId: string, patch: Partial<Conversation>) =>
    call<Conversation>(`/api/conversations/${encodeURIComponent(convId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteConversation: (convId: string) =>
    call<null>(`/api/conversations/${encodeURIComponent(convId)}`, { method: "DELETE" }),

  uploadAttachment: (file: File) =>
    call<{ id: string }>("/api/attachments", {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    }),
  deleteAttachment: (id: string) =>
    call<null>(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE" }),
  attachmentUrls: (ids: string[]) =>
    call<{ urls: Record<string, string> }>("/api/attachments/urls", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }).then((r) => r.urls),
};

/** Stream one assistant turn.
 *
 *  The worker answers with ndjson: one JSON object per line, parsed and handed
 *  on as it arrives. Aborting the signal hangs up the response, which cancels
 *  the loop in the worker — so Stop really stops the model, not just the UI.
 */
export async function* streamChat(
  body: unknown,
  signal: AbortSignal,
): AsyncGenerator<ChatFrame, void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  if (!res.body) throw new Error("The chat response had no body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as ChatFrame;
        newline = buffer.indexOf("\n");
      }
    }
    const tail = buffer.trim();
    if (tail) yield JSON.parse(tail) as ChatFrame;
  } finally {
    reader.releaseLock();
  }
}
