"use client";

// Facebook-style quick-access rail down the LEFT margin (desktop only — the centered 1120px
// content leaves empty space there on wide screens). Members get one-tap access to their space:
// Profile, My Dashboard, the AI Slip Assistant, Friends, Saved Slips, and Chat. The same shortcuts
// live in the floating Dock (bottom-right), which is what carries them on phones. Signed-out
// visitors and embeds don't see it.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const fire = (name: string) => { try { window.dispatchEvent(new CustomEvent(name)); } catch { /* SSR */ } };

export default function LeftRail() {
  const [me, setMe] = useState<{ username: string; avatarUrl: string | null } | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await sb.from("profiles").select("username,avatar_url").eq("id", data.user.id).single();
      setMe({ username: (p?.username as string) ?? "member", avatarUrl: (p?.avatar_url as string) ?? null });
    }).catch(() => {});
  }, []);

  if (!me) return null;

  return (
    <nav className="leftrail" aria-label="Your space">
      <a className="leftrail__it leftrail__it--profile" href={`/u/${me.username}`} data-label="My profile" aria-label="My profile">
        {me.avatarUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={me.avatarUrl} alt="" className="leftrail__av" />
          : <span className="leftrail__ini" aria-hidden="true">{me.username.charAt(0).toUpperCase()}</span>}
      </a>
      <a className="leftrail__it" href="/dashboard" data-label="My Dashboard" aria-label="My Dashboard">
        <span aria-hidden="true">🗂️</span>
      </a>
      <button type="button" className="leftrail__it" data-label="AI Slip Assistant" aria-label="AI Slip Assistant"
        onClick={() => fire("ss:open-assistant")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/chatbot-icon.png?v=3" alt="" className="leftrail__icimg" />
      </button>
      <button type="button" className="leftrail__it" data-label="Friends" aria-label="Friends"
        onClick={() => fire("ss:open-chat")}>
        <span aria-hidden="true">👥</span>
      </button>
      <button type="button" className="leftrail__it" data-label="Saved Slips" aria-label="Saved Slips"
        onClick={() => fire("ss:open-slip")}>
        <span aria-hidden="true">🎟️</span>
      </button>
      <button type="button" className="leftrail__it" data-label="Chat" aria-label="Chat"
        onClick={() => fire("ss:open-chat")}>
        <span aria-hidden="true">💬</span>
      </button>
    </nav>
  );
}
