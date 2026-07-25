import { SuperDocEditor, type SuperDocRef } from "@superdoc-dev/react";
import "@superdoc-dev/react/style.css";
import { AlertTriangle, Download, FileWarning, Inbox, Loader2, Quote, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AgentStatus } from "@/components/AgentStatus";
import { DOCX_MIME, formatDateTime, ProposalRecord, relativeTime } from "@/lib/proposals";
import { useProposalStore } from "@/store/proposal-store";

/**
 * Railcode serves file bytes with `Content-Disposition: attachment`, and the
 * editor wants a File/Blob anyway — so fetch the .docx ourselves and hand it a
 * real File (which also gives it a sensible document name).
 */
function useDocxFile(fileName: string | undefined) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setFile(null);
    setError(null);
    if (!fileName) return;

    let cancelled = false;
    setLoading(true);

    fetch(files.url(fileName))
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load the document (status ${res.status}).`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const base = fileName.split("/").pop() || "proposal.docx";
        setFile(new File([blob], base, { type: DOCX_MIME }));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fileName]);

  return { file, error, loading };
}

function Provenance({ record }: { record: ProposalRecord }) {
  return (
    <div className="provenance">
      <div className="prov-row">
        <span className="k">From meeting</span>
        <span className="v">
          {record.meetingTitle || "—"}
          {record.meetingDate ? (
            <span className="faint"> · {formatDateTime(record.meetingDate)}</span>
          ) : null}
        </span>
      </div>
      <div className="prov-row">
        <span className="k">Drafted</span>
        <span className="v">
          {formatDateTime(record.createdAt)}
          {record.edited ? <span className="badge t-green">edited</span> : null}
        </span>
      </div>
      {record.summary ? <p className="prov-summary">{record.summary}</p> : null}
    </div>
  );
}

/**
 * Nobody asked for this proposal — the agent decided a meeting warranted one.
 * Showing what it keyed off is how a reader trusts it, or spots that it read
 * the room wrong.
 */
function Signals({ signals }: { signals: string[] }) {
  return (
    <div className="sect">
      <div className="sh">
        <h2>Why this was drafted</h2>
      </div>
      <ul className="signals">
        {signals.map((s) => (
          <li key={s}>
            <Quote size={12} />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Proposal() {
  const { proposals, selectedId, saveEditedDocx, saving, scout } = useProposalStore();

  const editorRef = useRef<SuperDocRef>(null);
  const selected = proposals.find((p) => p.id === selectedId) ?? proposals[0] ?? null;
  const { file, error, loading } = useDocxFile(selected?.fileName);

  async function handleSave() {
    const instance = editorRef.current?.getInstance();
    if (!instance || !selected) return;
    const blob = await instance.export({ triggerDownload: false, isFinalDoc: true });
    await saveEditedDocx(selected.id, blob as Blob);
  }

  if (!selected) {
    return (
      <>
        <div className="phead">
          <div>
            <h1>Proposals</h1>
            <p>
              The agent reads your Granola meetings every 30 minutes and drafts one when a call
              clearly ended with &ldquo;send us a proposal&rdquo;.
            </p>
          </div>
        </div>
        <AgentStatus scout={scout} />
        <div className="empty" style={{ padding: "56px 20px" }}>
          <Inbox />
          <div className="et">No proposals yet</div>
          <div className="es">
            Nothing to do — this page fills itself in. Drafts appear here after a client call
            that asks for one.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="phead">
        <div>
          <h1>{selected.title || "Proposal"}</h1>
          <p>
            {selected.client
              ? `For ${selected.client} · drafted ${relativeTime(selected.createdAt)}`
              : "Edit in place — changes save back to the same document."}
          </p>
        </div>
        <div className="phead-actions">
          <a
            className="btn ghost sm"
            href={files.url(selected.fileName)}
            target="_blank"
            rel="noreferrer"
          >
            <Download size={14} />
            Download
          </a>
          <button className="btn sm" disabled={saving || !file} onClick={() => void handleSave()}>
            {saving ? <Loader2 size={14} className="icon-spin" /> : <Save size={14} />}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <AgentStatus scout={scout} />

      <div className="doc-grid">
        <div>
          {selected.placeholders?.length ? (
            <div className="callout t-amber">
              <AlertTriangle size={15} />
              <div>
                <b>
                  {selected.placeholders.length} thing
                  {selected.placeholders.length === 1 ? "" : "s"} to fill in before sending
                </b>
                <ul>
                  {selected.placeholders.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <div className="doc-panel">
            {loading ? (
              <div className="empty" style={{ padding: "64px 20px" }}>
                <span className="spin" />
                <div className="es">Loading document…</div>
              </div>
            ) : error ? (
              <div className="empty" style={{ padding: "64px 20px" }}>
                <FileWarning />
                <div className="et">Couldn&apos;t load the document</div>
                <div className="es">{error}</div>
              </div>
            ) : file ? (
              <SuperDocEditor
                // Remount on document switch so the editor never shows stale content.
                key={selected.id}
                ref={editorRef}
                document={file}
                documentMode="editing"
              />
            ) : null}
          </div>
        </div>

        <div className="side-col">
          <Provenance record={selected} />
          {selected.signals?.length ? <Signals signals={selected.signals} /> : null}
          {selected.sections?.length ? (
            <div className="sect">
              <div className="sh">
                <h2>Sections</h2>
                <span className="hint">{selected.sections.length}</span>
              </div>
              <ol className="sections">
                {selected.sections.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
