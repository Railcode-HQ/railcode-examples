import { ArrowRight, CalendarDays, Check, X } from "lucide-react";
import { ReactNode, useRef, useState } from "react";

import {
  ActionItem,
  PRIORITIES,
  Priority,
  compareActionItems,
  compareActionItemsByDue,
  dueState,
  formatDueDate,
  priorityMeta,
} from "@/lib/crm";
import { useCrmStore } from "@/store/crm-store";

export function PriorityBadge({ priority }: { priority: Priority }) {
  const meta = priorityMeta(priority);
  return <span className={`pbadge t-${meta.tone}`}>{meta.label}</span>;
}

/** Compact, colored priority picker: a dot+label pill that opens a small menu. */
function PriorityPicker({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (p: Priority) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const meta = priorityMeta(value);

  function toggle() {
    if (!open) {
      const rect = btnRef.current?.getBoundingClientRect();
      setDropUp(!!rect && window.innerHeight - rect.bottom < 220);
    }
    setOpen((o) => !o);
  }

  return (
    <div className="ppick">
      <button
        ref={btnRef}
        type="button"
        className="ppick-btn"
        title="Priority"
        onClick={toggle}
        onBlur={() => setOpen(false)}
      >
        <span className={`led ${meta.tone}`} />
        {meta.label}
      </button>
      {open ? (
        <div className={`ppick-menu${dropUp ? " up" : ""}`}>
          {PRIORITIES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`ppick-opt${p.id === value ? " sel" : ""}`}
              // mousedown fires before the button's blur, so the click registers
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(p.id);
                setOpen(false);
              }}
            >
              <span className={`led ${p.tone}`} />
              {p.label}
              {p.id === value ? <Check size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A due-date pill that opens the native calendar via showPicker(). */
function DatePill({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={`datepill${value ? " set" : ""}`}>
      <button
        type="button"
        className="datepill-btn"
        title="Due date"
        onClick={() => ref.current?.showPicker?.()}
      >
        <CalendarDays size={13} />
        <span>{value ? formatDueDate(value) : "Due"}</span>
      </button>
      {value ? (
        <button
          type="button"
          className="datepill-x"
          aria-label="Clear due date"
          onClick={() => onChange("")}
        >
          <X size={12} />
        </button>
      ) : null}
      <input
        ref={ref}
        type="date"
        value={value}
        tabIndex={-1}
        aria-label="Due date"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** One action item: checkbox, title, optional context line, due date, priority. */
export function ActionItemRow({
  item,
  context,
  onToggle,
  onDelete,
}: {
  item: ActionItem;
  context?: ReactNode;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const due = dueState(item.dueDate, item.done);
  return (
    <div className={`airow${item.done ? " done" : ""}`}>
      <button
        type="button"
        className={`aicheck${item.done ? " on" : ""}`}
        aria-label={item.done ? "Mark not done" : "Mark done"}
        onClick={onToggle}
      >
        {item.done ? <Check size={12} strokeWidth={3} /> : null}
      </button>

      <div className="aibody">
        <div className="aititle">{item.title}</div>
        {context ? <div className="aimeta">{context}</div> : null}
      </div>

      {item.dueDate ? (
        <span className={`aidue ${due}`}>{formatDueDate(item.dueDate)}</span>
      ) : null}
      <PriorityBadge priority={item.priority} />

      <button
        type="button"
        className="aidel"
        aria-label="Delete action item"
        onClick={onDelete}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** How many open items the Home card shows before deferring to the full page. */
const HOME_PREVIEW = 5;

/**
 * Home: the open action items, next to the pipeline funnel. Sorting by priority or
 * by due date happens here so the common "what's next" question doesn't need a
 * page change; anything past the first few lives on the Action items page.
 */
export function ActionItemsCard() {
  const {
    actionItems,
    deals,
    companies,
    toggleActionItem,
    deleteActionItem,
    openRecord,
    setView,
  } = useCrmStore();
  const [sort, setSort] = useState<"priority" | "due">("priority");

  const dealById = new Map(deals.map((d) => [d.id, d]));
  const companyById = new Map(companies.map((c) => [c.id, c]));

  const open = actionItems.filter((a) => !a.done);
  const items = [...open]
    .sort(sort === "priority" ? compareActionItems : compareActionItemsByDue)
    .slice(0, HOME_PREVIEW);

  return (
    <div className="sect homecard aicard">
      <div className="sh">
        <h2>Action items</h2>
        <div className="segmented xs">
          <button
            type="button"
            className={`seg${sort === "priority" ? " on" : ""}`}
            onClick={() => setSort("priority")}
          >
            Priority
          </button>
          <button
            type="button"
            className={`seg${sort === "due" ? " on" : ""}`}
            onClick={() => setSort("due")}
          >
            Due
          </button>
        </div>
      </div>

      <div className="aicardlist">
        {items.length ? (
          items.map((it) => {
            const deal = dealById.get(it.dealId);
            const company = deal?.companyId
              ? companyById.get(deal.companyId)
              : undefined;
            return (
              <ActionItemRow
                key={it.id}
                item={it}
                context={
                  <button
                    type="button"
                    className="ailink"
                    onClick={() => deal && openRecord("deal", deal.id)}
                  >
                    {deal?.title ?? "Deleted deal"}
                    {company ? ` · ${company.name}` : ""}
                  </button>
                }
                onToggle={() => toggleActionItem(it.id)}
                onDelete={() => deleteActionItem(it.id)}
              />
            );
          })
        ) : (
          <p className="faint aicardempty">
            Nothing outstanding. Add action items from any deal.
          </p>
        )}
      </div>

      <button type="button" className="cardmore" onClick={() => setView("actionItems")}>
        {open.length > HOME_PREVIEW
          ? `View all ${open.length} action items`
          : "View all action items"}
        <ArrowRight size={13} />
      </button>
    </div>
  );
}

/** Deal page: add an action item + list this deal's items. */
export function DealActionsBlock({ dealId }: { dealId: string }) {
  const { actionItems, saveActionItem, toggleActionItem, deleteActionItem } =
    useCrmStore();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("p2");
  const [due, setDue] = useState("");

  const items = actionItems
    .filter((a) => a.dealId === dealId)
    .sort(compareActionItems);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    void saveActionItem({ dealId, title, priority, dueDate: due || undefined });
    setTitle("");
    setDue("");
    setPriority("p2");
  }

  return (
    <div className="blk">
      <h4>Action items</h4>
      <form className="aiadd" onSubmit={add}>
        <input
          className="aiadd-title"
          value={title}
          placeholder="Add an action item…"
          onChange={(e) => setTitle(e.target.value)}
        />
        <PriorityPicker value={priority} onChange={setPriority} />
        <DatePill value={due} onChange={setDue} />
        <button className="btn sm" type="submit" disabled={!title.trim()}>
          Add
        </button>
      </form>

      {items.length ? (
        <div className="ailist">
          {items.map((it) => (
            <ActionItemRow
              key={it.id}
              item={it}
              onToggle={() => toggleActionItem(it.id)}
              onDelete={() => deleteActionItem(it.id)}
            />
          ))}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 12.5 }}>
          No action items yet.
        </p>
      )}
    </div>
  );
}

/** Company page: every action item across this company's deals. */
export function CompanyActionsBlock({ companyId }: { companyId: string }) {
  const { actionItems, deals, toggleActionItem, deleteActionItem, openRecord } =
    useCrmStore();

  const companyDealIds = new Set(
    deals.filter((d) => d.companyId === companyId).map((d) => d.id),
  );
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const items = actionItems
    .filter((a) => companyDealIds.has(a.dealId))
    .sort(compareActionItems);

  return (
    <div className="blk">
      <h4>Action items</h4>
      {items.length ? (
        <div className="ailist">
          {items.map((it) => (
            <ActionItemRow
              key={it.id}
              item={it}
              context={
                <button
                  type="button"
                  className="ailink"
                  onClick={() => openRecord("deal", it.dealId)}
                >
                  {dealById.get(it.dealId)?.title ?? "Deal"}
                </button>
              }
              onToggle={() => toggleActionItem(it.id)}
              onDelete={() => deleteActionItem(it.id)}
            />
          ))}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 12.5 }}>
          No action items on this company's deals.
        </p>
      )}
    </div>
  );
}
