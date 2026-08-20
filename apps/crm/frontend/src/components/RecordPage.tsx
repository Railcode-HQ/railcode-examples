import {
  ArrowLeft,
  AtSign,
  Briefcase,
  Building2,
  Check,
  ChevronRight,
  CircleDot,
  DollarSign,
  FileText,
  Globe,
  ImagePlus,
  Phone,
  Tag,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  CompanyActionsBlock,
  DealActionsBlock,
} from "@/components/ActionItems";
import { CallNoteViewer } from "@/components/CallNoteViewer";
import { DealFiles, GenerateButton } from "@/components/DealFiles";
import { SearchSelect } from "@/components/SearchSelect";
import {
  Activity,
  CallNote,
  Company,
  EntityType,
  STAGES,
  StageId,
  cleanError,
  formatMoney,
  initials,
  newId,
  nowIso,
  stage,
  timeAgo,
} from "@/lib/crm";
import { RecordRoute, View, useCrmStore } from "@/store/crm-store";

type RecordRouteNN = NonNullable<RecordRoute>;

const TYPE_LABEL: Record<EntityType, string> = {
  company: "Company",
  contact: "Contact",
  deal: "Deal",
};

// Where the back link and breadcrumb lead for each record type.
const PARENT: Record<EntityType, { view: View; label: string }> = {
  company: { view: "companies", label: "Companies" },
  contact: { view: "contacts", label: "Contacts" },
  deal: { view: "pipeline", label: "Pipeline" },
};

type FormState = {
  name: string;
  domain: string;
  industry: string;
  email: string;
  phone: string;
  title: string;
  value: string;
  stage: StageId;
  companyId: string;
  contactId: string;
  notes: string;
};

export function RecordPage() {
  const { record } = useCrmStore();
  if (!record) return null;
  return <RecordInner key={keyOf(record)} d={record} />;
}

function keyOf(d: RecordRouteNN) {
  return d.mode === "view"
    ? `view:${d.type}:${d.id}`
    : `new:${d.type}:${d.companyId ?? ""}:${d.contactId ?? ""}`;
}

