import { Download, FileWarning, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { deckSrc } from "@/lib/api";
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
  // The worker streams the PDF back with `Content-Disposition: inline`, so the
  // iframe points straight at a route. The v1 app had to fetch the bytes and
  // build a blob: URL, because the platform served files as attachments.
  const pdfSrc = selected ? deckSrc(selected.id) : null;

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
                  href={deckSrc(selected.id)}
                  target="_blank"
                  rel="noreferrer"
                  title={selected.fileName}
                >
                  <Download size={14} />
                  Download
                </a>
              ) : null}
            </div>
            {selected && pdfSrc ? (
              <iframe className="pdf-frame" title={`Version ${numbers.get(selected.id)}`} src={pdfSrc} />
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
