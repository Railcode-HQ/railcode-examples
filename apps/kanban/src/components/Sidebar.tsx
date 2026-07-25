import { useMemo } from "react";
import { useStore } from "../store";
import { tagTone } from "../lib/cards";
import { PRIORITIES, type Priority } from "../types";
import { PriorityBadge } from "./bits";
import { useAssigneeMap, initials as assigneeInitials } from "./AssigneeControls";
import { IconBoard, IconList, IconPlus, IconTag } from "./icons";
import type { View } from "../types";

const PRIORITY_DESC: Record<Priority, string> = {
  0: "Critical",
  1: "High",
  2: "Medium",
  3: "Low",
  4: "Lowest",
};

export function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const cards = useStore((s) => s.cards);
  const tagFilter = useStore((s) => s.tagFilter);
  const toggleTagFilter = useStore((s) => s.toggleTagFilter);
  const clearTagFilter = useStore((s) => s.clearTagFilter);
  const priorityFilter = useStore((s) => s.priorityFilter);
  const togglePriorityFilter = useStore((s) => s.togglePriorityFilter);
  const clearPriorityFilter = useStore((s) => s.clearPriorityFilter);
  const assigneeFilter = useStore((s) => s.assigneeFilter);
  const toggleAssigneeFilter = useStore((s) => s.toggleAssigneeFilter);
  const clearAssigneeFilter = useStore((s) => s.clearAssigneeFilter);
  const openPalette = useStore((s) => s.openPalette);
  const setSidebar = useStore((s) => s.setSidebar);
  const userUuid = useStore((s) => s.userUuid);
  const userName = useStore((s) => s.userName);
  const userEmail = useStore((s) => s.userEmail);
  const assigneeMap = useAssigneeMap();

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of Object.values(cards)) {
      for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) =>
      b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [cards]);

  const priorityCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const c of Object.values(cards)) {
      counts[c.priority] = (counts[c.priority] ?? 0) + 1;
    }
    return counts;
  }, [cards]);

  const myTaskCount = useMemo(
    () => Object.values(cards).filter((c) => c.assignee === userUuid).length,
    [cards, userUuid],
  );

  const teammatesInUse = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of Object.values(cards)) {
      if (c.assignee && c.assignee !== userUuid) {
        counts.set(c.assignee, (counts.get(c.assignee) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([uuid, count]) => ({
        uuid,
        count,
        name: assigneeMap[uuid]?.name ?? "Unknown",
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [cards, assigneeMap, userUuid]);

  const pick = (v: View) => {
    setView(v);
    setSidebar(false);
  };

  const initials = (userName || "You")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <aside>
      <div className="brand">
        <span className="brand-name">Railcode Roadmap</span>
      </div>

      <button className="new-btn" onClick={openPalette}>
        <IconPlus />
        <span>New card</span>
        <kbd className="kbd">⌘K</kbd>
      </button>

      <nav className="nav-group">
        <div className="eyebrow">Views</div>
        <button
          className={`nav-item${view === "board" ? " active" : ""}`}
          onClick={() => pick("board")}
        >
          <IconBoard />
          <span>Board</span>
        </button>
        <button
          className={`nav-item${view === "list" ? " active" : ""}`}
          onClick={() => pick("list")}
        >
          <IconList />
          <span>List</span>
        </button>
      </nav>

      <div className="side-scroll">
        <nav className="nav-group">
          <div className="eyebrow">
            <span>Priority</span>
            {priorityFilter.length > 0 && (
              <button className="link-btn" onClick={clearPriorityFilter}>
                Clear
              </button>
            )}
          </div>
          <div className="tag-list">
            {PRIORITIES.map((p) => {
              const active = priorityFilter.includes(p);
              return (
                <button
                  key={p}
                  className={`nav-item tag-nav${active ? " active" : ""}`}
                  onClick={() => togglePriorityFilter(p)}
                >
                  <PriorityBadge priority={p} />
                  <span className="tag-nav-label">{PRIORITY_DESC[p]}</span>
                  <span className="count tab">{priorityCounts[p] ?? 0}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <nav className="nav-group">
          <div className="eyebrow">
            <span>Assigned to</span>
            {assigneeFilter.length > 0 && (
              <button className="link-btn" onClick={clearAssigneeFilter}>
                Clear
              </button>
            )}
          </div>
          <div className="tag-list">
            {userUuid && (
              <button
                className={`nav-item tag-nav${assigneeFilter.includes(userUuid) ? " active" : ""}`}
                onClick={() => toggleAssigneeFilter(userUuid)}
              >
                <span className="avatar xs">
                  {assigneeInitials(userName || "You")}
                </span>
                <span className="tag-nav-label">Assigned to me</span>
                <span className="count tab">{myTaskCount}</span>
              </button>
            )}
            {teammatesInUse.map(({ uuid, count, name }) => {
              const active = assigneeFilter.includes(uuid);
              return (
                <button
                  key={uuid}
                  className={`nav-item tag-nav${active ? " active" : ""}`}
                  onClick={() => toggleAssigneeFilter(uuid)}
                >
                  <span className="avatar xs">{assigneeInitials(name)}</span>
                  <span className="tag-nav-label">{name}</span>
                  <span className="count tab">{count}</span>
                </button>
              );
            })}
          </div>
          {teammatesInUse.length === 0 && (
            <p className="side-empty">Cards assigned to teammates show up here.</p>
          )}
        </nav>

        <nav className="nav-group">
          <div className="eyebrow">
            <span>Tags</span>
            {tagFilter.length > 0 && (
              <button className="link-btn" onClick={clearTagFilter}>
                Clear
              </button>
            )}
          </div>
          {tags.length === 0 && (
            <p className="side-empty">Tags you add to cards show up here.</p>
          )}
          <div className="tag-list">
            {tags.map(([tag, count]) => {
              const active = tagFilter.includes(tag);
              return (
                <button
                  key={tag}
                  className={`nav-item tag-nav${active ? " active" : ""}`}
                  onClick={() => toggleTagFilter(tag)}
                >
                  <span className={`led ${tagTone(tag)}`} />
                  <span className="tag-nav-label">{tag}</span>
                  <span className="count tab">{count}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      <div className="side-foot">
        <div className="avatar">{initials || "?"}</div>
        <div className="side-foot-txt">
          <div className="side-foot-name">{userName || "You"}</div>
          {userEmail && <div className="side-foot-sub">{userEmail}</div>}
        </div>
      </div>
      <button className="side-tag-hint" onClick={openPalette}>
        <IconTag />
        <span>Tip: type “p1 #bug fix crash” in ⌘K</span>
      </button>
    </aside>
  );
}
