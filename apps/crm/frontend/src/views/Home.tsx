import { ActionItemsCard } from "@/components/ActionItems";
import { MeetingTriage } from "@/components/MeetingTriage";
import { STAGES, formatMoney, stage } from "@/lib/crm";
import { useCrmStore } from "@/store/crm-store";

export function Home() {
  const { deals } = useCrmStore();

  const byStage = STAGES.map((s) => {
    const list = deals.filter((d) => d.stage === s.id);
    return {
      stage: s,
      count: list.length,
      value: list.reduce((sum, d) => sum + (d.value ?? 0), 0),
    };
  });
  // Funnel bars are sized by deal count; keep a floor of 1 so we never divide by 0.
  const maxCount = Math.max(1, ...byStage.map((b) => b.count));
  // "Total pipeline" = value still in play (everything not yet won or lost).
  const totalPipeline = deals
    .filter((d) => !stage(d.stage).terminal)
    .reduce((sum, d) => sum + (d.value ?? 0), 0);

  return (
    <>
      <div className="phead">
        <div>
          <h1>Home</h1>
          <p>Your workspace at a glance.</p>
        </div>
      </div>

      <div className="homegrid">
        <div className="sect homecard pipecard">
          <div className="sh">
            <h2>Pipeline</h2>
            <span className="funtotal tab">{formatMoney(totalPipeline)}</span>
          </div>

          <div className="funnel">
            {byStage.map(({ stage: s, count, value }) => (
              <div className="funrow" key={s.id}>
                <span className="funlabel">
                  <span className={`led ${s.tone}`} />
                  {s.label}
                </span>
                <div className="funtrack">
                  <div
                    className={`funfill ${s.tone}`}
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="funcount tab">{count}</span>
                <span className="funval tab">{formatMoney(value)}</span>
              </div>
            ))}
          </div>
        </div>

        <ActionItemsCard />
      </div>

      <MeetingTriage />
    </>
  );
}
