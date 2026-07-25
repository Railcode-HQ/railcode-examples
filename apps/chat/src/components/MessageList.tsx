import { useEffect, useRef } from "react";
import { MessageRow } from "./Message";
import { useChatStore } from "@/store/chat-store";
import type { Message } from "@/lib/types";

/** Auto-scroll that respects the reader: it follows new output only while the
 *  user is already near the bottom, so scrolling up to re-read an earlier answer
 *  isn't yanked back down by the stream. */
const STICK_THRESHOLD_PX = 120;

export function MessageList() {
  const activeId = useChatStore((s) => s.activeId);
  const messages = useChatStore((s) => (s.activeId ? s.messages[s.activeId] : undefined));
  const stream = useChatStore((s) => s.stream);
  const userName = useChatStore((s) => s.userName);
  const loading = useChatStore((s) => s.loadingMessages);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const streamContent = stream?.content ?? "";
  const streamSteps = stream?.steps.length ?? 0;
  const count = messages?.length ?? 0;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !stickRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [count, streamContent, streamSteps, activeId]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickRef.current = distance < STICK_THRESHOLD_PX;
  };

  // Reset stickiness when switching conversations.
  useEffect(() => {
    stickRef.current = true;
  }, [activeId]);

  const streamingMessage: Message | null = stream
    ? {
        id: stream.messageId,
        convId: stream.convId,
        seq: -1,
        role: "assistant",
        content: stream.content,
        createdAt: new Date().toISOString(),
        attachments: [],
        steps: stream.steps,
        error: null,
        model: null,
        usage: null,
      }
    : null;

  return (
    <div className="thread" ref={scrollRef} onScroll={onScroll}>
      <div className="thread-inner">
        {loading && count === 0 ? <div className="thread-loading">Loading conversation…</div> : null}

        {(messages ?? []).map((message) => (
          <MessageRow key={message.id} message={message} userName={userName} />
        ))}

        {streamingMessage ? (
          <MessageRow message={streamingMessage} userName={userName} streaming />
        ) : null}
      </div>
    </div>
  );
}
