"use client";

// Emoji reactions on a wall post. Reads/writes wall_reactions via RLS (one row per
// post+user+emoji). Optimistic toggle; re-syncs from the server payload after each write.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { REACTION_EMOJI } from "@/lib/reactions";
import type { Reaction } from "@/lib/profile";

export default function PostReactions({ postId, viewerId, initial }: {
  postId: string;
  viewerId: string | null;
  initial: Reaction[];
}) {
  const router = useRouter();
  const [rx, setRx] = useState<Reaction[]>(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Keep in sync when the server sends fresh counts (e.g. after router.refresh or others reacting).
  useEffect(() => { setRx(initial); }, [initial]);

  async function toggle(emoji: string) {
    if (!viewerId || busy) return;
    setBusy(true);
    setOpen(false);
    const existing = rx.find((r) => r.emoji === emoji);
    const mine = !!existing?.mine;

    // optimistic update
    setRx((cur) => {
      const found = cur.find((r) => r.emoji === emoji);
      if (found) {
        const count = found.count + (mine ? -1 : 1);
        const next = cur.map((r) => r.emoji === emoji ? { ...r, count, mine: !mine } : r).filter((r) => r.count > 0);
        return next;
      }
      // add a new emoji in the fixed palette order
      const added = [...cur, { emoji, count: 1, mine: true }];
      return REACTION_EMOJI.filter((e) => added.some((r) => r.emoji === e))
        .map((e) => added.find((r) => r.emoji === e)!);
    });

    const c = createClient();
    const { error } = mine
      ? await c.from("wall_reactions").delete().eq("post_id", postId).eq("user_id", viewerId).eq("emoji", emoji)
      : await c.from("wall_reactions").insert({ post_id: postId, user_id: viewerId, emoji });
    setBusy(false);
    if (error) { setRx(initial); return; }   // revert on failure
    router.refresh();
  }

  return (
    <div className="rxbar">
      {rx.map((r) => (
        <button key={r.emoji} type="button"
          className={r.mine ? "rxpill rxpill--mine" : "rxpill"}
          onClick={() => toggle(r.emoji)} disabled={!viewerId || busy}
          title={r.mine ? "Remove your reaction" : "React"}>
          <span className="rxpill__e">{r.emoji}</span><span className="rxpill__n">{r.count}</span>
        </button>
      ))}
      {viewerId && (
        <div className="rxadd">
          <button type="button" className="rxadd__btn" onClick={() => setOpen((o) => !o)}
            aria-label="Add a reaction" aria-expanded={open} disabled={busy}>
            <span aria-hidden="true">🙂﹢</span>
          </button>
          {open && (
            <div className="rxadd__pop" role="menu">
              {REACTION_EMOJI.map((e) => (
                <button key={e} type="button" className="rxadd__opt" role="menuitem"
                  onClick={() => toggle(e)} title={`React ${e}`}>{e}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
