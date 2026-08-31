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
  const [friends, setFriends] = useState<{ member: boolean; unread: number; requests: number; username?: string; avatarUrl?: string | null }>({ member: false, unread: 0, requests: 0 });
  // "What's awaiting me" — friend requests for everyone, plus beta approvals + flagged posts for
  // founders/admins. Polled from /api/awaiting; drives the master badge on the profile avatar.
  const [awaiting, setAwaiting] = useState<{ friendRequests: number; betaRequests: number; reports: number }>({ friendRequests: 0, betaRequests: 0, reports: 0 });

  useEffect(() => {
    if (!friends.member) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/awaiting", { cache: "no-store" });
        const j = await r.json();
        if (alive) setAwaiting({ friendRequests: j.friendRequests ?? 0, betaRequests: j.betaRequests ?? 0, reports: j.reports ?? 0 });
      } catch { /* offline — keep last counts */ }
    };
    load();
    const iv = setInterval(load, 60000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, [friends.member]);

  const open = (t: Tool) => { setActive(t); setExpanded(false); };
  const close = () => setActive(null);

  // A "Message" button anywhere (e.g. a profile) opens the chat panel; the dashboard robot
  // (and any "ask the assistant" control) opens the AI Slip Assistant panel.
  useEffect(() => {
    const onOpenChat = () => { setActive("friends"); setExpanded(false); };
    const onOpenAsst = () => { setActive("assistant"); setExpanded(false); };
    window.addEventListener("ss:open-chat", onOpenChat);
    window.addEventListener("ss:open-assistant", onOpenAsst);
    return () => {
      window.removeEventListener("ss:open-chat", onOpenChat);
      window.removeEventListener("ss:open-assistant", onOpenAsst);
    };
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
            {friends.member && friends.username && (() => {
                // Master "awaiting me" total on the profile avatar: unread messages + friend
                // requests + (founder) beta approvals + flagged posts. The tooltip spells out
                // exactly what's waiting so it's clear at a glance.
                const bits: string[] = [];
                const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
                if (friends.unread > 0) bits.push(plural(friends.unread, "unread message"));
                if (awaiting.friendRequests > 0) bits.push(plural(awaiting.friendRequests, "friend request"));
                if (awaiting.betaRequests > 0) bits.push(plural(awaiting.betaRequests, "beta request"));
                if (awaiting.reports > 0) bits.push(plural(awaiting.reports, "flagged post"));
                const total = friends.unread + awaiting.friendRequests + awaiting.betaRequests + awaiting.reports;
                const label = bits.length ? bits.join(" · ") : "View my profile";
                return (
                  <a className="dock__ic dock__ic--profile" data-label={label}
                    aria-label={total > 0 ? `View my profile — awaiting: ${bits.join(", ")}` : "View my profile"}
                    href={`/u/${friends.username}`}>
                    {friends.avatarUrl
                      ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={friends.avatarUrl} alt="" className="dock__icimg" />
                      : <span aria-hidden="true">👤</span>}
                    {total > 0 && <span className="dock__badge dock__badge--profile">{total > 9 ? "9+" : total}</span>}
                  </a>
                );
              })()}
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
