import { Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { DragEvent, useRef, useState } from "react";

import { FileRef, MAX_UPLOAD_BYTES, formatBytes } from "@/lib/automations";
import { timeAgo } from "@/lib/crm";

/** Drag-and-drop target that also opens a file picker. */
export function FileDrop({
  busy,
  onFiles,
  label = "Drop files here, or",
  accept,
  compact = false,
}: {
  busy: boolean;
  onFiles: (files: File[]) => void;
  label?: string;
  accept?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function take(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(files);
  }

  return (
    <div
      className={`filedrop${over ? " over" : ""}${busy ? " busy" : ""}${compact ? " compact" : ""}`}
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={(e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
    >
      {busy ? <Loader2 className="spinicon" size={15} /> : <Upload size={15} />}
      <span>
        {busy ? "Uploading…" : label}{" "}
        {busy ? null : (
          <button className="link" onClick={() => inputRef.current?.click()}>
            choose
          </button>
        )}
      </span>
      {compact ? null : (
        <span className="faint filedrop-hint">
          PDF, Word, PowerPoint, Excel, CSV or text · up to {formatBytes(MAX_UPLOAD_BYTES)} each
        </span>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        hidden
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.currentTarget.value = "";
          take(list);
        }}
      />
    </div>
  );
}

/** One stored file: name, size, age, optional download link and remove button.
 *  `tag` flags provenance ("Uploaded") where the row sits in a mixed list. */
export function FileRow({
  file,
  onRemove,
  href,
  tag,
}: {
  file: FileRef;
  onRemove?: () => void;
  href?: string;
  tag?: string;
}) {
  return (
    <div className="filerow">
      <Paperclip size={13} />
      <span className="nm" title={file.name}>
        {href ? (
          <a className="link" href={href} download>
            {file.name}
          </a>
        ) : (
          file.name
        )}
      </span>
      {tag ? <span className="badge">{tag}</span> : null}
      <span className="faint meta">
        {formatBytes(file.size)}
        {file.updatedAt ? ` · ${timeAgo(file.updatedAt)}` : ""}
      </span>
      {onRemove ? (
        <button
          className="iconbtn sm"
          aria-label={`Remove ${file.name}`}
          title="Remove"
          onClick={onRemove}
        >
          <Trash2 size={13} />
        </button>
      ) : null}
    </div>
  );
}
