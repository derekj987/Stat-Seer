"use client";

// Follow / Unfollow a profile. Optimistic toggle; writes to the follows table (RLS scopes the row
// to auth.uid()). Degrades with a hint if the follows migration hasn't been run yet.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function FollowButton({ profileId, viewerId, initialFollowing }:
  { profileId: string; viewerId: string; initialFollowing: boolean }) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function toggle() {
    setBusy(true); setErr("");
    const c = createClient();
    if (following) {
      const { error } = await c.from("follows").delete().eq("follower_id", viewerId).eq("following_id", profileId);
      if (error) { setErr("Couldn't unfollow."); setBusy(false); return; }
      setFollowing(false);
    } else {
      const { error } = await c.from("follows").insert({ follower_id: viewerId, following_id: profileId });
      if (error) {
        setErr(/relation .*follows|does not exist/.test(error.message) ? "Run ingest/follows.sql in Supabase to enable follows." : "Couldn't follow.");
        setBusy(false); return;
      }
      setFollowing(true);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <span className="followwrap">
      <button type="button" onClick={toggle} disabled={busy}
        className={following ? "pbtn pbtn--following" : "btn btn--primary"}>
        {busy ? "…" : following ? "✓ Following" : "＋ Follow"}
      </button>
      {err && <span className="followwrap__err">{err}</span>}
    </span>
  );
}
