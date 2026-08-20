import { Loader2, Plus, Workflow } from "lucide-react";
import { DragEvent, useMemo, useState } from "react";

import { RunAutomationModal } from "@/components/RunAutomationModal";
import {
  Deal,
  STAGES,
  StageId,
  formatMoney,
  formatMoneyCompact,
  stage,
} from "@/lib/crm";
import { isGenerating, useAutomationStore } from "@/store/automation-store";
import { useCrmStore } from "@/store/crm-store";

export function Pipeline() {
  const { deals, companies, search, openRecord, openCreate, moveDeal } =
    useCrmStore();
  const { runs, artifacts } = useAutomationStore();

  const [dragging, setDragging] = useState<string | null>(null);
  const [dropStage, setDropStage] = useState<StageId | null>(null);
  /** The deal whose "run an automation" dialog is open. */
  const [runFor, setRunFor] = useState<string | null>(null);

  const companyName = useMemo(() => {
    const m = new Map<string, string>();
    companies.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [companies]);

  const q = search.trim().toLowerCase();
  const visible = q
    ? deals.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          (d.companyId && companyName.get(d.companyId)?.toLowerCase().includes(q)),
      )
    : deals;

  const openValue = visible
    .filter((d) => !stage(d.stage).terminal)
    .reduce((sum, d) => sum + (d.value ?? 0), 0);

  function onDrop(e: DragEvent, toStage: StageId) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragging;
    setDragging(null);
    setDropStage(null);
    if (id) void moveDeal(id, toStage);
  }

  return (
    <>
      <div className="phead">
        <div>
          <h1>Pipeline</h1>
          <p>
            {formatMoney(openValue)} open across{" "}
            {visible.filter((d) => !stage(d.stage).terminal).length} deals
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => openCreate("deal")}>
            <Plus />
            New deal
          </button>
        </div>
      </div>

      <div className="board">
        {STAGES.map((s) => {
          const list = visible.filter((d) => d.stage === s.id);
          const sum = list.reduce((acc, d) => acc + (d.value ?? 0), 0);
          return (
            <div
              key={s.id}
              className={`col${dropStage === s.id ? " drop" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (dropStage !== s.id) setDropStage(s.id);
              }}
              onDragLeave={(e) => {
                // only clear if leaving the column entirely
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setDropStage((cur) => (cur === s.id ? null : cur));
              }}
              onDrop={(e) => onDrop(e, s.id)}
            >
              <div className="colhead">
                <span className="ttl">
                  <span className={`led ${s.tone}`} />
                  {s.label}
                </span>
                <span className="ct tab">{list.length}</span>
                <span className="sum tab">{formatMoneyCompact(sum)}</span>
              </div>
              <div className="collist">
                {list.map((d) => (
                  <Card
                    key={d.id}
                    deal={d}
                    company={d.companyId ? companyName.get(d.companyId) : undefined}
                    dragging={dragging === d.id}
                    generating={isGenerating(runs, d.id)}
                    docCount={artifacts.filter((a) => a.dealId === d.id).length}
                    onOpen={() => openRecord("deal", d.id)}
                    onRun={() => setRunFor(d.id)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", d.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(d.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropStage(null);
                    }}
                  />
                ))}
                {list.length === 0 ? (
                  <div className="colempty">Drop deals here</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {runFor ? (
        <RunAutomationModal dealId={runFor} onClose={() => setRunFor(null)} />
      ) : null}
    </>
  );
}

function Card({
  deal,
  company,
  dragging,
  generating,
  docCount,
  onOpen,
  onRun,
  onDragStart,
  onDragEnd,
}: {
  deal: Deal;
  company?: string;
  dragging: boolean;
  generating: boolean;
  docCount: number;
  onOpen: () => void;
  onRun: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      className={`card${dragging ? " dragging" : ""}`}
      draggable
      onClick={onOpen}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="ct-head">
        <div className="ct-title">{deal.title}</div>
        {/* The card itself opens the deal, so the trigger has to keep its click. */}
        <button
          className={`ct-run${generating ? " busy" : ""}`}
          title={generating ? "Generating a document…" : "Run an automation"}
          aria-label={generating ? "Generating a document" : `Run an automation on ${deal.title}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!generating) onRun();
          }}
          onDragStart={(e) => e.preventDefault()}
        >
          {generating ? <Loader2 className="spinicon" size={13} /> : <Workflow size={13} />}
        </button>
      </div>
      <div className="ct-meta">
        {deal.value !== undefined ? (
          <span className="ct-val">{formatMoney(deal.value)}</span>
        ) : null}
        {deal.value !== undefined && company ? <span>·</span> : null}
        {company ? <span className="ct-co">{company}</span> : null}
        {deal.value === undefined && !company ? (
          <span className="faint">No value</span>
        ) : null}
        {docCount ? (
          <>
            <span>·</span>
            <span className="ct-docs" title={`${docCount} generated document${docCount === 1 ? "" : "s"}`}>
              {docCount} doc{docCount === 1 ? "" : "s"}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
