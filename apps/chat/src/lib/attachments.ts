import { newId } from "./ids";
import type { Attachment } from "./types";

/** Attachments live in the caller's private `files.user` scope, so one user's
 *  uploads are never reachable from another's session — the server enforces the
 *  scope, the app does no key-prefixing of its own. */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** How much of a text file to inline into the prompt. Enough for a CSV export or
 *  a config file; past this the model is better served by a summary anyway. */
const EXCERPT_CHARS = 20_000;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml",
  "xml", "html", "css", "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java",
  "kt", "swift", "c", "h", "cpp", "sh", "sql", "log", "ini", "env", "conf",
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function kindOf(file: File): Attachment["kind"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("text/")) return "text";
  if (file.type === "application/json" || file.type === "application/xml") return "text";
  if (TEXT_EXTENSIONS.has(extensionOf(file.name))) return "text";
  return "other";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class AttachmentTooLarge extends Error {}

export async function uploadAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_BYTES) {
    throw new AttachmentTooLarge(
      `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}.`,
    );
  }

  const kind = kindOf(file);
  // A generated id is the storage name so two files called "export.csv" never
  // collide; the display name is carried in KV alongside the message.
  const id = `attachments/${newId("att")}`;
  const contentType = file.type || "application/octet-stream";

  let excerpt: string | null = null;
  if (kind === "text") {
    const text = await file.text();
    excerpt =
      text.length > EXCERPT_CHARS
        ? `${text.slice(0, EXCERPT_CHARS)}\n… (truncated, ${text.length - EXCERPT_CHARS} more characters)`
        : text;
  }

  await files.user.upload(id, file, contentType);

  return { id, name: file.name, size: file.size, contentType, kind, excerpt };
}

/** Best-effort — an orphaned blob is much less bad than a failed send. */
export async function deleteAttachment(attachment: Attachment): Promise<void> {
  await files.user.delete(attachment.id).catch(() => undefined);
}

/** Batched URL resolution for a whole transcript. `files.urls()` resolves up to
 *  100 names in a single authenticated request and caches them until they near
 *  expiry, which matters for a message list full of image thumbnails. */
export async function resolveUrls(names: string[]): Promise<Record<string, string>> {
  if (names.length === 0) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < names.length; i += 100) {
    const batch = await files.user.urls(names.slice(i, i + 100));
    for (const item of batch.items) out[item.name] = item.url;
  }
  return out;
}
