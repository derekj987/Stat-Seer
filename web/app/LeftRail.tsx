"use client";

// Facebook-style quick-access sidebars down BOTH margins — on desktop these REPLACE the bottom-right
// Dock bubble (the Dock is hidden ≥1100px and carries the same tools on phones). Two rails:
//   • Member Rail (left)   — who you are and who you talk to: Profile, Creator Dashboard, Friends,
//                            Chat, Notifications.
//   • Bettor's Rail (right) — what you bet with: My Analytics, AI Slip Assistant, Saved Slips,
//                            Bankroll, Message Us.
// The rails split at ≥1280px (see globals.css). Below that they merge into one rail holding every
// item, so nothing becomes unreachable on a narrow desktop — the rails merge rather than the tools
// vanishing. Which copy shows is decided purely in CSS, never in JS.
// Both rails share the .leftrail class (identical size, padding, border, shadow, scroll behaviour);
// only the side differs. Signed-out visitors / embeds don't see either.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// `detail.force` means "open it", as opposed to the plain rail click which TOGGLES (see Dock.tsx).
// Used by the notification menu items: "you have unread messages" must always land you in the chat,
// never close it because it happened to be open already.
const fire = (name: string, detail?: Record<string, unknown>) => {
  try { window.dispatchEvent(new CustomEvent(name, detail ? { detail } : undefined)); } catch { /* SSR */ }
};

