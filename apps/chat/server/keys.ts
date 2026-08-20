// Where this app's per-user isolation actually lives.
//
// The v1 chat stored everything in `db.user` — a server-enforced private
// namespace per caller. A v2 app has ONE flat store and it is shared by the
// whole org, so that guarantee has to be rebuilt here, in code.
//
// Two halves, and BOTH are needed:
//
//   1. Every key is prefixed with the owner's id, so a prefix query returns one
//      person's records. That is an INDEX, not a fence — the prefix is a
//      convention and the store will happily hand back any key that is asked
//      for by name.
//   2. Every record also carries `owner`, and every read that fetches by key
//      checks it against ctx.user. That check is the fence.
//
// Skipping (2) is the classic v1→v2 porting bug: it looks isolated, it reads
// correctly in testing, and any member who can guess another member's id can
// read their entire chat history.

import type { RailcodeUser } from "@railcode/sdk";

/** Anything this app stores for one person. */
export interface Owned {
  owner: string;
}

export const conversationKey = (userId: string, convId: string) => `${userId}:${convId}`;

/** Message keys are `${userId}:${convId}:${zero-padded seq}:${id}`.
 *
 *  The padding is load-bearing: KV orders keys lexicographically, so a plain
 *  number would sort 10 before 9. With it, a prefix query on
 *  `${userId}:${convId}:` returns one conversation already in send order and
 *  nothing has to be sorted afterwards. This is the one decision here that is
 *  expensive to change once data exists. */
export const messageKey = (userId: string, convId: string, seq: number, id: string) =>
  `${userId}:${convId}:${String(seq).padStart(6, "0")}:${id}`;

export const messagePrefix = (userId: string, convId: string) => `${userId}:${convId}:`;

export const conversationPrefix = (userId: string) => `${userId}:`;

export const prefsKey = (userId: string) => userId;

/** An attachment's storage name. Built from the verified caller, never from the
 *  request — a browser that could name the key could read anyone's uploads.
 *  (`users/` and `roles/` are reserved top-level names, hence `attachments/`.) */
export const attachmentName = (userId: string, attachmentId: string) =>
  `attachments/${userId}/${attachmentId}`;

/** The fence. Returns the record only when it really belongs to the caller.
 *
 *  Null for "absent" AND for "someone else's" on purpose: answering 404 rather
 *  than 403 keeps the app from confirming that another member's conversation
 *  exists. */
export function ownedBy<T extends Owned>(record: T | null, user: RailcodeUser): T | null {
  if (!record) return null;
  return record.owner === user.id ? record : null;
}
