import { useMemo } from "react";
import { useStore } from "../store";
import { buildColumns, type Filters } from "../lib/cards";
import { STATUSES, STATUS_LABEL, type Status } from "../types";
import { PriorityBadge, TagChip, relativeTime } from "./bits";
import { AssigneeAvatar } from "./AssigneeControls";
import { SortMenu } from "./SortMenu";
import { SelectMenu } from "./SelectMenu";
import { IconChevron } from "./icons";

export function ListView() {
  const cards = useStore((s) => s.cards);
  const sorts = useStore((s) => s.sorts);
  const setSort = useStore((s) => s.setSort);
  const search = useStore((s) => s.search);
  const tagFilter = useStore((s) => s.tagFilter);
  const priorityFilter = useStore((s) => s.priorityFilter);
  const assigneeFilter = useStore((s) => s.assigneeFilter);
  const doneFilter = useStore((s) => s.doneFilter);
  const openDrawer = useStore((s) => s.openDrawer);
  const setCardStatus = useStore((s) => s.setCardStatus);
  const collapsed = useStore((s) => s.collapsed);
  const toggleCollapse = useStore((s) => s.toggleCollapse);

  const cols = useMemo(() => {
    const filters: Filters = {
      search,
      tags: tagFilter,
      priorities: priorityFilter,
      assignees: assigneeFilter,
      done: doneFilter,
      now: new Date(),
    };
    return buildColumns(Object.values(cards), filters, sorts);
  }, [cards, sorts, search, tagFilter, priorityFilter, assigneeFilter, doneFilter]);

  return (
    <div className="listview">
      {STATUSES.map(({ key }) => {
        const isCollapsed = collapsed[key];
        return (
        <section key={key} className={`sect${isCollapsed ? " collapsed" : ""}`}>
          <div
            className="sh sh-click"
            onClick={() => toggleCollapse(key)}
            role="button"
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            <span className={`col-dot ${key}`} />
            <h2 className="sh-title">{STATUS_LABEL[key]}</h2>
            <span className="col-count tab">{cols[key].length}</span>
            <span className="sh-spacer" />
            {!isCollapsed && (
              <SortMenu
                status={key}
                value={sorts[key]}
                onChange={(s) => setSort(key, s)}
              />
            )}
            <IconChevron className="sh-chev" />
          </div>
          {!isCollapsed && (
          <div className="rows">
            {cols[key].length === 0 && (
              <div className="row-empty">No cards here.</div>
            )}
            {cols[key].map((card) => (
              <div
                key={card.id}
                className="row click"
                onClick={() => openDrawer(card.id)}
              >
                <PriorityBadge priority={card.priority} />
                <div className="row-body">
                  <div className="row-title">{card.title}</div>
                  {card.tags.length > 0 && (
                    <div className="row-tags">
                      {card.tags.map((t) => (
                        <TagChip key={t} tag={t} />
                      ))}
                    </div>
                  )}
                </div>
                <AssigneeAvatar uuid={card.assignee} size="sm" />
                <div className="row-meta">
                  {card.status === "done" && card.done_at
                    ? `Done ${relativeTime(card.done_at)}`
                    : `Created ${relativeTime(card.created_at)}`}
                </div>
                <SelectMenu
                  className="row-status"
                  ariaLabel="Move card"
                  align="right"
                  value={card.status}
                  onChange={(v) => setCardStatus(card.id, v as Status)}
                  options={STATUSES.map((s) => ({
                    value: s.key,
                    label: s.label,
                  }))}
                />
              </div>
            ))}
          </div>
          )}
        </section>
        );
      })}
    </div>
  );
}
