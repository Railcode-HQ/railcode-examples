import { useEffect, useState } from "react";
import {
  AlertCircle,
  Bell,
  Download,
  FileText,
  Presentation,
} from "lucide-react";

import { FORMAT_LABEL, Notification } from "@/lib/automations";
import { timeAgo } from "@/lib/crm";
import {
  fileUrl,
  notifications,
  useAutomationStore,
} from "@/store/automation-store";
import { useCrmStore } from "@/store/crm-store";

export function Notifications() {
  const { artifacts, runs, notifState, markRead } = useAutomationStore();
  const { deals, openRecord } = useCrmStore();

  const items = notifications(artifacts, runs, notifState);

  // Opening the page counts as reading: everything unread is marked so the
  // sidebar badge clears, while `fresh` keeps the highlight for this visit so
  // it's still obvious what just arrived.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const unseen = items.filter((n) => !n.read).map((n) => n.id);
    if (!unseen.length) return;
    setFresh((prev) => new Set([...prev, ...unseen]));
    void markRead(unseen);
  }, [items, markRead]);

  const isNew = (n: Notification) => !n.read || fresh.has(n.id);
  const newCount = items.filter(isNew).length;

  return (
    <>
      <div className="phead">
        <div>
          <h1>Notifications</h1>
          <p>
            {newCount
              ? `${newCount} new ${newCount === 1 ? "item" : "items"}`
              : "Documents your automations produced, and anything that went wrong."}
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="sect emptystate">
          <span className="glyph lg">
            <Bell />
          </span>
          <h3>Nothing yet</h3>
          <p className="faint">
            When an automation finishes a document it shows up here, ready to
            download. Failed runs land here too, with the reason.
          </p>
        </div>
      ) : (
        <div className="sect">
          <div className="rows notiflist">
            {items.map((n) => (
              <Row
                key={n.id}
                notification={n}
                isNew={isNew(n)}
                dealTitle={deals.find((d) => d.id === n.dealId)?.title}
                onOpenDeal={() => {
                  if (deals.some((d) => d.id === n.dealId)) openRecord("deal", n.dealId);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Row({
  notification: n,
  isNew,
  dealTitle,
  onOpenDeal,
}: {
  notification: Notification;
  isNew: boolean;
  dealTitle?: string;
  onOpenDeal: () => void;
}) {
  const failed = n.kind === "failure";
  return (
    <div className={`crow notifrow${isNew ? " unread" : ""}`}>
      <span className={`glyph${failed ? " fail" : " dl"}`} style={{ width: 30, height: 30 }}>
        {failed ? (
          <AlertCircle size={15} />
        ) : n.format === "pptx" ? (
          <Presentation size={15} />
        ) : (
          <FileText size={15} />
        )}
      </span>

      <div className="body">
        <div className="cname" style={{ fontSize: 13 }}>
          {isNew ? <span className="unreaddot" aria-label="New" /> : null}
          {n.title}
        </div>
        <div className="meta notifbody">{n.body}</div>
        <div className="meta">
          <button className="link" onClick={onOpenDeal}>
            {dealTitle ?? "Deal"}
          </button>
          {n.format ? ` · ${FORMAT_LABEL[n.format]}` : ""}
          {` · ${timeAgo(n.at)}`}
        </div>
      </div>

      {n.fileName ? (
        <a className="btn ghost sm" href={fileUrl(n.fileName)} download>
          <Download size={14} />
          Download
        </a>
      ) : null}
    </div>
  );
}
