import { SuperDocEditor, type SuperDocRef } from "@superdoc-dev/react";
import "@superdoc-dev/react/style.css";
import { AlertTriangle, Download, FileWarning, Loader2, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatDateTime, ProposalRecord, relativeTime } from "@/lib/proposals";
import { DOCX_MIME, useProposalStore } from "@/store/proposal-store";

/**
 * Railcode serves file bytes with `Content-Disposition: attachment`, and SuperDoc
 * wants a File/Blob anyway — so fetch the .docx ourselves and hand the editor a
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
          <span className={`badge ${record.source === "cron" ? "t-violet" : "t-accent"}`}>
            {record.source === "cron" ? "auto" : "manual"}
          </span>
          {record.edited ? <span className="badge t-green">edited</span> : null}
        </span>
      </div>
      {record.materialsUsed?.length ? (
        <div className="prov-row">
          <span className="k">Materials used</span>
          <span className="v">{record.materialsUsed.join(", ")}</span>
        </div>
      ) : null}
      {record.summary ? <p className="prov-summary">{record.summary}</p> : null}
    </div>
  );
}

export function Proposal() {
  const { proposals, selectedProposalId, selectProposal, saveEditedDocx, saving } =
    useProposalStore();

  const editorRef = useRef<SuperDocRef>(null);
  const selected = proposals.find((p) => p.id === selectedProposalId) ?? proposals[0] ?? null;
  const { file, error, loading } = useDocxFile(selected?.fileName);

  async function handleSave() {
    const instance = editorRef.current?.getInstance();
    if (!instance || !selected) return;
    const blob = await instance.export({ triggerDownload: false, isFinalDoc: true });
    await saveEditedDocx(selected.id, blob as Blob);
  }

  if (!proposals.length) {
    return (
      <>
        <div className="phead">
          <div>
            <h1>Proposals</h1>
            <p>Drafts land here — from the cron, or when you draft one from a meeting.</p>
          </div>
        </div>
        <div className="empty" style={{ padding: "64px 20px" }}>
          <FileWarning />
          <div className="et">No proposals yet</div>
          <div className="es">
            Head to Meetings, pick a client call, and draft the first one.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="phead">
        <div>
          <h1>{selected?.title || "Proposal"}</h1>
          <p>{selected?.client ? `For ${selected.client}` : "Edit in place — changes save back to the same document."}</p>
        </div>
        <div className="phead-actions">
          <a
            className="btn ghost sm"
            href={selected ? files.url(selected.fileName) : "#"}
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

      <div className="doc-grid">
        <div>
          {selected?.placeholders?.length ? (
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
            ) : file && selected ? (
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
          {selected ? <Provenance record={selected} /> : null}

          <div className="sect">
            <div className="sh">
              <h2>All proposals</h2>
              <span className="hint">{proposals.length}</span>
            </div>
            <div className="version-list">
              {proposals.map((p) => (
                <div
                  key={p.id}
                  className={`crow click${p.id === selected?.id ? " selected" : ""}`}
                  onClick={() => selectProposal(p.id)}
                >
                  <div className="body">
                    <div className="cname">{p.title || p.client}</div>
                    <div className="meta">
                      {relativeTime(p.createdAt)}
                      {p.source === "cron" ? " · auto" : ""}
                      {p.edited ? " · edited" : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
