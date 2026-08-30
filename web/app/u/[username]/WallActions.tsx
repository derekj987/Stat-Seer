"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MOD_ROLES = ["founder", "admin", "mod"];

export default function WallActions({ postId, authorId, profileId, me, pinned }: {
  postId: string;
  authorId: string;   // who wrote the post
  profileId: string;  // whose wall it's on
  me: { id: string; role: string } | null;
  pinned: boolean;    // is this the profile's currently-pinned post
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!me) return null;
  const isAuthor = me.id === authorId;
  const isOwner = me.id === profileId;   // your wall, your call
  const canDelete = isAuthor || isOwner || MOD_ROLES.includes(me.role);
  if (!canDelete) return null;

  async function del() {
    if (!confirm("Delete this post? This can't be undone.")) return;
    setBusy(true);
    const { error } = await createClient().from("wall_posts").delete().eq("id", postId);
    setBusy(false);
    if (error) { alert(error.message); return; }
    router.refresh();
  }

  // Pin/unpin sets profiles.pinned_post_id on the wall owner's own profile.
  async function togglePin() {
    setBusy(true);
    const { error } = await createClient().from("profiles")
      .update({ pinned_post_id: pinned ? null : postId }).eq("id", profileId);
    setBusy(false);
    if (error) {
      alert(/pinned_post_id|column|does not exist/.test(error.message)
        ? "Run ingest/pinned_post.sql in Supabase to enable pinning." : error.message);
      return;
    }
    router.refresh();
  }

  return (
    <span className="postact">
      {isOwner && (
        <button type="button" className="postact__btn" onClick={togglePin} disabled={busy}>
          {pinned ? "Unpin" : "Pin"}
        </button>
      )}
      <button type="button" className="postact__btn postact__btn--del" onClick={del} disabled={busy}>
        {isAuthor ? "Delete" : "Remove"}
      </button>
    </span>
  );
}
