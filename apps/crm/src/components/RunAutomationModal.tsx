import { FileText, Presentation, Workflow } from "lucide-react";
import { useState } from "react";

import { FileDrop, FileRow } from "@/components/FileDrop";
import { Modal } from "@/components/Modal";
import {
  AUTOMATION_ID,
  ArtifactFormat,
  FORMAT_LABEL,
  hasStyle,
  templateFor,
} from "@/lib/automations";
import {
  automationRecord,
  dealInputFiles,
  meetingsForDeal,
  templateFiles,
  useAutomationStore,
} from "@/store/automation-store";
import { useCrmStore } from "@/store/crm-store";

const FORMATS: ArtifactFormat[] = ["docx", "pptx"];

/**
 * Triggers the artifact automation for one deal.
 *
 * Closing this dialog doesn't stop anything: the run is queued server-side and the
 * agent writes its own results back, so the document lands whether or not this tab
 * is still open when it finishes.
 */
export function RunAutomationModal({
  dealId,
  onClose,
}: {
  dealId: string;
  onClose: () => void;
}) {
  const {
    settings,
    records,
    files,
    uploading,
    artifacts,
    runArtifact,
    uploadDealInputs,
    removeFile,
  } = useAutomationStore();
  const { deals } = useCrmStore();

  const automation = automationRecord(records, AUTOMATION_ID);
  const deal = deals.find((d) => d.id === dealId);
  const [format, setFormat] = useState<ArtifactFormat>(automation.defaultFormat);
  const [context, setContext] = useState("");
  const [starting, setStarting] = useState(false);

  if (!deal) return null;

  const inputs = dealInputFiles(files, dealId);
  const meetings = meetingsForDeal(dealId);
  const priorCount = artifacts.filter((a) => a.dealId === dealId).length;
  const template = templateFor(templateFiles(files), format);

  async function run() {
    setStarting(true);
    try {
      await runArtifact({ dealId, format, extraContext: context });
      onClose();
    } finally {
      setStarting(false);
    }
  }

  return (
    <Modal
      title="Generate a proposal"
      subtitle={deal.title}
      icon={<Workflow size={16} />}
      width={620}
      onClose={onClose}
      footer={
        <>
          <span className="faint" style={{ fontSize: 11.5 }}>
            Takes a couple of minutes. Keeps going if you close this.
          </span>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose} disabled={starting}>
            Cancel
          </button>
          <button className="btn" onClick={() => void run()} disabled={starting}>
            {starting ? "Starting…" : "Generate"}
          </button>
        </>
      }
    >
      {!automation.enabled ? (
        <div className="warnbar">
          <span>
            This automation is switched off on the Automations page. Running it here
            still works, but nothing will run on its own.
          </span>
        </div>
      ) : null}

      <div className="field">
        <span className="l">Format</span>
        <div className="fmtpick">
          {FORMATS.map((f) => (
            <button
              key={f}
              className={`fmtopt${format === f ? " on" : ""}`}
              onClick={() => setFormat(f)}
            >
              {f === "pptx" ? <Presentation size={15} /> : <FileText size={15} />}
              <span>{FORMAT_LABEL[f]}</span>
              <em>.{f}</em>
            </button>
          ))}
        </div>
      </div>

      <div className="runsources">
        <Source
          ok={meetings.length > 0}
          label={
            meetings.length
              ? `${meetings.length} meeting${meetings.length === 1 ? "" : "s"}`
              : "No meetings on this deal"
          }
          hint={
            meetings.length
              ? meetings[0].title
              : "Without a meeting there's little to write from — expect a thin draft."
          }
        />
        <Source
          ok={Boolean(template)}
          label={template ? `Template: ${template.name}` : `No .${format} template`}
          hint={
            template
              ? hasStyle(settings.style[format])
                ? "Measured — its fonts and layout will be applied."
                : "Not measured yet. Measure it on the Automations page for a closer match."
              : "Output will be clean but won't match your brand."
          }
        />
        <Source
          ok={settings.companyContext.trim().length > 0}
          label={settings.companyContext.trim() ? "Company context set" : "No company context"}
          hint={
            settings.companyContext.trim()
              ? undefined
              : "Add it on the Automations page so pricing and tone come from you."
          }
        />
      </div>

      <div className="field">
        <span className="l">Anything specific for this one?</span>
        <textarea
          className="textarea"
          style={{ minHeight: 76 }}
          value={context}
          placeholder="e.g. focus on the migration timeline they were worried about, and leave pricing out — legal hasn't signed off."
          onChange={(e) => setContext(e.target.value)}
        />
      </div>

      <div className="field">
        <span className="l">
          Uploaded files on this deal
          {inputs.length ? ` (${inputs.length})` : ""}
        </span>
        <span className="faint" style={{ fontSize: 11.5, marginBottom: 6 }}>
          Their RFP, a questionnaire, notes you took elsewhere. Read alongside the
          company-wide reference files.
        </span>
        <FileDrop
          busy={uploading}
          label="Drop files for this deal, or"
          onFiles={(list) => void uploadDealInputs(dealId, list)}
        />
        {inputs.length ? (
          <div className="filelist">
            {inputs.map((f) => (
              <FileRow
                key={f.fileName}
                file={f}
                onRemove={() => void removeFile(f.fileName)}
              />
            ))}
          </div>
        ) : null}
      </div>

      {priorCount ? (
        <p className="faint" style={{ fontSize: 11.5 }}>
          This deal already has {priorCount} document{priorCount === 1 ? "" : "s"}. The
          agent reads them for house structure and builds on the most recent.
        </p>
      ) : null}
    </Modal>
  );
}

function Source({
  ok,
  label,
  hint,
}: {
  ok: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <div className={`runsource${ok ? " on" : ""}`}>
      <span className={`led ${ok ? "green" : "amber"}`} />
      <div>
        <div className="rslabel">{label}</div>
        {hint ? <div className="faint rshint">{hint}</div> : null}
      </div>
    </div>
  );
}
