"use client";

// Facebook-style quick-access sidebar down the LEFT margin — on desktop this REPLACES the bottom-
// right Dock bubble (the Dock is hidden ≥1100px and carries the same tools on phones). Labeled
// icon+text rows for the member's whole space: Profile, Notifications, My Dashboard, the AI Slip
// Assistant, Friends, Saved Slips, Chat, and Message Us. It opens the same panels the Dock does via
// window events, and shows the same online ring + notification counts. Signed-out visitors / embeds
// don't see it.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const fire = (name: string) => { try { window.dispatchEvent(new CustomEvent(name)); } catch { /* SSR */ } };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export default function LeftRail() {
  const [me, setMe] = useState<{ username: string; avatarUrl: string | null; role: string } | null>(null);
  const [unread, setUnread] = useState(0);
  const [awaiting, setAwaiting] = useState<{ friendRequests: number; betaRequests: number; reports: number }>({ friendRequests: 0, betaRequests: 0, reports: 0 });
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);

  // Identity (username + avatar). Also refreshed live from ChatWidget's broadcast.
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await sb.from("profiles").select("username,avatar_url,role").eq("id", data.user.id).single();
      setMe({ username: (p?.username as string) ?? "member", avatarUrl: (p?.avatar_url as string) ?? null, role: (p?.role as string) ?? "member" });
    }).catch(() => {});
  }, []);

  // Live unread/avatar from the ChatWidget (mounted in the Dock, even when the Dock is hidden).
  useEffect(() => {
    const onMeta = (e: Event) => {
      const d = (e as CustomEvent).detail as { unread?: number; username?: string; avatarUrl?: string | null; member?: boolean } | undefined;
      if (!d) return;
      if (typeof d.unread === "number") setUnread(d.unread);
      if (d.member && d.username) setMe((m) => m ?? { username: d.username as string, avatarUrl: d.avatarUrl ?? null, role: "member" });
    };
    window.addEventListener("ss:chat-meta", onMeta);
    return () => window.removeEventListener("ss:chat-meta", onMeta);
  }, []);

  // Founder/admin awaiting counts (beta approvals + flagged posts) + friend requests.
  useEffect(() => {
    if (!me) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/awaiting", { cache: "no-store" });
        const j = await r.json();
        if (alive) setAwaiting({ friendRequests: j.friendRequests ?? 0, betaRequests: j.betaRequests ?? 0, reports: j.reports ?? 0 });
      } catch { /* keep last */ }
    };
    load();
    const iv = setInterval(load, 60000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, [me]);

  // Flag <html> so the CSS only reserves the sidebar column + hides the Dock when a member is
  // actually signed in (otherwise signed-out visitors get shifted content with no sidebar).
  // data-home lets the homepage drop the rail below the "Why StatSeer" drawer tab.
  const pathname = usePathname();
  useEffect(() => {
    const el = document.documentElement;
    if (me) el.setAttribute("data-rail", "1"); else el.removeAttribute("data-rail");
    if (me && pathname === "/") el.setAttribute("data-home", "1"); else el.removeAttribute("data-home");
    return () => { el.removeAttribute("data-rail"); el.removeAttribute("data-home"); };
  }, [me, pathname]);

  useEffect(() => {
    if (!notifOpen) return;
    const onDoc = (e: MouseEvent) => { if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNotifOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [notifOpen]);

  if (!me) return null;

  const total = unread + awaiting.friendRequests + awaiting.betaRequests + awaiting.reports;

  return (
    <nav className="leftrail" aria-label="Your space">
      <a className="leftrail__it leftrail__it--profile" href={`/u/${me.username}`}>
        <span className="leftrail__ic is-online">
          {me.avatarUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={me.avatarUrl} alt="" className="leftrail__av" />
            : <span className="leftrail__ini" aria-hidden="true">{me.username.charAt(0).toUpperCase()}</span>}
        </span>
        <span className="leftrail__lbl">{me.username}</span>
      </a>

      {me.role === "founder" && (
        <a className="leftrail__it" href="/creator">
          <span className="leftrail__ic" aria-hidden="true">👑</span><span className="leftrail__lbl">Creator Dashboard</span>
        </a>
      )}

      <button type="button" className="leftrail__it" onClick={() => fire("ss:open-chat")}>
        <span className="leftrail__ic" aria-hidden="true">👥</span><span className="leftrail__lbl">Friends</span>
      </button>

      <button type="button" className="leftrail__it" onClick={() => fire("ss:open-chat")}>
        <span className="leftrail__ic" aria-hidden="true">💬</span><span className="leftrail__lbl">Chat</span>
        {unread > 0 && <span className="leftrail__badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      <div className="leftrail__notifwrap" ref={notifRef}>
        <button type="button" className="leftrail__it" aria-haspopup="menu" aria-expanded={notifOpen}
          onClick={() => setNotifOpen((v) => !v)}>
          <span className="leftrail__ic" aria-hidden="true">🔔</span>
          <span className="leftrail__lbl">Notifications</span>
          {total > 0 && <span className="leftrail__badge">{total > 9 ? "9+" : total}</span>}
        </button>
        {notifOpen && (
          <div className="docknotif docknotif--rail" role="menu" aria-label="Notifications">
            <div className="docknotif__hd">What&apos;s waiting</div>
            {total === 0 && <div className="docknotif__empty">You&apos;re all caught up ✓</div>}
            {awaiting.betaRequests > 0 && (
              <a role="menuitem" className="docknotif__item" href="/admin/members" onClick={() => setNotifOpen(false)}>
                <span className="docknotif__ic" aria-hidden="true">🪪</span><span className="docknotif__lbl">Beta access requests</span><span className="docknotif__n">{awaiting.betaRequests}</span>
              </a>
            )}
            {awaiting.reports > 0 && (
              <a role="menuitem" className="docknotif__item" href="/forum/reports" onClick={() => setNotifOpen(false)}>
                <span className="docknotif__ic" aria-hidden="true">🚩</span><span className="docknotif__lbl">Flagged posts to review</span><span className="docknotif__n">{awaiting.reports}</span>
              </a>
            )}
            {awaiting.friendRequests > 0 && (
              <button type="button" role="menuitem" className="docknotif__item" onClick={() => { setNotifOpen(false); fire("ss:open-chat"); }}>
                <span className="docknotif__ic" aria-hidden="true">🤝</span><span className="docknotif__lbl">Friend requests</span><span className="docknotif__n">{awaiting.friendRequests}</span>
              </button>
            )}
            {unread > 0 && (
              <button type="button" role="menuitem" className="docknotif__item" onClick={() => { setNotifOpen(false); fire("ss:open-chat"); }}>
                <span className="docknotif__ic" aria-hidden="true">💬</span><span className="docknotif__lbl">Unread messages</span><span className="docknotif__n">{unread}</span>
              </button>
            )}
          </div>
        )}
      </div>

      <a className="leftrail__it" href="/dashboard">
        <span className="leftrail__ic" aria-hidden="true">🗂️</span><span className="leftrail__lbl">My Dashboard</span>
      </a>
      <button type="button" className="leftrail__it" onClick={() => fire("ss:open-assistant")}>
        <span className="leftrail__ic leftrail__ic--asst" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/chatbot-icon.png?v=3" alt="" className="leftrail__icimg" />
        </span>
        <span className="leftrail__lbl">AI Slip Assistant</span>
      </button>
      <button type="button" className="leftrail__it" onClick={() => fire("ss:open-slip")}>
        <span className="leftrail__ic" aria-hidden="true">🎟️</span><span className="leftrail__lbl">Saved Slips</span>
      </button>
      <a className="leftrail__it" href="/bankroll">
        <span className="leftrail__ic" aria-hidden="true">💰</span><span className="leftrail__lbl">Bankroll</span>
      </a>
      <button type="button" className="leftrail__it" onClick={() => fire("ss:open-feedback")}>
        <span className="leftrail__ic leftrail__ic--pigeon" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pigeon.png" alt="" className="leftrail__pigeon" />
        </span>
        <span className="leftrail__lbl">Message Us</span>
      </button>
    </nav>
  );
}
