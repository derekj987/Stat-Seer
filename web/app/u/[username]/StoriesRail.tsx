"use client";

// Instagram-style story rail: circles for the profile owner + friends who shared a betslip
// to their "story" in the last 24h. Tap a circle to view the slip and react with an emoji.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Story } from "@/lib/profile";
import WallSlipCard from "./WallSlipCard";

const REACTIONS = ["🔥", "👍", "💰", "😂", "😮"];

const ago = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${Math.max(1, m)}m ago` : `${Math.floor(m / 60)}h ago`;
};

function ReactionBar({ storyId, meId }: { storyId: string; meId: string | null }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const { data } = await createClient().from("story_reactions").select("emoji,user_id").eq("story_id", storyId);
    const c: Record<string, number> = {};
    const m = new Set<string>();
    for (const r of data ?? []) {
      c[r.emoji as string] = (c[r.emoji as string] ?? 0) + 1;
      if (meId && r.user_id === meId) m.add(r.emoji as string);
    }
    setCounts(c); setMine(m);
  }, [storyId, meId]);

  useEffect(() => { load(); }, [load]);

  async function toggle(emoji: string) {
    if (!meId) return;
    const sb = createClient();
    const had = mine.has(emoji);
    // optimistic
    setMine((s) => { const n = new Set(s); if (had) n.delete(emoji); else n.add(emoji); return n; });
    setCounts((c) => ({ ...c, [emoji]: Math.max(0, (c[emoji] ?? 0) + (had ? -1 : 1)) }));
    if (had) await sb.from("story_reactions").delete().eq("story_id", storyId).eq("user_id", meId).eq("emoji", emoji);
    else await sb.from("story_reactions").insert({ story_id: storyId, user_id: meId, emoji });
  }

  return (
    <div className="storyreact">
      {REACTIONS.map((e) => (
        <button key={e} className={mine.has(e) ? "storyreact__b on" : "storyreact__b"} onClick={() => toggle(e)} disabled={!meId}>
          <span>{e}</span>{counts[e] ? <span className="storyreact__n">{counts[e]}</span> : null}
        </button>
      ))}
    </div>
  );
}

export default function StoriesRail({ stories, isOwner }: { stories: Story[]; isOwner: boolean }) {
  const [open, setOpen] = useState<Story | null>(null);
  const [meId, setMeId] = useState<string | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    createClient().auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));
  }, []);

  if (!isOwner && stories.length === 0) return null;

  return (
    <section className="stories" aria-label="Stories">
      {isOwner && (
        <a className="story story--add" href="/lines" title="Share a slip to your story from the Value Finder bar">
          <span className="story__ring story__ring--add"><span className="story__plus" aria-hidden="true">＋</span></span>
          <span className="story__name">Your story</span>
        </a>
      )}
      {stories.map((s) => (
        <button className="story" key={s.userId} onClick={() => setOpen(s)}>
          <span className="story__ring">
            <span className="story__av">
              {s.avatarUrl
                ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={s.avatarUrl} alt="" />
                : s.username.charAt(0).toUpperCase()}
            </span>
          </span>
          <span className="story__name">{s.username}</span>
        </button>
      ))}

      {open && (
        <div className="storyview" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <div className="storyview__card" onClick={(e) => e.stopPropagation()}>
            <div className="storyview__hd">
              <span className="storyview__who"><b>{open.username}</b> · {ago(open.createdAt)}</span>
              <button className="storyview__x" onClick={() => setOpen(null)} aria-label="Close">✕</button>
            </div>
            {open.caption && <p className="storyview__cap">{open.caption}</p>}
            <WallSlipCard items={open.slip} />
            <ReactionBar storyId={open.id} meId={meId} />
          </div>
        </div>
      )}
    </section>
  );
}
