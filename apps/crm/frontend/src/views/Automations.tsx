import {
  AlertCircle,
  Building2,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  Loader2,
  Presentation,
  Ruler,
  Trash2,
  Upload,
} from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { FileDrop, FileRow } from "@/components/FileDrop";
import { AUTOMATION_CATALOG, AutomationDef } from "@/lib/automation-catalog";
import {
  ArtifactFormat,
  AutomationSettings,
  FORMAT_LABEL,
  FileRef,
  StyleProfile,
  effectiveStatus,
  emptyStyleProfile,
  formatBytes,
  hasStyle,
  nextSetupStep,
  setupStatus,
  templateFor,
} from "@/lib/automations";
import { timeAgo } from "@/lib/crm";
import {
  automationRecord,
  materialFiles,
  templateFiles,
  useAutomationStore,
} from "@/store/automation-store";
import { useCrmStore } from "@/store/crm-store";

const FORMATS: ArtifactFormat[] = ["docx", "pptx"];

/** Setup rows, in the order they're worth doing. */
type SetupRowId = "template" | "context" | "materials";

export function Automations() {
  const {
    settings,
    records,
    files,
    runs,
    loaded,
    uploading,
    extracting,
    saveSettings,
    saveRecord,
    saveStyle,
    uploadFiles,
    removeFile,
    extractStyle,
  } = useAutomationStore();

  const templates = templateFiles(files);
  const materials = materialFiles(files);
  const status = setupStatus(settings, templates, materials);
  const nextStep = nextSetupStep(status);

  // Only one row open at a time — an accordion, not a pile of open drawers.
  const [openRow, setOpenRow] = useState<SetupRowId | null>(null);
  const [openAutomation, setOpenAutomation] = useState<string | null>(null);
  const primed = useRef(false);

  // On a first visit to an unconfigured workspace, open the row that matters most
  // instead of showing three closed drawers and leaving the user to guess.
  useEffect(() => {
    if (primed.current || !loaded) return;
    primed.current = true;
    if (!status.templates && !status.hasContext && !status.materials) {
      setOpenRow("template");
    }
  }, [loaded, status.templates, status.hasContext, status.materials]);

  const toggleRow = (id: SetupRowId) => setOpenRow((cur) => (cur === id ? null : id));

  return (
    <>
      <div className="phead">
        <div>
          <h1>Automations</h1>
          <p>Work the CRM hands to an agent instead of doing it by hand.</p>
        </div>
      </div>

      {nextStep ? (
        <button className="nextstep" onClick={() => setOpenRow(nextStepRow(status))}>
          <span className="nextstep-dot" />
          <span>{nextStep}</span>
          <ChevronRight size={14} />
        </button>
      ) : null}

      <div className="grouplabel">Setup</div>
      <div className="rowgroup">
        <SetupRow
          open={openRow === "template"}
          onToggle={() => toggleRow("template")}
          icon={<Presentation size={14} />}
          title="Brand templates"
          detail="Cloned so output looks like yours, rather than approximated."
          status={
            templates.length ? (
              <FormatChips templates={templates} style={settings.style} />
            ) : (
              <span className="rowstat">Not set</span>
            )
          }
        >
          <div className="slotgrid">
            {FORMATS.map((format) => (
              <TemplateSlot
                key={format}
                format={format}
                file={templateFor(templates, format)}
                profile={settings.style[format]}
                busy={extracting === format}
                onUpload={(list) => void uploadFiles("template", list)}
                onRemove={(name) => void removeFile(name)}
                onMeasure={() => void extractStyle(format)}
                onSaveProfile={(profile) => void saveStyle(format, profile)}
              />
            ))}
          </div>
          {templates.some((t) => !FORMATS.includes(fmtOf(t))) ? (
            <p className="rowhint warn">
              <AlertCircle size={13} />
              Only .docx and .pptx templates are used — anything else here is ignored.
            </p>
          ) : null}
        </SetupRow>

        <SetupRow
          open={openRow === "context"}
          onToggle={() => toggleRow("context")}
          icon={<Building2 size={14} />}
          title="About your company"
          detail="What you sell, how you price it, and what never to say."
          status={
            status.hasContext ? (
              <span className="rowstat ok">
                <Check size={12} />
                Set
              </span>
            ) : (
              <span className="rowstat">Not set</span>
            )
          }
        >
          <CompanyContext
            value={settings.companyContext}
            loaded={loaded}
            onSave={(companyContext) => void saveSettings({ companyContext })}
          />
        </SetupRow>

        <SetupRow
          open={openRow === "materials"}
          onToggle={() => toggleRow("materials")}
          icon={<FolderOpen size={14} />}
          title="Reference files"
          detail="Rate cards, case studies, past winners. Facts come from here."
          status={
            materials.length ? (
              <span className="rowstat ok">
                <Check size={12} />
                {materials.length} file{materials.length === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="rowstat">None</span>
            )
          }
        >
          <p className="rowhint">
            The agent reads these for figures and phrasing. It will not invent a number
            that isn't in here or in a meeting — it leaves a placeholder instead.
          </p>
          <FileDrop busy={uploading} onFiles={(list) => void uploadFiles("material", list)} />
          {materials.length ? (
            <div className="filelist">
              {materials.map((f) => (
                <FileRow
                  key={f.fileName}
                  file={f}
                  onRemove={() => void removeFile(f.fileName)}
                />
              ))}
            </div>
          ) : null}
        </SetupRow>
      </div>

      <div className="grouplabel">
        Automations
        <span className="grouplabel-ct">{AUTOMATION_CATALOG.length}</span>
      </div>
      <div className="rowgroup">
        {AUTOMATION_CATALOG.map((def) => {
          const record = automationRecord(records, def.id);
          return (
            <AutomationRow
              key={def.id}
              def={def}
              open={openAutomation === def.id}
              onToggle={() =>
                setOpenAutomation((cur) => (cur === def.id ? null : def.id))
              }
              enabled={record.enabled}
              onEnabled={(enabled) => void saveRecord(def.id, { enabled })}
              defaultFormat={record.defaultFormat}
              onFormat={(defaultFormat) => void saveRecord(def.id, { defaultFormat })}
              runs={runs.filter((r) => r.automationId === def.id)}
            />
          );
        })}
      </div>
    </>
  );
}

function nextStepRow(status: ReturnType<typeof setupStatus>): SetupRowId {
  if (!status.templates || status.unmeasured.length) return "template";
  if (!status.hasContext) return "context";
  return "materials";
}

function fmtOf(file: FileRef): ArtifactFormat {
  return (file.fileName.split(".").pop() ?? "").toLowerCase() as ArtifactFormat;
}

// --- rows ------------------------------------------------------------------

/** A collapsible settings row: chevron, icon, title, status, expanding body. */
function SetupRow({
  open,
  onToggle,
  icon,
  title,
  detail,
  status,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  title: string;
  detail: string;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`arow${open ? " open" : ""}`}>
      <button className="arow-h" onClick={onToggle} aria-expanded={open}>
        <ChevronRight className="arow-chev" size={14} />
        <span className="arow-icon">{icon}</span>
        <span className="arow-t">
          <span className="arow-name">{title}</span>
          <span className="arow-detail">{detail}</span>
        </span>
        {status}
      </button>
      {open ? <div className="arow-b">{children}</div> : null}
    </div>
  );
}

