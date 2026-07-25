export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** Message keys are `${convId}:${zero-padded seq}:${id}`.
 *
 *  The padding is load-bearing: KV orders keys lexicographically, so a plain
 *  number would sort 10 before 9. With it, `prefix(convId + ":")` returns one
 *  conversation already in send order and we never sort client-side. This is the
 *  one decision here that is expensive to change after data exists. */
export function messageKey(convId: string, seq: number, id: string): string {
  return `${convId}:${String(seq).padStart(6, "0")}:${id}`;
}

export function conversationPrefix(convId: string): string {
  return `${convId}:`;
}
