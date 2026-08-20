/** Ids the browser is allowed to choose.
 *
 *  Only the conversation id, and only because the worker stores conversations
 *  under `${callerId}:${convId}` — so a client-chosen convId can never reach
 *  another member's row, whatever it contains. Message ids and attachment
 *  storage names are minted by the worker, because those DO decide where bytes
 *  land. The rule is: the caller may pick a name inside their own space, never
 *  the space. */
export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
