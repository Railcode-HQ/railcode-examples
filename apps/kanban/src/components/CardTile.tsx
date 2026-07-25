import { useStore } from "../store";
import type { Card } from "../types";
import { PriorityBadge, TagChip, relativeTime } from "./bits";
import { AssigneeAvatar } from "./AssigneeControls";
import { IconGrip, IconPaperclip } from "./icons";

export function CardTile({
  card,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  card: Card;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const openDrawer = useStore((s) => s.openDrawer);
  const flashId = useStore((s) => s.flashCardId);

  return (
    <article
      className={`card${dragging ? " dragging" : ""}${flashId === card.id ? " flash" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => openDrawer(card.id)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") openDrawer(card.id);
      }}
    >
      <div className="card-top">
        <PriorityBadge priority={card.priority} />
        <span className="card-top-right">
          <AssigneeAvatar uuid={card.assignee} size="xs" />
          <span className="card-grip">
            <IconGrip />
          </span>
        </span>
      </div>
      <div className="card-title">{card.title}</div>
      {card.description && (
        <div className="card-desc">{card.description}</div>
      )}
      {card.tags.length > 0 && (
        <div className="card-tags">
          {card.tags.map((t) => (
            <TagChip key={t} tag={t} />
          ))}
        </div>
      )}
      <div className="card-foot">
        {card.status === "done" && card.done_at ? (
          <span className="card-meta">Done {relativeTime(card.done_at)}</span>
        ) : (
          <span className="card-meta">Created {relativeTime(card.created_at)}</span>
        )}
        {card.attachments.length > 0 && (
          <span className="card-attach">
            <IconPaperclip />
            {card.attachments.length}
          </span>
        )}
      </div>
    </article>
  );
}
