import { FileText, Paperclip, Upload, X } from "lucide-react";
import { DragEvent, useRef, useState } from "react";

import { formatBytes, formatDateTime, MAX_MATERIAL_BYTES } from "@/lib/proposals";
import { useProposalStore } from "@/store/proposal-store";

export function Materials() {
  const { materials, uploading, addFiles, removeMaterial } = useProposalStore();
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
            Your company&apos;s reference material — past proposals, pitch decks, rate cards,
            case studies, service descriptions. Every proposal is written from these plus the
            meeting it came from, so what you put here is what the agent can say.
          </p>
        </div>
      </div>

      {isFirstRun ? (
        <div className="sect" style={{ marginBottom: 18 }}>
          <div className="empty" style={{ padding: "28px 20px 8px" }}>
            <Paperclip />
            <div className="et">Start with a few proposals you&apos;re proud of</div>
            <div className="es">
              Past proposals teach it your structure and tone; a rate card keeps pricing real.
              Anything missing here becomes a bracketed placeholder in the draft rather than an
              invented number.
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
        <div className="dz-title">
          {uploading ? "Uploading…" : "Drop files here, or click to browse"}
        </div>
        <div className="dz-sub">
          PDF, DOCX, slides, text · up to {formatBytes(MAX_MATERIAL_BYTES)} each
        </div>
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
          <h2>Company materials</h2>
          <span className="hint">
            {materials.length} file{materials.length === 1 ? "" : "s"}
          </span>
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
            <div className="es">
              Nothing can be drafted until at least one file is here.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