function AutomationRow({
  def,
  open,
  onToggle,
  enabled,
  onEnabled,
  defaultFormat,
  onFormat,
  runs,
}: {
  def: AutomationDef;
  open: boolean;
  onToggle: () => void;
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  defaultFormat: ArtifactFormat;
  onFormat: (format: ArtifactFormat) => void;
  runs: ReturnType<typeof useAutomationStore.getState>["runs"];
}) {
  const { deals } = useCrmStore();
  const Icon = def.icon;
  const recent = useMemo(
    () =>
      runs
        .slice()
        .sort((a, b) => ((a.startedAt ?? "") < (b.startedAt ?? "") ? 1 : -1))
        .slice(0, 5),
    [runs],
  );

  return (
    <div className={`arow${open ? " open" : ""}${enabled ? "" : " off"}`}>
      <div className="arow-h aslot">
        <button className="arow-hit" onClick={onToggle} aria-expanded={open}>
          <ChevronRight className="arow-chev" size={14} />
          <span className="arow-icon accent">
            <Icon size={14} />
          </span>
          <span className="arow-t">
            <span className="arow-name">{def.name}</span>
            <span className="arow-detail">{def.summary}</span>
          </span>
        </button>
        {/* Outside the toggle hit area — clicking the switch shouldn't also expand. */}
        <Switch
          checked={enabled}
          label={`${enabled ? "Disable" : "Enable"} ${def.name}`}
          onChange={onEnabled}
        />
      </div>

      {open ? (
        <div className="arow-b">
          <dl className="factlist">
            <dt>Trigger</dt>
            <dd>{def.trigger}</dd>
            <dt>Produces</dt>
            <dd>{def.produces}</dd>
            <dt>Reads</dt>
            <dd>
              <ol className="readslist">
                {def.reads.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ol>
            </dd>
            {def.agent ? (
              <>
                <dt>Agent</dt>
                <dd className="mono">{def.agent}</dd>
              </>
            ) : null}
          </dl>

          {def.hasFormat ? (
            <div className="subfield">
              <span className="sublabel">Default format</span>
              <div className="segmented">
                {FORMATS.map((f) => (
                  <button
                    key={f}
                    className={`seg${defaultFormat === f ? " on" : ""}`}
                    onClick={() => onFormat(f)}
                  >
                    {f === "pptx" ? <Presentation size={13} /> : <FileText size={13} />}
                    {FORMAT_LABEL[f]}
                  </button>
                ))}
              </div>
              <span className="rowhint">
                Preselected in the Generate dialog; whoever runs it can still switch.
              </span>
            </div>
          ) : null}

          <div className="subfield">
            <span className="sublabel">
              Recent runs
              {recent.length ? <span className="sublabel-ct">{recent.length}</span> : null}
            </span>
            {recent.length === 0 ? (
              <span className="rowhint">Nothing has run yet.</span>
            ) : (
              <div className="runlist">
                {recent.map((run) => {
                  const state = effectiveStatus(run);
                  return (
                    <div className="runrow" key={run.id}>
                      <span
                        className={`led ${
                          state === "done" ? "green" : state === "failed" ? "red" : "amber"
                        }`}
                      />
                      <span className="nm">
                        {run.dealTitle ??
                          deals.find((d) => d.id === run.dealId)?.title ??
                          "a deleted deal"}
                      </span>
                      <span className="faint meta">
                        {state === "failed" && run.error
                          ? run.error
                          : FORMAT_LABEL[run.format]}
                      </span>
                      <span className="faint when">
                        {run.startedAt ? timeAgo(run.startedAt) : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

// --- setup bodies ----------------------------------------------------------

function CompanyContext({
  value,
  loaded,
  onSave,
}: {
  value: string;
  loaded: boolean;
  onSave: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current || !loaded) return;
    hydrated.current = true;
    setText(value);
  }, [loaded, value]);

  useEffect(() => {
    if (!hydrated.current || text === value) return;
    const t = window.setTimeout(() => {
      onSave(text);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    }, 700);
    return () => window.clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <p className="rowhint">
        Goes into every document. This is also where you correct the agent — a line
        here outranks whatever it inferred from your files.
      </p>
      <textarea
        className="textarea ctxbox"
        value={text}
        placeholder={
          "We sell a managed data platform to mid-market retailers.\n\nPricing: implementation from $25k, platform from $4k/mo. Never quote a discount without sign-off.\n\nWrite plainly and lead with the client's problem. Never claim a certification we don't hold."
        }
        onChange={(e) => setText(e.target.value)}
      />
      <div className="ctxfoot">
        <span className="faint">{text.trim().length} characters</span>
        {saved ? (
          <span className="rowstat ok">
            <Check size={12} />
            Saved
          </span>
        ) : null}
      </div>
    </>
  );
}

function FormatChips({
  templates,
  style,
}: {
  templates: FileRef[];
  style: AutomationSettings["style"];
}) {
  return (
    <span className="chiprow">
      {FORMATS.map((format) => {
        const has = Boolean(templateFor(templates, format));
        const measured = hasStyle(style[format]);
        return (
          <span
            key={format}
            className={`fchip${has ? (measured ? " ok" : " partial") : ""}`}
            title={
              !has
                ? `No .${format} template`
                : measured
                  ? `.${format} template, measured`
                  : `.${format} template, not measured yet`
            }
          >
            .{format}
            {has && !measured ? <em>unmeasured</em> : null}
            {has && measured ? <Check size={11} /> : null}
          </span>
        );
      })}
    </span>
  );
}

function TemplateSlot({
  format,
  file,
  profile,
  busy,
  onUpload,
  onRemove,
  onMeasure,
  onSaveProfile,
}: {
  format: ArtifactFormat;
  file?: FileRef;
  profile?: StyleProfile;
  busy: boolean;
  onUpload: (files: File[]) => void;
  onRemove: (fileName: string) => void;
  onMeasure: () => void;
  onSaveProfile: (profile: StyleProfile) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const measured = hasStyle(profile);
  const [editing, setEditing] = useState(false);

  // A half-finished edit belongs to the file it was opened against.
  useEffect(() => setEditing(false), [file?.fileName]);

  return (
    <div className={`slot${file ? " filled" : ""}`}>
      <div className="slot-h">
        <span className="arow-icon">
          {format === "pptx" ? <Presentation size={14} /> : <FileText size={14} />}
        </span>
        <span className="slot-t">
          <span className="arow-name">{FORMAT_LABEL[format]}</span>
          <span className="arow-detail mono">.{format}</span>
        </span>
        {file ? (
          <button
            className="iconbtn sm"
            aria-label={`Remove ${file.name}`}
            title="Remove"
            onClick={() => onRemove(file.fileName)}
          >
            <Trash2 size={13} />
          </button>
        ) : null}
      </div>

      {file ? (
        <>
          <div className="slot-file">
            <span className="nm" title={file.name}>
              {file.name}
            </span>
            <span className="faint">{formatBytes(file.size)}</span>
          </div>

          <div className="slot-acts">
            <button className="btn ghost sm" onClick={onMeasure} disabled={busy}>
              {busy ? <Loader2 className="spinicon" size={13} /> : <Ruler size={13} />}
              {busy ? "Measuring…" : measured ? "Re-measure" : "Measure now"}
            </button>
            {measured || busy ? null : (
              <span className="faint slot-warn">Not measured yet</span>
            )}
          </div>

          {editing ? (
            <StyleEditor
              initial={profile ?? emptyStyleProfile()}
              templateFileName={file.fileName}
              onCancel={() => setEditing(false)}
              onSave={(next) => {
                onSaveProfile(next);
                setEditing(false);
              }}
            />
          ) : measured && profile ? (
            <StyleSummary profile={profile} onEdit={() => setEditing(true)} />
          ) : busy ? null : (
            // Reaching this with a file present means the automatic pass didn't
            // land, so the button above is a retry rather than a required step.
            <p className="rowhint">
              Measuring runs on its own after an upload. It reads this file's real
              fonts, colours, spacing and section order once, so a run applies them
              instead of guessing. If it keeps failing, you can{" "}
              <button className="link" onClick={() => setEditing(true)}>
                write the profile by hand
              </button>
              .
            </p>
          )}
        </>
      ) : (
        <>
          <button className="btn ghost sm" onClick={() => inputRef.current?.click()}>
            <Upload size={13} />
            Upload .{format}
          </button>
          <p className="rowhint">Without one, output is clean but generic.</p>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={`.${format}`}
        hidden
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.currentTarget.value = "";
          if (list.length) onUpload(list);
        }}
      />
    </div>
  );
}

function StyleSummary({
  profile,
  onEdit,
}: {
  profile: StyleProfile;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="styleprof">
      <div className="styleprof-h">
        {profile.colors.slice(0, 6).map((c) => (
          <span key={c} className="swatch" style={{ background: c }} title={c} />
        ))}
        {profile.fonts.length ? (
          <span className="faint fontlist">{profile.fonts.slice(0, 2).join(", ")}</span>
        ) : null}
        <span className="spacer" />
        <button className="link" onClick={onEdit}>
          Edit
        </button>
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Details"}
        </button>
      </div>

      {open ? (
        <div className="styleprof-b">
          {profile.structure.length ? (
            <div className="styleprof-row">
              <span className="l">Sections</span>
              <span>{profile.structure.join(" → ")}</span>
            </div>
          ) : null}
          {profile.metrics.map((m) => (
            <div className="styleprof-row" key={m.label}>
              <span className="l">{m.label}</span>
              <span className="mono">{m.value}</span>
            </div>
          ))}
          {profile.extractedAt ? (
            <div className="styleprof-row">
              <span className="l">Measured</span>
              <span>{timeAgo(profile.extractedAt)}</span>
            </div>
          ) : null}
          {profile.summary ? <p className="faint">{profile.summary}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// --- hand-editing the profile ----------------------------------------------

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "1f4e79" and "#1f4e79" → "#1F4E79"; anything non-hex is kept as typed. */
function normalizeColor(value: string): string {
  const bare = value.replace(/^#/, "");
  return /^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(bare) ? `#${bare.toUpperCase()}` : value;
}

/**
 * The measured profile, editable by hand — for correcting a metric the
 * measurement got wrong, or writing one from scratch when the template can't be
 * read. Whatever is saved here is applied literally by the writer, exactly like
 * a measured value; a later re-measure replaces it wholesale.
 */
function StyleEditor({
  initial,
  templateFileName,
  onSave,
  onCancel,
}: {
  initial: StyleProfile;
  templateFileName: string;
  onSave: (profile: StyleProfile) => void;
  onCancel: () => void;
}) {
  const [fonts, setFonts] = useState(initial.fonts.join(", "));
  const [colors, setColors] = useState(initial.colors.join(", "));
  const [structure, setStructure] = useState(initial.structure.join("\n"));
  const [metrics, setMetrics] = useState(initial.metrics);
  const [summary, setSummary] = useState(initial.summary);

  const colorList = splitList(colors).map(normalizeColor);

  const built: StyleProfile = {
    summary: summary.trim(),
    fonts: splitList(fonts),
    colors: colorList,
    structure: structure
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    metrics: metrics
      .map((m) => ({ label: m.label.trim(), value: m.value.trim() }))
      .filter((m) => m.label && m.value),
    // Pinned to the current file, or the automatic pass would treat a hand
    // edit as stale and measure straight over it on the next page load.
    templateFile: templateFileName,
    extractedAt: initial.extractedAt,
  };

  const setMetric = (index: number, next: { label: string; value: string }) =>
    setMetrics(metrics.map((m, i) => (i === index ? next : m)));

  return (
    <div className="sedit">
      <div className="sedit-field">
        <span className="l">Fonts</span>
        <input
          className="input"
          value={fonts}
          placeholder="Calibri, Georgia"
          onChange={(e) => setFonts(e.target.value)}
        />
      </div>

      <div className="sedit-field">
        <span className="l">Colours</span>
        <div>
          <input
            className="input"
            value={colors}
            placeholder="#1F4E79, #F2A900"
            onChange={(e) => setColors(e.target.value)}
          />
          {colorList.length ? (
            <div className="sedit-swatches">
              {colorList.slice(0, 8).map((c, i) => (
                <span key={`${c}${i}`} className="swatch" style={{ background: c }} title={c} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="sedit-field">
        <span className="l">Sections</span>
        <textarea
          className="textarea"
          value={structure}
          placeholder={"Title\nAgenda\nPricing\nNext steps"}
          onChange={(e) => setStructure(e.target.value)}
        />
      </div>

      <div className="sedit-field">
        <span className="l">Metrics</span>
        <div className="sedit-metrics">
          {metrics.map((m, i) => (
            <div className="sedit-metric" key={i}>
              <input
                className="input"
                value={m.label}
                placeholder="Body text size"
                aria-label="Metric name"
                onChange={(e) => setMetric(i, { ...m, label: e.target.value })}
              />
              <input
                className="input mono"
                value={m.value}
                placeholder="18pt"
                aria-label="Metric value"
                onChange={(e) => setMetric(i, { ...m, value: e.target.value })}
              />
              <button
                className="iconbtn sm"
                aria-label={`Remove ${m.label || "metric"}`}
                title="Remove"
                onClick={() => setMetrics(metrics.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            className="link"
            onClick={() => setMetrics([...metrics, { label: "", value: "" }])}
          >
            Add metric
          </button>
        </div>
      </div>

      <div className="sedit-field">
        <span className="l">Notes</span>
        <textarea
          className="textarea"
          value={summary}
          placeholder="Anything else about the look — tone of headings, where the logo sits…"
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>

      <div className="sedit-foot">
        <button className="btn sm" onClick={() => onSave(built)} disabled={!hasStyle(built)}>
          Save
        </button>
        <button className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <span className="rowhint">
          Applied literally, like a measurement. Re-measuring replaces these edits.
        </span>
      </div>
    </div>
  );
}
