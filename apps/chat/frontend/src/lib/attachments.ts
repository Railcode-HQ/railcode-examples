import { api } from "./api";
import type { Attachment } from "@shared/types";

/** Attachment handling, browser side.
 *
 *  v1 wrote straight into `files.user`, a private per-caller scope the server
 *  enforced. v2 has one shared file store, so the isolation moved into the
 *  worker: the browser posts bytes and gets back an opaque id, and the worker
 *  derives the storage name from the verified caller. A browser that could name
 *  the storage key could read anyone's uploads. */

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
  const contentType = file.type || "application/octet-stream";

  // The excerpt is read here rather than in the worker because the file is
  // already in the browser's hands — and the LLM gateway is text-only, so this
  // is the only way a model ever sees an attachment's contents.
  let excerpt: string | null = null;
  if (kind === "text") {
    const text = await file.text();
    excerpt =
      text.length > EXCERPT_CHARS
        ? `${text.slice(0, EXCERPT_CHARS)}\n… (truncated, ${text.length - EXCERPT_CHARS} more characters)`
        : text;
  }

  const { id } = await api.uploadAttachment(file);
  return { id, name: file.name, size: file.size, contentType, kind, excerpt };
}

/** Best-effort — an orphaned blob is much less bad than a failed send. */
export async function deleteAttachment(attachment: Attachment): Promise<void> {
  await api.deleteAttachment(attachment.id).catch(() => undefined);
}

/** Batched URL resolution for a whole message.
 *
 *  One worker call per message rather than one per thumbnail: behind it the
 *  worker uses `files.urls()`, which resolves the batch in a single subrequest.
 *  A loop of `files.url()` is exactly what exhausts an invocation's budget. */
export async function resolveUrls(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 100) {
    Object.assign(out, await api.attachmentUrls(ids.slice(i, i + 100)));
  }
  return out;
}
