import { ChartIcon, DatabaseIcon } from "./Icons";
import { useChatStore } from "@/store/chat-store";

/** Suggestions are the fastest way to show what the app can do. These are
 *  written against the demo support dataset — swap them when you point the app
 *  at your own sources. */
const SUGGESTIONS: { icon: "db" | "chart"; text: string }[] = [
  { icon: "db", text: "Which customers are at SLA risk right now?" },
  { icon: "db", text: "Compare ticket volume and average resolution time by channel" },
  { icon: "db", text: "Which support agents are overloaded this week?" },
  { icon: "db", text: "How does customer satisfaction differ by plan?" },
  { icon: "chart", text: "What are the top referrers in our product analytics?" },
];

export function EmptyState() {
  const send = useChatStore((s) => s.send);
  const userName = useChatStore((s) => s.userName);
  const firstName = userName.split(/\s+/)[0] || userName;

  return (
    <div className="empty">
      <div className="empty-inner">
        <div className="empty-mark" aria-hidden="true" />
        <h1 className="empty-title">Hello, {firstName}</h1>
        <p className="empty-sub">
          Ask a question and I'll query your connected sources to answer it. You'll see every
          query I run.
        </p>

        <div className="suggestions">
          {SUGGESTIONS.map((item) => (
            <button
              type="button"
              className="suggestion"
              key={item.text}
              onClick={() => void send(item.text)}
            >
              <span className="suggestion-icon">
                {item.icon === "db" ? <DatabaseIcon size={14} /> : <ChartIcon size={14} />}
              </span>
              <span>{item.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
