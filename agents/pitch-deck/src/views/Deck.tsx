import { Download, FileWarning, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { formatDateTime, VersionRecord } from "@/lib/materials";
import { useDeckStore } from "@/store/deck-store";

function ElapsedTicker({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return (
    <span className="tick tab">
      {mm}:{String(ss).padStart(2, "0")}
    </span>
  );
}

function versionNumbers(versions: VersionRecord[]): Map<string, number> {
  const ascending = [...versions].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const map = new Map<string, number>();
  ascending.forEach((v, i) => map.set(v.id, i + 1));
  return map;
}

// Railcode serves file bytes with `Content-Disposition: attachment`, so pointing
// an <iframe> straight at files.url() just triggers a download. Fetching it
// ourselves and handing the iframe a blob: URL renders it inline instead.
function usePdfObjectUrl(fileName: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!fileName) return;

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);

    fetch(files.url(fileName))
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load the PDF (status ${res.status}).`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileName]);

  return { url, error, loading };
}

export function Deck() {
  const {
    materials,
    versions,
    selectedVersionId,
    context,
    generating,
    generateStartedAt,
    setContext,
    generate,
    selectVersion,
  } = useDeckStore();

  const selected = versions.find((v) => v.id === selectedVersionId) ?? versions[0] ?? null;
  const noMaterials = materials.length === 0;
  const numbers = useMemo(() => versionNumbers(versions), [versions]);
  const { url: pdfUrl, error: pdfError, loading: pdfLoading } = usePdfObjectUrl(selected?.fileName);

  return (
    <>
      <div className="phead">
        <div>
          <h1>Deck</h1>
          <p>Generate a new version of the pitch deck, or revisit a past one below.</p>
        </div>
      </div>

      <div className="studio-grid">
        <div>
          <div className="sect">
            <div className="sh">
              <h2>Generate a new version</h2>
              <span className="hint">
                {materials.length} material{materials.length === 1 ? "" : "s"} in scope
              </span>
            </div>
            <div style={{ padding: 18 }}>
              <div className="field">
                <span className="l">Additional context for this version (optional)</span>
                <textarea
                  className="textarea"
                  placeholder="e.g. Focus on the Series A ask, lead with the Q2 traction numbers, keep it to 10 slides…"
                  value={context}
                  disabled={generating}
                  onChange={(e) => setContext(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <button className="btn" disabled={generating || noMaterials} onClick={() => void generate()}>
                  {generating ? <Loader2 size={15} className="icon-spin" /> : <Sparkles size={15} />}
                  {generating ? "Generating…" : "Generate deck"}
                </button>
                {noMaterials ? (
                  <span className="faint">Upload at least one material first.</span>
                ) : null}
              </div>

              {generating ? (
                <div className="run-status">
                  <span className="spin" />
                  <span>Writing and designing the deck — this can take a couple of minutes.</span>
                  {generateStartedAt ? <ElapsedTicker since={generateStartedAt} /> : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="pdf-panel" style={{ marginTop: 18 }}>
            <div className="pdf-head">
              <div className="ttl">
                <div className="nm">{selected ? `Version ${numbers.get(selected.id)}` : "No deck yet"}</div>
                <div className="sub">
                  {selected ? formatDateTime(selected.createdAt) : "Generate the first version to see it here"}
                </div>
              </div>
              {selected ? (
                <a
                  className="btn ghost sm"
                  href={files.url(selected.fileName)}
                  target="_blank"
                  rel="noreferrer"
                  title={selected.fileName}
                >
                  <Download size={14} />
                  Download
                </a>
              ) : null}
            </div>
            {selected ? (
              pdfLoading ? (
                <div className="empty" style={{ padding: "48px 20px" }}>
                  <span className="spin" />
                  <div className="es">Loading PDF…</div>
                </div>
              ) : pdfError ? (
                <div className="empty" style={{ padding: "48px 20px" }}>
                  <FileWarning />
                  <div className="et">Couldn&apos;t load the PDF</div>
                  <div className="es">{pdfError}</div>
                </div>
              ) : pdfUrl ? (
                <iframe className="pdf-frame" title={`Version ${numbers.get(selected.id)}`} src={pdfUrl} />
              ) : null
            ) : (
              <div className="empty" style={{ padding: "48px 20px" }}>
                <FileWarning />
                <div className="et">Nothing generated yet</div>
                <div className="es">Once you generate a version, it renders right here.</div>
              </div>
            )}
          </div>
        </div>

        <div className="sect">
          <div className="sh">
            <h2>History</h2>
            <span className="hint">{versions.length}</span>
          </div>
          {versions.length ? (
            <div className="version-list">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className={`crow click${v.id === selected?.id ? " selected" : ""}`}
                  onClick={() => selectVersion(v.id)}
                >
                  <div className="body">
                    <div className="cname">Version {numbers.get(v.id)}</div>
                    <div className="meta">{formatDateTime(v.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <div className="es">Past versions will show up here once you generate one.</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
