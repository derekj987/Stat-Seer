"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MOD_ROLES = ["founder", "admin", "mod"];

export default function WallActions({ postId, authorId, profileId, me }: {
  postId: string;
  authorId: string;   // who wrote the post
  profileId: string;  // whose wall it's on
  me: { id: string; role: string } | null;
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

  return (
    <span className="postact">
      <button type="button" className="postact__btn postact__btn--del" onClick={del} disabled={busy}>
        {isAuthor ? "Delete" : "Remove"}
      </button>
    </span>
  );
}