function RecordInner({ d }: { d: RecordRouteNN }) {
  const {
    companies,
    contacts,
    deals,
    activities,
    callNotes,
    identity,
    setView,
    saveCompany,
    saveContact,
    saveDeal,
    deleteCompany,
    deleteContact,
    deleteDeal,
    addNote,
    openRecord,
    openCreate,
    setCompanyLogo,
  } = useCrmStore();

  const { type } = d;
  const creating = d.mode === "create";
  const parent = PARENT[type];
  const goBack = () => setView(parent.view);

  const record =
    d.mode === "view"
      ? type === "company"
        ? companies.find((c) => c.id === d.id)
        : type === "contact"
          ? contacts.find((c) => c.id === d.id)
          : deals.find((x) => x.id === d.id)
      : undefined;

  const [form, setForm] = useState<FormState>(() =>
    initForm(type, record, creating ? d : undefined),
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [viewingNote, setViewingNote] = useState<CallNote | null>(null);
  // An unsaved draft, shown in the same modal; discarded if the user cancels.
  const [draftNote, setDraftNote] = useState<CallNote | null>(null);

  const recordId = record?.id;
  const formRef = useRef(form);
  formRef.current = form;
  const pendingRef = useRef(false);
  const firstRun = useRef(true);

  // record deleted elsewhere → bounce back to its list
  const missing = d.mode === "view" && !record;
  useEffect(() => {
    if (missing) goBack();
  }, [missing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Existing records auto-save on a debounce; a pending save is flushed when
  // the user leaves the page so nothing typed is lost.
  useEffect(() => {
    if (creating || !recordId) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    pendingRef.current = true;
    setSaving(true);
    const t = window.setTimeout(async () => {
      await persist(formRef.current);
      pendingRef.current = false;
      setSaving(false);
    }, 700);
    return () => window.clearTimeout(t);
  }, [form, creating, recordId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (pendingRef.current) void persist(formRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const timeline = useMemo(
    () =>
      record
        ? activities.filter(
            (a) => a.entityType === type && a.entityId === record.id,
          )
        : [],
    [activities, record, type],
  );

  if (missing) return null;

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const primaryName = type === "deal" ? form.title : form.name;
  const canSave = primaryName.trim().length > 0 && !saving;

  // Writes the current form onto the existing record. No-op if the record was
  // deleted, or if the required name/title is blank — never resurrects or
  // blank-names a record from a stray debounce.
  async function persist(f: FormState) {
    if (!recordId) return;
    const store = useCrmStore.getState();
    const exists =
      type === "company"
        ? store.companies.some((c) => c.id === recordId)
        : type === "contact"
          ? store.contacts.some((c) => c.id === recordId)
          : store.deals.some((dl) => dl.id === recordId);
    if (!exists) return;

    const notes = f.notes.trim() || undefined;
    const companyId = f.companyId || undefined;
    const contactId = f.contactId || undefined;
    if (type === "company") {
      if (!f.name.trim()) return;
      await saveCompany({
        id: recordId,
        name: f.name,
        domain: f.domain,
        industry: f.industry,
        notes,
      });
    } else if (type === "contact") {
      if (!f.name.trim()) return;
      await saveContact({
        id: recordId,
        name: f.name,
        email: f.email,
        phone: f.phone,
        title: f.title,
        companyId,
        notes,
      });
    } else {
      if (!f.title.trim()) return;
      const parsed = f.value.trim() === "" ? undefined : Number(f.value);
      await saveDeal({
        id: recordId,
        title: f.title,
        value: parsed !== undefined && Number.isNaN(parsed) ? undefined : parsed,
        stage: f.stage,
        companyId,
        contactId,
        notes,
      });
    }
  }

  // Create mode stays explicit — nothing is written until the user commits.
  async function onCreate() {
    if (!canSave || !creating) return;
    setSaving(true);
    try {
      const companyId = form.companyId || undefined;
      const contactId = form.contactId || undefined;
      const notes = form.notes.trim() || undefined;
      if (type === "company") {
        const saved = await saveCompany({
          name: form.name,
          domain: form.domain,
          industry: form.industry,
          notes,
        });
        openRecord("company", saved.id);
      } else if (type === "contact") {
        const saved = await saveContact({
          name: form.name,
          email: form.email,
          phone: form.phone,
          title: form.title,
          companyId,
          notes,
        });
        openRecord("contact", saved.id);
      } else {
        const parsed = form.value.trim() === "" ? undefined : Number(form.value);
        const saved = await saveDeal({
          title: form.title,
          value: parsed !== undefined && Number.isNaN(parsed) ? undefined : parsed,
          stage: form.stage,
          companyId,
          contactId,
          notes,
        });
        openRecord("deal", saved.id);
      }
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!record) return;
    if (!window.confirm(`Delete this ${type}? This cannot be undone.`)) return;
    if (type === "company") await deleteCompany(record.id);
    else if (type === "contact") await deleteContact(record.id);
    else await deleteDeal(record.id);
  }

  function submitNote(e: FormEvent) {
    e.preventDefault();
    if (!record || !note.trim()) return;
    void addNote(type, record.id, note);
    setNote("");
  }

  /**
   * Blank call note attached to whatever record we're on. Manual notes have no
   * Granola meeting behind them, so they get their own generated key — that's
   * what any transcript typed here is filed under.
   */
  function startDraftNote() {
    if (!record) return;
    const ts = nowIso();
    setDraftNote({
      id: newId("cn"),
      meetingId: newId("mtg"),
      contactIds: type === "contact" ? [record.id] : [],
      ...(type === "company" ? { companyId: record.id } : {}),
      title: "",
      date: ts,
      attendees: "",
      notesMarkdown: "",
      createdAt: ts,
      source: "manual",
      importedBy: identity?.user.name,
    });
  }

  async function onLogoPick(file: File) {
    if (!record) return;
    try {
      const logo = await fileToLogoDataUrl(file);
      await setCompanyLogo(record.id, logo);
    } catch (err) {
      useCrmStore.setState({ error: cleanError(err) });
    }
  }

  return (
    <div className="recpage lin">
      <div className="rectop">
        <button className="backlink" onClick={goBack}>
          <ArrowLeft size={15} />
          {parent.label}
        </button>
        <div className="spacer" />
        {type === "deal" && record ? <GenerateButton dealId={record.id} /> : null}
        {creating ? (
          <button className="btn" onClick={onCreate} disabled={!canSave}>
            {saving ? "Creating…" : "Create"}
          </button>
        ) : (
          <span className="savestate">
            {saving ? (
              "Saving…"
            ) : (
              <>
                <Check size={13} />
                Saved
              </>
            )}
          </span>
        )}
      </div>

      <div className="lingrid">
        <div className="linmain">
          <div className="linhead">
            {type === "company" && record ? (
              <CompanyLogo
                name={form.name}
                logo={(record as Company).logo}
                onPick={onLogoPick}
              />
            ) : (
              <span
                className={`glyph lg ${type === "deal" ? "dl" : type === "contact" ? "ct" : "co"}`}
              >
                {type === "deal" ? <Tag /> : initials(primaryName || "?")}
              </span>
            )}
            <input
              className="lintitle"
              value={primaryName}
              autoFocus={creating}
              placeholder={type === "deal" ? "Deal title" : `${TYPE_LABEL[type]} name`}
              onChange={(e) =>
                set(
                  type === "deal"
                    ? { title: e.target.value }
                    : { name: e.target.value },
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && creating && canSave) {
                  e.preventDefault();
                  void onCreate();
                }
              }}
            />
          </div>

          <textarea
            className="lindesc"
            value={form.notes}
            placeholder="Add a description…"
            onChange={(e) => set({ notes: e.target.value })}
          />

          {type === "deal" && record ? (
            <>
              <DealActionsBlock dealId={record.id} />
              <DealFiles dealId={record.id} />
            </>
          ) : null}

          {record && type !== "deal" ? (
            <Linked
              type={type}
              id={record.id}
              companies={companies}
              contacts={contacts}
              deals={deals}
              callNotes={callNotes}
              openRecord={openRecord}
              openCreate={openCreate}
              onOpenNote={setViewingNote}
              onNewNote={startDraftNote}
            />
          ) : null}

          {type === "company" && record ? (
            <CompanyActionsBlock companyId={record.id} />
          ) : null}

          {record ? (
            <div className="blk">
              <h4>Activity</h4>
              <form className="noteadd" onSubmit={submitNote}>
                <input
                  className="input"
                  value={note}
                  placeholder="Add a note…"
                  onChange={(e) => setNote(e.target.value)}
                />
                <button className="btn sm" type="submit" disabled={!note.trim()}>
                  Add
                </button>
              </form>
              <Timeline items={timeline} />
            </div>
          ) : (
            <p className="faint" style={{ fontSize: 12.5 }}>
              Save this {TYPE_LABEL[type].toLowerCase()} to link records and track activity.
            </p>
          )}
        </div>

        <aside className="linprops">
          <div className="linprops-h">Properties</div>

          {type === "deal" ? (
            <>
              <Prop icon={CircleDot} label="Status">
                <SearchSelect
                  ghost
                  clearLabel={null}
                  value={form.stage}
                  options={STAGES.map((s) => ({
                    value: s.id,
                    label: s.label,
                    dot: s.tone,
                  }))}
                  onChange={(v) => set({ stage: v as StageId })}
                />
              </Prop>
              <Prop icon={DollarSign} label="Value">
                <PropInput
                  numeric
                  value={form.value}
                  placeholder="Empty"
                  onChange={(v) => set({ value: v.replace(/[^0-9.]/g, "") })}
                />
              </Prop>
              <Prop icon={Building2} label="Company">
                <SearchSelect
                  ghost
                  placeholder="Empty"
                  value={form.companyId}
                  options={companies.map((c) => ({
                    value: c.id,
                    label: c.name,
                    sub: c.domain,
                  }))}
                  onChange={(v) => set({ companyId: v, contactId: "" })}
                />
              </Prop>
              <Prop icon={User} label="Contact">
                <SearchSelect
                  ghost
                  placeholder="Empty"
                  value={form.contactId}
                  options={contacts
                    .filter((c) => !form.companyId || c.companyId === form.companyId)
                    .map((c) => ({
                      value: c.id,
                      label: c.name,
                      sub: c.title ?? c.email,
                    }))}
                  onChange={(v) => set({ contactId: v })}
                />
              </Prop>
            </>
          ) : null}

          {type === "contact" ? (
            <>
              <Prop icon={Building2} label="Company">
                <SearchSelect
                  ghost
                  placeholder="Empty"
                  value={form.companyId}
                  options={companies.map((c) => ({
                    value: c.id,
                    label: c.name,
                    sub: c.domain,
                  }))}
                  onChange={(v) => set({ companyId: v })}
                />
              </Prop>
              <Prop icon={Briefcase} label="Title">
                <PropInput
                  value={form.title}
                  placeholder="Empty"
                  onChange={(v) => set({ title: v })}
                />
              </Prop>
              <Prop icon={AtSign} label="Email">
                <PropInput
                  mono
                  value={form.email}
                  placeholder="Empty"
                  onChange={(v) => set({ email: v })}
                />
              </Prop>
              <Prop icon={Phone} label="Phone">
                <PropInput
                  mono
                  value={form.phone}
                  placeholder="Empty"
                  onChange={(v) => set({ phone: v })}
                />
              </Prop>
            </>
          ) : null}

          {type === "company" ? (
            <>
              <Prop icon={Globe} label="Domain">
                <PropInput
                  mono
                  value={form.domain}
                  placeholder="Empty"
                  onChange={(v) => set({ domain: v })}
                />
              </Prop>
              <Prop icon={Tag} label="Industry">
                <PropInput
                  value={form.industry}
                  placeholder="Empty"
                  onChange={(v) => set({ industry: v })}
                />
              </Prop>
            </>
          ) : null}

          {record ? (
            <button className="prop-del" onClick={onDelete}>
              <Trash2 size={14} />
              Delete {TYPE_LABEL[type].toLowerCase()}
            </button>
          ) : null}
        </aside>
      </div>

      {viewingNote ? (
        <CallNoteViewer note={viewingNote} onClose={() => setViewingNote(null)} />
      ) : null}

      {draftNote ? (
        <CallNoteViewer note={draftNote} isNew onClose={() => setDraftNote(null)} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

type Store = ReturnType<typeof useCrmStore.getState>;

function Linked({
  type,
  id,
  companies,
  contacts,
  deals,
  callNotes,
  openRecord,
  openCreate,
  onOpenNote,
  onNewNote,
}: {
  type: EntityType;
  id: string;
  companies: Store["companies"];
  contacts: Store["contacts"];
  deals: Store["deals"];
  callNotes: Store["callNotes"];
  openRecord: Store["openRecord"];
  openCreate: Store["openCreate"];
  onOpenNote: (note: CallNote) => void;
  onNewNote: () => void;
}) {
  if (type === "company") {
    const cos = contacts.filter((c) => c.companyId === id);
    const dls = deals.filter((dl) => dl.companyId === id);
    // Notes attach to people now; a company's notes are those of its contacts
    // (plus any legacy company-scoped ones imported before per-person matching).
    const companyContactIds = new Set(cos.map((c) => c.id));
    const notes = callNotes
      .filter(
        (n) =>
          (n.contactIds ?? []).some((cid) => companyContactIds.has(cid)) ||
          n.companyId === id,
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const empty = cos.length === 0 && dls.length === 0;
    return (
      <>
        <div className="blk">
          <h4>
            People &amp; deals
            <span style={{ float: "right", fontWeight: 500 }}>
              <button
                className="link"
                onClick={() => openCreate("contact", { companyId: id })}
              >
                + Contact
              </button>
              {"   "}
              <button
                className="link"
                onClick={() => openCreate("deal", { companyId: id })}
              >
                + Deal
              </button>
            </span>
          </h4>
          {empty ? (
            <p className="faint" style={{ fontSize: 12.5 }}>
              No contacts or deals linked yet.
            </p>
          ) : (
            <div className="sect">
              <div className="rows">
                {cos.map((c) => (
                  <LinkedRow
                    key={c.id}
                    icon={<Users size={15} />}
                    tone="ct"
                    name={c.name}
                    meta={c.title ?? c.email ?? "Contact"}
                    onClick={() => openRecord("contact", c.id)}
                  />
                ))}
                {dls.map((dl) => (
                  <LinkedRow
                    key={dl.id}
                    icon={<Tag size={15} />}
                    tone="dl"
                    name={dl.title}
                    meta={`${stage(dl.stage).label} · ${formatMoney(dl.value)}`}
                    onClick={() => openRecord("deal", dl.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="blk">
          <h4>
            Call notes
            <span style={{ float: "right", fontWeight: 500 }}>
              <button className="link" onClick={onNewNote}>
                + Note
              </button>
            </span>
          </h4>
          {notes.length === 0 ? (
            <p className="faint" style={{ fontSize: 12.5 }}>
              No call notes yet. Add one, or connect Granola to import them.
            </p>
          ) : (
            <div className="sect">
              <div className="rows">
                {notes.map((n) => (
                  <LinkedRow
                    key={n.id}
                    icon={<FileText size={15} />}
                    name={n.title}
                    meta={new Date(n.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    onClick={() => onOpenNote(n)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  if (type === "contact") {
    const contact = contacts.find((c) => c.id === id);
    const dls = deals.filter((dl) => dl.contactId === id);
    const notes = callNotes
      .filter((n) => (n.contactIds ?? []).includes(id))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return (
      <>
        <div className="blk">
          <h4>
            Deals
            <span style={{ float: "right", fontWeight: 500 }}>
              <button
                className="link"
                onClick={() =>
                  openCreate("deal", {
                    companyId: contact?.companyId,
                    contactId: id,
                  })
                }
              >
                + Deal
              </button>
            </span>
          </h4>
          {dls.length === 0 ? (
            <p className="faint" style={{ fontSize: 12.5 }}>
              No deals linked yet.
            </p>
          ) : (
            <div className="sect">
              <div className="rows">
                {dls.map((dl) => (
                  <LinkedRow
                    key={dl.id}
                    icon={<Tag size={15} />}
                    tone="dl"
                    name={dl.title}
                    meta={`${stage(dl.stage).label} · ${formatMoney(dl.value)}`}
                    onClick={() => openRecord("deal", dl.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="blk">
          <h4>
            Call notes
            <span style={{ float: "right", fontWeight: 500 }}>
              <button className="link" onClick={onNewNote}>
                + Note
              </button>
            </span>
          </h4>
          {notes.length === 0 ? (
            <p className="faint" style={{ fontSize: 12.5 }}>
              No call notes yet. Add one, or sync Granola to import meetings for
              this person.
            </p>
          ) : (
            <div className="sect">
              <div className="rows">
                {notes.map((n) => (
                  <LinkedRow
                    key={n.id}
                    icon={<FileText size={15} />}
                    name={n.title}
                    meta={new Date(n.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    onClick={() => onOpenNote(n)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  // deal
  const deal = deals.find((dl) => dl.id === id);
  const company = deal?.companyId
    ? companies.find((c) => c.id === deal.companyId)
    : undefined;
  const contact = deal?.contactId
    ? contacts.find((c) => c.id === deal.contactId)
    : undefined;
  return (
    <div className="blk">
      <h4>Links</h4>
      {!company && !contact ? (
        <p className="faint" style={{ fontSize: 12.5 }}>
          No company or contact linked yet.
        </p>
      ) : (
        <div className="sect">
          <div className="rows">
            {company ? (
              <LinkedRow
                icon={<Building2 size={15} />}
                tone="co"
                name={company.name}
                meta={company.domain ?? "Company"}
                onClick={() => openRecord("company", company.id)}
              />
            ) : null}
            {contact ? (
              <LinkedRow
                icon={<Users size={15} />}
                tone="ct"
                name={contact.name}
                meta={contact.email ?? contact.title ?? "Contact"}
                onClick={() => openRecord("contact", contact.id)}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** One row in the Linear-style properties panel: icon + label + inline control. */
function Prop({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CircleDot;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="prop">
      <span className="prop-k">
        <Icon size={14} />
        {label}
      </span>
      <div className="prop-v">{children}</div>
    </div>
  );
}

/** Borderless, inline-editable text value for a property row. */
function PropInput({
  value,
  onChange,
  placeholder = "Empty",
  mono = false,
  numeric = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  numeric?: boolean;
}) {
  return (
    <input
      className={`propin${mono ? " mono" : ""}`}
      value={value}
      placeholder={placeholder}
      inputMode={numeric ? "numeric" : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function LinkedRow({
  icon,
  tone,
  name,
  meta,
  onClick,
}: {
  icon: React.ReactNode;
  tone?: "co" | "ct" | "dl";
  name: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      className="crow click"
      style={{ border: 0, background: "none", width: "100%", textAlign: "left" }}
      onClick={onClick}
    >
      <span
        className={`glyph${tone ? ` ${tone}` : ""}`}
        style={{ width: 30, height: 30 }}
      >
        {icon}
      </span>
      <div className="body">
        <div className="cname" style={{ fontSize: 13 }}>
          {name}
        </div>
        <div className="meta">{meta}</div>
      </div>
      <ChevronRight className="crow-go" size={16} />
    </button>
  );
}

function Timeline({ items }: { items: Activity[] }) {
  if (items.length === 0)
    return (
      <p className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>
        No activity yet.
      </p>
    );
  return (
    <div className="timeline" style={{ marginTop: 6 }}>
      {items.map((a) => (
        <div key={a.id} className={`tl ${a.kind}`}>
          <span className="dot" />
          <div className="tlbody">
            <div className="tltext">{a.body}</div>
            <div className="tlwhen">
              {timeAgo(a.createdAt)}
              {a.author ? ` · ${a.author}` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CompanyLogo({
  name,
  logo,
  onPick,
}: {
  name: string;
  logo?: string;
  onPick: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <button
      type="button"
      className="glyph lg logoglyph co"
      onClick={() => ref.current?.click()}
      title={logo ? "Change logo" : "Upload a logo"}
      aria-label={logo ? "Change company logo" : "Upload company logo"}
    >
      {logo ? <img src={logo} alt="" /> : initials(name || "?")}
      <span className="logoedit">
        <ImagePlus size={16} />
      </span>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = "";
          if (file) onPick(file);
        }}
      />
    </button>
  );
}

/**
 * Reads an image file, downscales it to a small thumbnail on a canvas, and
 * returns a data URL small enough to store on the company record.
 */
function fileToLogoDataUrl(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Pick an image file for the logo."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image couldn't be loaded."));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Couldn't process that image."));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/webp", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function initForm(
  type: EntityType,
  record: unknown,
  create?: { companyId?: string; contactId?: string },
): FormState {
  const base: FormState = {
    name: "",
    domain: "",
    industry: "",
    email: "",
    phone: "",
    title: "",
    value: "",
    stage: "new",
    companyId: create?.companyId ?? "",
    contactId: create?.contactId ?? "",
    notes: "",
  };
  if (!record) return base;
  const r = record as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (type === "company") {
    return {
      ...base,
      name: s(r.name),
      domain: s(r.domain),
      industry: s(r.industry),
      notes: s(r.notes),
    };
  }
  if (type === "contact") {
    return {
      ...base,
      name: s(r.name),
      email: s(r.email),
      phone: s(r.phone),
      title: s(r.title),
      companyId: s(r.companyId),
      notes: s(r.notes),
    };
  }
  return {
    ...base,
    title: s(r.title),
    value: typeof r.value === "number" ? String(r.value) : "",
    stage: (s(r.stage) || "new") as StageId,
    companyId: s(r.companyId),
    contactId: s(r.contactId),
    notes: s(r.notes),
  };
}
