import { MessageAttachments } from "./Attachments";
import { ToolCard } from "./ToolCard";
import { AlertIcon } from "./Icons";
import { renderMarkdown } from "@/lib/markdown";
import type { Message, ToolStep } from "@/lib/types";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Meta({ message }: { message: Message }) {
  const bits: string[] = [];
  if (message.model) bits.push(message.model);
  if (message.usage) bits.push(`${message.usage.totalTokens.toLocaleString()} tokens`);
  if (bits.length === 0) return null;
  return <div className="msg-meta mono">{bits.join(" · ")}</div>;
}

/** One turn. The assistant turn renders tool cards above the prose, in the order
 *  they ran, so the transcript reads as work-then-conclusion. */
export function MessageRow({
  message,
  userName,
  streaming = false,
}: {
  message: Message;
  userName: string;
  streaming?: boolean;
}) {
  const isUser = message.role === "user";
  const hasBody = message.content.trim().length > 0;

  return (
    <article className={`msg ${isUser ? "user" : "assistant"}`}>
      <div className="msg-avatar" aria-hidden="true">
        {isUser ? initials(userName) : <span className="bot-mark" />}
      </div>

      <div className="msg-main">
        <div className="msg-who">{isUser ? userName : "Assistant"}</div>

        {isUser ? (
          <>
            {hasBody ? <div className="msg-text user-text">{message.content}</div> : null}
            <MessageAttachments attachments={message.attachments} />
          </>
        ) : (
          <>
            {message.steps.length > 0 ? (
              <div className="tool-stack">
                {message.steps.map((step: ToolStep) => (
                  <ToolCard key={step.id} step={step} />
                ))}
              </div>
            ) : null}

            {hasBody ? (
              <div className="msg-text prose">
                {renderMarkdown(message.content)}
                {streaming ? <span className="caret" aria-hidden="true" /> : null}
              </div>
            ) : streaming ? (
              <div className="thinking">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            ) : null}

            {message.error ? (
              <div className="msg-error">
                <AlertIcon size={14} />
                <span>{message.error}</span>
              </div>
            ) : null}

            {!streaming ? <Meta message={message} /> : null}
          </>
        )}
      </div>
    </article>
  );
}
