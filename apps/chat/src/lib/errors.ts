/** Turn a platform error into something a person can act on.
 *
 *  The SDK throws `ApiError(status, body)` where the body is the raw response
 *  text, so an unhandled failure surfaces in the UI as a JSON blob like
 *  `{"detail":{"error":"daily_token_limit_exceeded",…}}`. These are all normal,
 *  expected states for a governed platform — quota reached, provider key wrong,
 *  capability not granted — and each has a different fix, so each gets a
 *  message that names it. */

function statusOf(err: unknown): number | null {
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status?: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

/** Shared by thrown API errors and `llm.stream()`'s error event, which carries
 *  the same codes but arrives as a stream frame rather than an exception. */
function fromCode(code: string | null, detail: string | null): string | null {
  switch (code) {
    case "daily_token_limit_exceeded":
      return "This organization has reached its daily LLM token limit. It resets tomorrow, or an admin can raise the cap in Railcode.";
    case "provider_auth_error":
      return "The LLM provider rejected its API key. An admin needs to update the provider credentials in Railcode.";
    case "provider_bad_request":
      return detail
        ? `The LLM provider rejected the request: ${detail}`
        : "The LLM provider rejected the request. Try a different model.";
    case "provider_rate_limited":
      return "The LLM provider is rate-limiting requests. Wait a moment and try again.";
    default:
      return null;
  }
}

export function describeStreamError(event: { error: string; message: string }): string {
  return fromCode(event.error, event.message) ?? event.message ?? event.error;
}

export function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const status = statusOf(err);

  let code: string | null = null;
  let detailMessage: string | null = null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    const root = (parsed ?? {}) as Record<string, unknown>;
    const detail = (root.detail ?? root) as Record<string, unknown> | string;
    if (typeof detail === "string") {
      detailMessage = detail;
    } else {
      if (typeof detail.error === "string") code = detail.error;
      if (typeof detail.message === "string") detailMessage = detail.message;
    }
  } catch {
    /* not JSON — fall through to the raw text */
  }

  const mapped = fromCode(code, detailMessage);
  if (mapped) return mapped;

  if (status === 403) {
    return "This app isn't authorized for that operation. Its manifest may need to be ratified by an admin.";
  }
  if (status === 429) {
    return "Rate limit reached. Wait a moment and try again.";
  }
  if (status === 503) {
    return "That capability isn't configured for this Railcode instance yet.";
  }

  if (detailMessage) return detailMessage;
  return raw || "Something went wrong.";
}
