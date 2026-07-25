import { useMemo, useState, type KeyboardEvent } from "react";
import { CloseIcon, PencilIcon, PinIcon, PlusIcon, SearchIcon, TrashIcon } from "./Icons";
import { useChatStore } from "@/store/chat-store";
import type { Conversation } from "@/lib/types";

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Group by recency the way every chat app does — it makes a long history
 *  scannable without a date column. */
function bucketOf(conv: Conversation): string {
  if (conv.pinned) return "Pinned";
  const today = startOfDay(new Date());
  const updated = new Date(conv.updatedAt).getTime();
  if (updated >= today) return "Today";
  if (updated >= today - 86_400_000) return "Yesterday";
  if (updated >= today - 7 * 86_400_000) return "Previous 7 days";
  if (updated >= today - 30 * 86_400_000) return "Previous 30 days";
  return "Older";
}

const BUCKET_ORDER = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

function ConversationItem({ conv }: { conv: Conversation }) {
  const activeId = useChatStore((s) => s.activeId);
  const select = useChatStore((s) => s.selectConversation);
  const rename = useChatStore((s) => s.renameConversation);
  const remove = useChatStore((s) => s.deleteConversation);
  const togglePin = useChatStore((s) => s.togglePin);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conv.title);
  const [confirming, setConfirming] = useState(false);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== conv.title) void rename(conv.id, draft);
    else setDraft(conv.title);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
    if (event.key === "Escape") {
      setDraft(conv.title);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="conv editing">
        <input
          className="conv-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          aria-label="Conversation title"
        />
      </div>
    );
  }

  return (
    <div className={`conv${conv.id === activeId ? " active" : ""}`}>
      <button type="button" className="conv-main" onClick={() => void select(conv.id)}>
        <span className="conv-title">{conv.title}</span>
        {conv.preview ? <span className="conv-preview">{conv.preview}</span> : null}
      </button>

      {confirming ? (
        <div className="conv-confirm">
          <button
            type="button"
            className="danger-btn"
            onClick={() => {
              setConfirming(false);
              void remove(conv.id);
            }}
          >
            Delete
          </button>
          <button type="button" className="ghost-btn" onClick={() => setConfirming(false)}>
            <CloseIcon size={12} />
          </button>
        </div>
      ) : (
        <div className="conv-actions">
          <button
            type="button"
            className={`icon-btn tiny${conv.pinned ? " on" : ""}`}
            onClick={() => void togglePin(conv.id)}
            title={conv.pinned ? "Unpin" : "Pin"}
            aria-label={conv.pinned ? "Unpin conversation" : "Pin conversation"}
          >
            <PinIcon size={13} />
          </button>
          <button
            type="button"
            className="icon-btn tiny"
            onClick={() => setEditing(true)}
            title="Rename"
            aria-label="Rename conversation"
          >
            <PencilIcon size={13} />
          </button>
          <button
            type="button"
            className="icon-btn tiny"
            onClick={() => setConfirming(true)}
            title="Delete"
            aria-label="Delete conversation"
          >
            <TrashIcon size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const conversations = useChatStore((s) => s.conversations);
  const order = useChatStore((s) => s.order);
  const search = useChatStore((s) => s.search);
  const setSearch = useChatStore((s) => s.setSearch);
  const newConversation = useChatStore((s) => s.newConversation);
  const userName = useChatStore((s) => s.userName);
  const userEmail = useChatStore((s) => s.userEmail);

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = order
      .map((id) => conversations[id])
      .filter((conv): conv is Conversation => Boolean(conv))
      .filter((conv) =>
        term
          ? conv.title.toLowerCase().includes(term) || conv.preview.toLowerCase().includes(term)
          : true,
      );

    const map = new Map<string, Conversation[]>();
    for (const conv of list) {
      const bucket = bucketOf(conv);
      const existing = map.get(bucket);
      if (existing) existing.push(conv);
      else map.set(bucket, [conv]);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => [b, map.get(b)!] as const);
  }, [conversations, order, search]);

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button type="button" className="new-btn" onClick={newConversation}>
          <PlusIcon size={15} />
          <span>New chat</span>
        </button>

        <div className="search">
          <SearchIcon size={14} />
          <input
            className="search-input"
            placeholder="Search chats"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search conversations"
          />
          {search ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <CloseIcon size={12} />
            </button>
          ) : null}
        </div>
      </div>

      <nav className="conv-list">
        {groups.length === 0 ? (
          <p className="conv-none">{search ? "No matching chats." : "No chats yet."}</p>
        ) : (
          groups.map(([bucket, list]) => (
            <section className="conv-group" key={bucket}>
              <h2 className="conv-bucket">{bucket}</h2>
              {list.map((conv) => (
                <ConversationItem conv={conv} key={conv.id} />
              ))}
            </section>
          ))
        )}
      </nav>

      <div className="sidebar-foot">
        <div className="who">
          <div className="who-name">{userName}</div>
          {userEmail ? <div className="who-mail">{userEmail}</div> : null}
        </div>
      </div>
    </aside>
  );
}
