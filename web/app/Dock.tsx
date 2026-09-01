"use client";

// One home for the three floating tools (bottom-right). Desktop: an always-visible
// vertical rail of icons (pigeon → friends → assistant). Mobile: a slide-out handle that
// reveals the same icons. Picking one opens that tool's panel; only one is ever open.
import { useEffect, useRef, useState } from "react";
import FeedbackWidget from "./FeedbackWidget";
import ChatWidget from "./ChatWidget";
import AssistantWidget from "./AssistantWidget";

type Tool = "feedback" | "friends" | "assistant";

export default function Dock() {
  const [active, setActive] = useState<Tool | null>(null);
  const [expanded, setExpanded] = useState(false);          // mobile slide-out
  const [friends, setFriends] = useState<{ member: boolean; unread: number; requests: number; username?: string; avatarUrl?: string | null; role?: string }>({ member: false, unread: 0, requests: 0 });
  // "What's awaiting me" — friend requests for everyone, plus beta approvals + flagged posts for
  // founders/admins. Polled from /api/awaiting; drives the master badge on the profile avatar.
  const [awaiting, setAwaiting] = useState<{ friendRequests: number; betaRequests: number; reports: number }>({ friendRequests: 0, betaRequests: 0, reports: 0 });
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);

  // Close the notifications dropdown on outside click / Escape.
  useEffect(() => {
    if (!notifOpen) return;
    const onDoc = (e: MouseEvent) => { if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNotifOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [notifOpen]);

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
    const onOpenFb = () => { setActive("feedback"); setExpanded(false); };
    window.addEventListener("ss:open-chat", onOpenChat);
    window.addEventListener("ss:open-assistant", onOpenAsst);
    window.addEventListener("ss:open-feedback", onOpenFb);
    return () => {
      window.removeEventListener("ss:open-chat", onOpenChat);
      window.removeEventListener("ss:open-assistant", onOpenAsst);
      window.removeEventListener("ss:open-feedback", onOpenFb);
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
                const avatar = friends.avatarUrl
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={friends.avatarUrl} alt="" className="dock__icimg" />
                  : <span aria-hidden="true">👤</span>;
                const badge = total > 0 && <span className="dock__badge dock__badge--profile">{total > 9 ? "9+" : total}</span>;

                // The avatar always opens the notifications dropdown (so it's always reachable);
                // a bold green ring marks that you're online. The badge shows only when something
                // is actually waiting.
                return (
                  <div className="dock__profwrap" ref={notifRef}>
                    <button type="button" className="dock__ic dock__ic--profile is-online" data-label={total > 0 ? label : "Notifications"}
                      aria-haspopup="menu" aria-expanded={notifOpen}
                      aria-label={total > 0 ? `Notifications — awaiting: ${bits.join(", ")}` : "Notifications — all caught up"}
                      onClick={() => setNotifOpen((v) => !v)}>
                      {avatar}{badge}
                    </button>
                    {notifOpen && (
                      <div className="docknotif" role="menu" aria-label="Notifications">
                        <div className="docknotif__hd">What&apos;s waiting</div>
                        {total === 0 && <div className="docknotif__empty">You&apos;re all caught up ✓</div>}
                        {awaiting.betaRequests > 0 && (
                          <a role="menuitem" className="docknotif__item" href="/admin/members" onClick={() => setNotifOpen(false)}>
                            <span className="docknotif__ic" aria-hidden="true">🪪</span>
                            <span className="docknotif__lbl">Beta access requests</span>
                            <span className="docknotif__n">{awaiting.betaRequests}</span>
                          </a>
                        )}
                        {awaiting.reports > 0 && (
                          <a role="menuitem" className="docknotif__item" href="/forum/reports" onClick={() => setNotifOpen(false)}>
                            <span className="docknotif__ic" aria-hidden="true">🚩</span>
                            <span className="docknotif__lbl">Flagged posts to review</span>
                            <span className="docknotif__n">{awaiting.reports}</span>
                          </a>
                        )}
                        {awaiting.friendRequests > 0 && (
                          <button type="button" role="menuitem" className="docknotif__item"
                            onClick={() => { setNotifOpen(false); open("friends"); }}>
                            <span className="docknotif__ic" aria-hidden="true">🤝</span>
                            <span className="docknotif__lbl">Friend requests</span>
                            <span className="docknotif__n">{awaiting.friendRequests}</span>
                          </button>
                        )}
                        {friends.unread > 0 && (
                          <button type="button" role="menuitem" className="docknotif__item"
                            onClick={() => { setNotifOpen(false); open("friends"); }}>
                            <span className="docknotif__ic" aria-hidden="true">💬</span>
                            <span className="docknotif__lbl">Unread messages</span>
                            <span className="docknotif__n">{friends.unread}</span>
                          </button>
                        )}
                        <a role="menuitem" className="docknotif__item docknotif__item--profile" href={`/u/${friends.username}`} onClick={() => setNotifOpen(false)}>
                          <span className="docknotif__ic" aria-hidden="true">👤</span>
                          <span className="docknotif__lbl">View my profile</span>
                        </a>
                      </div>
                    )}
                  </div>
                );
              })()}
            {friends.member && (
              <a className="dock__ic dock__ic--dash" data-label="My Dashboard" aria-label="My Dashboard" href="/dashboard">
                <span aria-hidden="true">🗂️</span>
              </a>
            )}
            {friends.member && friends.role === "founder" && (
              <a className="dock__ic dock__ic--creator" data-label="Creator Dashboard" aria-label="Creator Dashboard" href="/creator">
                <span aria-hidden="true">👑</span>
              </a>
            )}
            {friends.member && (
              <button className="dock__ic dock__ic--slip" data-label="Saved Slips" aria-label="Saved Slips"
                onClick={() => { try { window.dispatchEvent(new CustomEvent("ss:open-slip")); } catch { /* SSR */ } }}>
                <span aria-hidden="true">🎟️</span>
              </button>
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
