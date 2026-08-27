"use client";

// One home for the three floating tools (bottom-right). Desktop: an always-visible
// vertical rail of icons (pigeon → friends → assistant). Mobile: a slide-out handle that
// reveals the same icons. Picking one opens that tool's panel; only one is ever open.
import { useEffect, useState } from "react";
import FeedbackWidget from "./FeedbackWidget";
import ChatWidget from "./ChatWidget";
import AssistantWidget from "./AssistantWidget";

type Tool = "feedback" | "friends" | "assistant";

export default function Dock() {
  const [active, setActive] = useState<Tool | null>(null);
  const [expanded, setExpanded] = useState(false);          // mobile slide-out
  const [friends, setFriends] = useState<{ member: boolean; unread: number; username?: string }>({ member: false, unread: 0 });

  const open = (t: Tool) => { setActive(t); setExpanded(false); };
  const close = () => setActive(null);

  // A "Message" button anywhere (e.g. a profile) opens the chat panel.
  useEffect(() => {
    const onOpenChat = () => { setActive("friends"); setExpanded(false); };
    window.addEventListener("ss:open-chat", onOpenChat);
    return () => window.removeEventListener("ss:open-chat", onOpenChat);
  }, []);

  return (
    <>
      {/* Panels stay mounted (ChatWidget keeps its realtime subscription + unread alive);
          each renders only while it is the active tool. */}
      <FeedbackWidget open={active === "feedback"} onClose={close} />
      <ChatWidget open={active === "friends"} onClose={close} onMeta={setFriends} />
      <AssistantWidget open={active === "assistant"} onClose={close} />

      {/* The launcher rail / handle — hidden while a panel is open (the panel has its own close). */}
      {active === null && (
        <div className={expanded ? "dock dock--expanded" : "dock"}>
          <button
            className="dock__handle"
            aria-label={expanded ? "Close tools" : "Open tools"}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "✕" : "⋯"}
          </button>
          <div className="dock__icons">
            {friends.member && friends.username && (
              <a className="dock__ic dock__ic--profile" data-label="View my profile" aria-label="View my profile" href={`/u/${friends.username}`}>
                <span aria-hidden="true">👤</span>
              </a>
            )}
            <button className="dock__ic dock__ic--pigeon" data-label="Message Us" aria-label="Message Us" onClick={() => open("feedback")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/pigeon.png" alt="" className="dock__icimg" width={52} height={52}
                style={{ objectPosition: "72% 40%" }} />
            </button>
            {friends.member && (
              <button className="dock__ic dock__ic--friends" data-label="Friends" aria-label="Friends" onClick={() => open("friends")}>
                <span aria-hidden="true">💬</span>
                {friends.unread > 0 && <span className="dock__badge">{friends.unread > 9 ? "9+" : friends.unread}</span>}
              </button>
            )}
            <button className="dock__ic dock__ic--asst" data-label="AI Slip Assistant" aria-label="AI Slip Assistant" onClick={() => open("assistant")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/chatbot-icon.png?v=3" alt="" className="dock__icimg" width={52} height={52} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
