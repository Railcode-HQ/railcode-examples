import { ArrowUp, Plus, Sparkles, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { AskTurn } from "@/components/AskMessage";
import { AskMessage } from "@/lib/ask";
import { shortModelName } from "@/lib/ask-agent";
import { useAskStore } from "@/store/ask-store";
import { useCrmStore } from "@/store/crm-store";

const SUGGESTIONS = [
  "How's my pipeline doing?",
  "Which deals have gone quiet?",
  "What's overdue right now?",
  "Break down open pipeline by company",
  "Summarize my most recent call",
];

const MAX_COMPOSER_PX = 200;

export function AskAi() {
  const {
    messages,
    stream,
    approvals,
    busy,
    model,
    init,
    send,
    stop,
    reset,
    error,
    dismissError,
  } = useAskStore();
  const identity = useCrmStore((s) => s.identity);

  const [value, setValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Grow with content up to a cap, then scroll internally.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_COMPOSER_PX)}px`;
  }, [value]);

  // Follow the stream, but stop following the moment the reader scrolls up to
  // re-read something — nothing is more annoying than being yanked back down.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !pinned.current) return;
    // Don't scroll while the reader is selecting text in the transcript, or the
    // re-anchor clobbers the selection mid-drag and copying becomes impossible.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && node.contains(sel.anchorNode)) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, stream, approvals]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
  };

  const submit = (text?: string) => {
    const question = (text ?? value).trim();
    if (!question || busy) return;
    setValue("");
    pinned.current = true;
    void send(question);
  };

  const streamingMessage: AskMessage | null = stream
    ? {
        id: stream.messageId,
        role: "assistant",
        content: stream.content,
        createdAt: "",
        steps: stream.steps,
        error: null,
        note: null,
      }
    : null;

  // Approvals nothing has claimed yet still have to be decidable.
  const claimed = new Set(
    (stream?.steps ?? []).map((s) => s.approvalId).filter((id): id is string => Boolean(id)),
  );
  const orphanApprovals = approvals.filter((a) => a.status === "pending" && !claimed.has(a.id));

  const empty = messages.length === 0 && !stream;
  const firstName = identity?.user.name?.split(/\s+/)[0];

  return (
    <div className="askpage">
      <div className="askhead">
        <div className="askhead-t">
          <Sparkles size={15} />
          <span>Ask AI</span>
          <span className="askhead-model mono" title="Model answering your questions">
            {shortModelName(model)}
          </span>
        </div>
        <div className="spacer" />
        {messages.length > 0 ? (
          <button className="btn ghost sm" onClick={reset} disabled={busy}>
            <Plus size={14} />
            New chat
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="banner askbanner">
          <span>{error}</span>
          <button className="link" style={{ color: "inherit" }} onClick={dismissError}>
            <X size={14} />
          </button>
        </div>
      ) : null}

      <div className="askscroll" ref={scrollRef} onScroll={onScroll}>
        <div className="askthread">
          {empty ? (
            <div className="askempty">
              <span className="askempty-glyph">
                <Sparkles size={20} />
              </span>
              <h2>{firstName ? `Hi ${firstName} — what do you need?` : "What do you need?"}</h2>
              <p>
                Ask about anything in the CRM, or tell me what to change. I'll show you
                what I'm doing, and check with you before saving anything.
              </p>
              <div className="asksuggest">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => submit(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <AskTurn key={message.id} message={message} />
          ))}

          {streamingMessage ? (
            <AskTurn
              message={streamingMessage}
              streaming
              orphanApprovals={orphanApprovals}
            />
          ) : null}
        </div>
      </div>

      <div className="askfoot">
        <div className="askcomposer">
          <textarea
            ref={textareaRef}
            value={value}
            rows={1}
            placeholder="Ask about your pipeline, or tell me what to change…"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {busy ? (
            <button className="asksend stop" onClick={stop} title="Stop">
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              className="asksend"
              onClick={() => submit()}
              disabled={!value.trim()}
              title="Send"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        <div className="askhint">
          Writes wait for your approval · Enter to send, Shift+Enter for a new line
        </div>
      </div>
    </div>
  );
}
