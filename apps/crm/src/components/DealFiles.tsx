import {
  AlertCircle,
  Download,
  FileText,
  Loader2,
  Presentation,
  Trash2,
  Workflow,
} from "lucide-react";
import { useState } from "react";

import { FileDrop, FileRow } from "@/components/FileDrop";
import { RunAutomationModal } from "@/components/RunAutomationModal";
import {
  ArtifactRecord,
  FORMAT_LABEL,
  FileRef,
  displayName,
  effectiveStatus,
} from "@/lib/automations";
import { timeAgo } from "@/lib/crm";
import {
  dealInputFiles,
  fileUrl,
  runForDeal,
  useAutomationStore,
} from "@/store/automation-store";

/** A deal file is a deal file — the flag is how it got here, not what it is. */
type DealFileEntry =
  | { at: string; kind: "generated"; artifact: ArtifactRecord }
  | { at: string; kind: "uploaded"; file: FileRef };

/**
 * Every file on the deal, one list: what the automation generated and what people
 * uploaded, flagged apart but not separated.
 *
 * They still live under different storage prefixes — that split is for the agent,
 * which has to be able to tell its own past output from source material, or a
 * hallucination from one run becomes an input to the next. It is not for people.
 */
export function DealFiles({ dealId }: { dealId: string }) {
  const { files, artifacts, runs, uploading, uploadDealInputs, removeFile } =
    useAutomationStore();
  const [runOpen, setRunOpen] = useState(false);

  const entries: DealFileEntry[] = [
    ...artifacts
      .filter((a) => a.dealId === dealId)
      .map((a): DealFileEntry => ({ at: a.createdAt, kind: "generated", artifact: a })),
    ...dealInputFiles(files, dealId).map(
      (f): DealFileEntry => ({ at: f.updatedAt ?? "", kind: "uploaded", file: f }),
    ),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const run = runForDeal(runs, dealId);
  const status = run ? effectiveStatus(run) : null;

  return (
    <div className="blk">
      <h4>
        Files
        <span style={{ float: "right", fontWeight: 500 }}>
          <button className="link" onClick={() => setRunOpen(true)}>
            + Generate
          </button>
        </span>
      </h4>

      {status === "running" ? (
        <div className="runbar">
          <Loader2 className="spinicon" size={14} />
          <span>
            Writing a {run?.format === "pptx" ? "deck" : "document"}…
            {run?.startedBy ? ` Started by ${run.startedBy}.` : ""} This keeps going
            if you navigate away.
          </span>
        </div>
      ) : null}

      {status === "failed" ? (
        <div className="warnbar">
          <AlertCircle size={14} />
          <span>{run?.error ?? "The last run didn't finish."}</span>
        </div>
      ) : null}

      {entries.length ? (
        <div className="dealfilelist">
          {entries.map((e) =>
            e.kind === "generated" ? (
              <ArtifactRow
                key={e.artifact.id}
                artifact={e.artifact}
                onRemove={() => void removeFile(e.artifact.fileName)}
              />
            ) : (
              <FileRow
                key={e.file.fileName}
                file={e.file}
                tag="Uploaded"
                href={fileUrl(e.file.fileName)}
                onRemove={() => void removeFile(e.file.fileName)}
              />
            ),
          )}
        </div>
      ) : status === "running" ? null : (
        <p className="faint" style={{ fontSize: 12.5 }}>
          No files yet. Upload what the client sent, or generate a document from the
          deal's meetings.
        </p>
      )}

      <div style={{ marginTop: 12 }}>
        <FileDrop
          busy={uploading}
          label="Drop files for this deal, or"
          onFiles={(list) => void uploadDealInputs(dealId, list)}
        />
      </div>

      {runOpen ? (
        <RunAutomationModal dealId={dealId} onClose={() => setRunOpen(false)} />
      ) : null}
    </div>
  );
}

function ArtifactRow({
  artifact,
  onRemove,
}: {
  artifact: ArtifactRecord;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="crow artrow">
      <span className="glyph dl" style={{ width: 30, height: 30 }}>
        {artifact.format === "pptx" ? (
          <Presentation size={15} />
        ) : (
          <FileText size={15} />
        )}
      </span>

      <div className="body">
        <div className="cname" style={{ fontSize: 13 }}>
          <a className="link" href={fileUrl(artifact.fileName)} download>
            {artifact.title || displayName(artifact.fileName)}
          </a>
        </div>
        <div className="meta">
          <span className="badge">Generated</span> {FORMAT_LABEL[artifact.format]} ·{" "}
          {timeAgo(artifact.createdAt)}
          {artifact.placeholders.length ? (
            <>
              {" · "}
              <button className="link" onClick={() => setOpen(!open)}>
                {artifact.placeholders.length} to fill in
              </button>
            </>
          ) : null}
        </div>
        {artifact.summary ? <div className="meta artsum">{artifact.summary}</div> : null}

        {open && artifact.placeholders.length ? (
          <ul className="phlist">
            {artifact.placeholders.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <a
        className="iconbtn sm"
        href={fileUrl(artifact.fileName)}
        download
        title="Download"
        aria-label={`Download ${artifact.title || displayName(artifact.fileName)}`}
      >
        <Download size={14} />
      </a>
      <button
        className="iconbtn sm"
        title="Delete"
        aria-label={`Delete ${artifact.title || displayName(artifact.fileName)}`}
        onClick={onRemove}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/** The deal header's quick trigger, so generating doesn't require scrolling. */
export function GenerateButton({ dealId }: { dealId: string }) {
  const { runs } = useAutomationStore();
  const [open, setOpen] = useState(false);
  const run = runForDeal(runs, dealId);
  const busy = Boolean(run && effectiveStatus(run) === "running");

  return (
    <>
      <button className="btn ghost sm" onClick={() => setOpen(true)} disabled={busy}>
        {busy ? <Loader2 className="spinicon" size={14} /> : <Workflow size={14} />}
        {busy ? "Generating…" : "Generate"}
      </button>
      {open ? <RunAutomationModal dealId={dealId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
