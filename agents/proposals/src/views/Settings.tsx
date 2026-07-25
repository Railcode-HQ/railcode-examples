import { formatDateTime, TIME_RANGES, TimeRange } from "@/lib/proposals";
import { useProposalStore } from "@/store/proposal-store";

export function Settings() {
  const { settings, cronState, saveSettings } = useProposalStore();

  return (
    <>
      <div className="phead">
        <div>
          <h1>Settings</h1>
          <p>How the automatic nightly run behaves.</p>
        </div>
      </div>

      <div className="sect">
        <div className="sh">
          <h2>Automatic drafting</h2>
        </div>
        <div style={{ padding: 18 }}>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.autoDraft}
              onChange={(e) => void saveSettings({ autoDraft: e.target.checked })}
            />
            <span>
              <b>Draft proposals automatically</b>
              <span className="faint">
                On each scheduled run, write a proposal for every new client meeting. Turn this
                off to keep the run indexing meetings only, and draft by hand.
              </span>
            </span>
          </label>

          <div className="field" style={{ marginTop: 16, maxWidth: 220 }}>
            <span className="l">Meetings to look at</span>
            <select
              className="select"
              value={settings.timeRange}
              onChange={(e) => void saveSettings({ timeRange: e.target.value as TimeRange })}
            >
              {TIME_RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="faint" style={{ marginTop: 6 }}>
              Granola only offers these three windows — there is no folder filter or custom
              range. Which meetings count as client calls is judged from the attendees, so
              internal standups and 1:1s are skipped without you configuring anything.
            </span>
          </div>
        </div>
      </div>

      {cronState ? (
        <div className="sect" style={{ marginTop: 18 }}>
          <div className="sh">
            <h2>Last automatic run</h2>
            <span className="hint">
              {cronState.lastRunAt ? formatDateTime(cronState.lastRunAt) : "never"}
            </span>
          </div>
          <div style={{ padding: 18 }}>
            {cronState.drafted?.length ? (
              <div className="prov-row">
                <span className="k">Drafted</span>
                <span className="v">{cronState.drafted.join(", ")}</span>
              </div>
            ) : (
              <p className="faint">No proposals were drafted on the last run.</p>
            )}
            {cronState.skipped?.length ? (
              <div className="prov-row">
                <span className="k">Skipped</span>
                <span className="v">{cronState.skipped.join(" · ")}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
