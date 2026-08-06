import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble.jsx";

export default function MessageList({
  messages = [],
  scenario = null,
  isAiTyping = false,
  streamingAssistantText = "",
  greeting = null,
  animateId = null,
}) {
  const containerRef = useRef(null);
  const userScrolledRef = useRef(false);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledRef.current = !atBottom;
  };

  const scrollToBottom = () => {
    if (!userScrolledRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    if (!userScrolledRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages.length, isAiTyping, streamingAssistantText]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="conv-messages"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "24px 20px 8px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 820,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
      {greeting && messages.length === 0 && (
        <div
          style={{
            padding: "18px 22px",
            background: "var(--ink-2)",
            borderRadius: 14,
            border: "1px solid var(--whisper-2)",
            borderLeft: "3px solid var(--gold)",
            marginBottom: 12,
            animation: "fadeUp 500ms cubic-bezier(.2,.7,.2,1) both",
          }}
        >
          <div
            style={{
              fontFamily: "'Fraunces', serif",
              fontSize: 15,
              fontWeight: 500,
              color: "var(--bone)",
              lineHeight: 1.6,
            }}
          >
            {greeting}
          </div>
        </div>
      )}

      {scenario && messages.length === 0 && !greeting && (
        <div
          style={{
            padding: "18px 22px",
            background: "var(--ink-2)",
            borderRadius: 14,
            border: "1px solid var(--whisper-2)",
            borderLeft: "3px solid var(--gold)",
            marginBottom: 12,
            animation: "fadeUp 500ms cubic-bezier(.2,.7,.2,1) both",
          }}
        >
          <div
            style={{
              fontFamily: "'Fraunces', serif",
              fontSize: 17,
              fontWeight: 500,
              color: "var(--bone)",
              marginBottom: 6,
            }}
          >
            {scenario.title}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--bone-dim)",
              lineHeight: 1.6,
              marginBottom: 10,
            }}
          >
            {scenario.description}
          </div>
        </div>
      )}

      {scenario && messages.length > 0 && (
        <div
          style={{
            padding: "8px 14px",
            background: "var(--ink-2)",
            borderRadius: 8,
            borderLeft: "2px solid var(--gold)",
            marginBottom: 6,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--bone-faint)",
          }}
        >
          <span style={{ fontFamily: "'Fraunces', serif", color: "var(--bone-dim)" }}>
            {scenario.title}
          </span>
          <span style={{ opacity: 0.3 }}>·</span>
          <span>with {scenario.persona}</span>
        </div>
      )}

      {messages.map((msg, i) => (
        <MessageBubble
          key={msg.id || i}
          message={msg}
          index={i}
          animate={msg.role === "assistant" && msg.id != null && msg.id === animateId}
          onType={scrollToBottom}
        />
      ))}

      {streamingAssistantText && (
        <MessageBubble
          message={{
            role: "assistant",
            content: streamingAssistantText,
            draft: true,
            inputType: "text",
          }}
          index={messages.length}
        />
      )}

      {isAiTyping && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-start",
            animation: "fadeUp 300ms cubic-bezier(.2,.7,.2,1) both",
          }}
        >
          <div
            style={{
              padding: "12px 18px",
              background: "var(--ink-2)",
              borderRadius: 16,
              borderBottomLeftRadius: 4,
              display: "flex",
              gap: 5,
              alignItems: "center",
            }}
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--gold)",
                  opacity: 0.5,
                  animation: `typingDot 1.4s ease-in-out ${i * 0.16}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