// Rail icon. Custom artwork lives in /public and is served at 128px for a 42-56px slot (2x retina);
// the full-res originals are kept out of the repo in assets/rail-src. `alt=""` because every row
// already carries a text label, so announcing the image would just repeat it.
function RailIcon({ src, cls }: { src: string; cls?: string }) {
  return (
    <span className={`leftrail__ic${cls ? " " + cls : ""}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="leftrail__icimg" />
    </span>
  );
}

export default function LeftRail() {
  const [me, setMe] = useState<{ username: string; avatarUrl: string | null; role: string } | null>(null);
  const [unread, setUnread] = useState(0);
  const [awaiting, setAwaiting] = useState<{ friendRequests: number; betaRequests: number; reports: number }>({ friendRequests: 0, betaRequests: 0, reports: 0 });
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const notifBtnRef = useRef<HTMLButtonElement | null>(null);
  // Viewport coordinates for the notifications popup. It renders position:fixed so it can escape
  // the rail's overflow clip, which means it needs real coordinates rather than a CSS offset.
  const [notifPos, setNotifPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

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

  // Flag <html> so the CSS only reserves the sidebar columns + hides the Dock when a member is
  // actually signed in (otherwise signed-out visitors get shifted content with no sidebar).
  // data-home lets the homepage drop the rails below the "Why StatSeer" drawer tab.
  const pathname = usePathname();
  useEffect(() => {
    const el = document.documentElement;
    if (me) el.setAttribute("data-rail", "1"); else el.removeAttribute("data-rail");
    if (me && pathname === "/") el.setAttribute("data-home", "1"); else el.removeAttribute("data-home");
    return () => { el.removeAttribute("data-rail"); el.removeAttribute("data-home"); };
  }, [me, pathname]);

  // On the homepage the rails start 220px down to clear the hero + the "Why StatSeer" drawer tab.
  // Once you've scrolled past the hero that offset is just dead space above the rail, so flag the
  // scroll and let the CSS pull the rails up to fill it. Passive listener.
  useEffect(() => {
    if (!me) return;
    const el = document.documentElement;
    // Toggling one attribute is cheap enough to do straight from the scroll handler, and the `past`
    // guard means we only touch the DOM on an actual crossing. Deliberately NOT rAF-throttled:
    // requestAnimationFrame is paused while the tab is hidden, which would leave the flag stale.
    let past: boolean | null = null;
    const apply = () => {
      const now = window.scrollY > 160;
      if (now === past) return;
      past = now;
      if (now) el.setAttribute("data-scrolled", "1");
      else el.removeAttribute("data-scrolled");
    };
    apply();
    window.addEventListener("scroll", apply, { passive: true });
    return () => { window.removeEventListener("scroll", apply); el.removeAttribute("data-scrolled"); };
  }, [me]);

  useEffect(() => {
    if (!notifOpen) return;
    const onDoc = (e: MouseEvent) => { if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNotifOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [notifOpen]);

  // Place the popup beside the button, in viewport coordinates. Recomputed while it is open,
  // because the rail is fixed but scrollable and the page moves under it.
  useEffect(() => {
    if (!notifOpen) return;
    const place = () => {
      const b = notifBtnRef.current?.getBoundingClientRect();
      if (!b) return;
      const W = 292, GAP = 10, PAD = 12;
      // The Bettor's Rail sits on the RIGHT, so a menu opening rightwards would run off-screen.
      // Flip to the button's left when there isn't room, and clamp to the viewport either way.
      const right = b.right + GAP;
      const left = right + W + PAD > window.innerWidth ? Math.max(PAD, b.left - GAP - W) : right;
      setNotifPos({
        top: Math.min(Math.max(PAD, b.top), Math.max(PAD, window.innerHeight - 240)),
        left,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);   // capture: the rail's own scroll counts too
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [notifOpen]);

  if (!me) return null;

  const total = unread + awaiting.friendRequests + awaiting.betaRequests + awaiting.reports;

  // ---- Member Rail items: identity + people ---------------------------------
  const memberItems = (
    <>
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
          {/* "Creator Dashboard" is the one label too long for the rail — it ellipsized to
              "Creator Dashb…" at the old 254px width and would be worse at 208px. The rail's width
              feeds the gutter arithmetic, so the label gives way, not the geometry. The page it
              opens is still titled Creator · Dashboard. */}
          <RailIcon src="/creator.png" /><span className="leftrail__lbl">Creator</span>
        </a>
      )}

      <button type="button" className="leftrail__it" onClick={() => fire("ss:open-chat")}>
        <RailIcon src="/friends.png" /><span className="leftrail__lbl">Friends</span>
      </button>

      <button type="button" className="leftrail__it" onClick={() => fire("ss:open-chat")}>
        <RailIcon src="/message.png" /><span className="leftrail__lbl">Chat</span>
        {unread > 0 && <span className="leftrail__badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      <div className="leftrail__notifwrap" ref={notifRef}>
        <button type="button" ref={notifBtnRef} className="leftrail__it" aria-haspopup="menu" aria-expanded={notifOpen}
          onClick={() => setNotifOpen((v) => !v)}>
          <RailIcon src="/notifications.png" />
          <span className="leftrail__lbl">Notifications</span>
          {total > 0 && <span className="leftrail__badge">{total > 9 ? "9+" : total}</span>}
        </button>
        {notifOpen && (
          // position:fixed, with coordinates measured off the button. The menu USED to be
          // position:absolute at left:calc(100% + 10px) — i.e. deliberately outside the rail — but
          // .leftrail sets overflow-y:auto, and a scroll container clips on BOTH axes. So the popup
          // was rendered off the rail's edge and then clipped away: clicking Notifications looked
          // like nothing happened, and the menu could only be reached by scrolling the rail
          // sideways. position:fixed escapes an ancestor's overflow clip (nothing on the rail sets
          // transform/filter, which would re-trap it), so the menu now floats above the page.
          <div className="docknotif docknotif--rail" role="menu" aria-label="Notifications"
            style={{ top: notifPos.top, left: notifPos.left }}>
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
              <button type="button" role="menuitem" className="docknotif__item" onClick={() => { setNotifOpen(false); fire("ss:open-chat", { force: true }); }}>
                <span className="docknotif__ic" aria-hidden="true">🤝</span><span className="docknotif__lbl">Friend requests</span><span className="docknotif__n">{awaiting.friendRequests}</span>
              </button>
            )}
            {unread > 0 && (
              <button type="button" role="menuitem" className="docknotif__item" onClick={() => { setNotifOpen(false); fire("ss:open-chat", { force: true }); }}>
                <span className="docknotif__ic" aria-hidden="true">💬</span><span className="docknotif__lbl">Unread messages</span><span className="docknotif__n">{unread}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );

  // ---- Bettor's Rail items: the betting tools -------------------------------
  const bettorItems = (
    <>
      <a className="leftrail__it" href="/dashboard">
        <RailIcon src="/analytics.png" /><span className="leftrail__lbl">My Analytics</span>
      </a>
      <button type="button" className="leftrail__it" onClick={() => fire("ss:open-assistant")}>
        <span className="leftrail__ic leftrail__ic--asst" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/chatbot-icon.png?v=3" alt="" className="leftrail__icimg" />
        </span>
        <span className="leftrail__lbl">AI Slip Assistant</span>
      </button>
      <button type="button" className="leftrail__it" onClick={() => fire("ss:open-slip")}>
        <RailIcon src="/slip.png" /><span className="leftrail__lbl">Saved Slips</span>
      </button>
      <a className="leftrail__it" href="/bankroll">
        <RailIcon src="/bankroll.png" /><span className="leftrail__lbl">Bankroll</span>
      </a>
      <button type="button" className="leftrail__it" onClick={() => fire("ss:open-feedback")}>
        <span className="leftrail__ic leftrail__ic--pigeon" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pigeon.png" alt="" className="leftrail__pigeon" />
        </span>
        <span className="leftrail__lbl">Message Us</span>
      </button>
    </>
  );

  return (
    <>
      <nav className="leftrail leftrail--left" aria-label="Member Rail">
        <h2 className="leftrail__hd">Member Rail</h2>
        {memberItems}
        {/* Narrow desktops get ONE rail, so the betting tools fold back in here. Which copy shows is
            decided purely by CSS (.leftrail__merged vs .leftrail--right) rather than by a JS media
            query: a JS decision has to survive hydration AND every resize, and when it lags, the
            CSS hides the right rail while the items have not yet folded back — leaving all five
            tools unreachable, with the Dock hidden too. Rendering both copies cannot get out of
            sync. The duplicate is five stateless buttons; the stateful item (Notifications, with its
            popup + ref) lives in memberItems, which is rendered exactly once. */}
        <div className="leftrail__merged">
          <hr className="leftrail__rule" />
          {bettorItems}
        </div>
      </nav>

      <nav className="leftrail leftrail--right" aria-label="Bettor's Rail">
        <h2 className="leftrail__hd">Bettor&apos;s Rail</h2>
        {bettorItems}
      </nav>
    </>
  );
}
