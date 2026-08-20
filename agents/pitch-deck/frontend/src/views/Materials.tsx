import { FileText, Paperclip, Upload, X } from "lucide-react";
import { DragEvent, useRef, useState } from "react";

import { formatBytes, formatDateTime, MAX_MATERIAL_BYTES } from "@/lib/materials";
import { useDeckStore } from "@/store/deck-store";

export function Materials() {
  const { materials, uploading, addFiles, removeMaterial } = useDeckStore();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const isFirstRun = materials.length === 0;

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
  }

  return (
    <>
      <div className="phead">
        <div>
          <h1>Materials</h1>
          <p>
            Upload the source material your pitch deck should draw from — notes, memos,
            transcripts, existing decks, financials. The deck-writing agent reads everything
            here plus whatever context you add per run.
          </p>
        </div>
      </div>

      {isFirstRun ? (
        <div className="sect" style={{ marginBottom: 18 }}>
          <div className="empty" style={{ padding: "28px 20px 8px" }}>
            <Paperclip />
            <div className="et">Let&apos;s start with your materials</div>
            <div className="es">
              Add a few files to get going — a one-pager, founder notes, a data room export,
              anything relevant. You can add or remove materials any time.
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`dropzone${dragging ? " drag" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {uploading ? <span className="spin" /> : <Upload />}
        <div className="dz-title">{uploading ? "Uploading…" : "Drop files here, or click to browse"}</div>
        <div className="dz-sub">Any file type · up to {formatBytes(MAX_MATERIAL_BYTES)} each</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="file-input-hidden"
        onChange={(e) => {
          if (e.target.files?.length) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="sect" style={{ marginTop: 18 }}>
        <div className="sh">
          <h2>Uploaded materials</h2>
          <span className="hint">{materials.length} file{materials.length === 1 ? "" : "s"}</span>
        </div>
        {materials.length ? (
          <div className="rows">
            {materials.map((m) => (
              <div className="crow" key={m.fileName}>
                <span className="glyph">
                  <FileText />
                </span>
                <div className="body">
                  <div className="cname">{m.name}</div>
                  <div className="meta">
                    {formatBytes(m.size)} · {m.contentType} · added {formatDateTime(m.updatedAt)}
                  </div>
                </div>
                <button
                  className="row-delete"
                  aria-label={`Remove ${m.name}`}
                  onClick={() => void removeMaterial(m.fileName)}
                >
                  <X />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <Paperclip />
            <div className="et">No materials yet</div>
            <div className="es">Uploaded files show up here — nothing is generated until you add at least one.</div>
          </div>
        )}
      </div>
    </>
  );
}
