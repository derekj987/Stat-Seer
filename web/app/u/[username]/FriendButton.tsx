"use client";

// Add-a-friend control on a member's profile. Resolves the current relationship
// (none / request sent / incoming request / friends) and lets the viewer act on it.
// Hidden for guests and on your own profile.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Rel = "loading" | "hidden" | "none" | "outgoing" | "incoming" | "friends";

export default function FriendButton({ profileId }: { profileId: string }) {
  const [rel, setRel] = useState<Rel>("loading");
  const [rowId, setRowId] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  useEffect(() => {
    if (!configured) { setRel("hidden"); return; }
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null;
      setMeId(uid);
      if (!uid || uid === profileId) { setRel("hidden"); return; }
      const { data: rows } = await sb.from("friendships")
        .select("id,requester_id,status")
        .or(`and(requester_id.eq.${uid},addressee_id.eq.${profileId}),and(requester_id.eq.${profileId},addressee_id.eq.${uid})`)
        .limit(1);
      const r = rows?.[0];
      if (!r) { setRel("none"); return; }
      setRowId(r.id as string);
      setRel(r.status === "accepted" ? "friends" : r.requester_id === uid ? "outgoing" : "incoming");
    });
  }, [profileId, configured]);

  async function add() {
    if (!meId) return;
    setBusy(true);
    const { data, error } = await createClient().from("friendships")
      .insert({ requester_id: meId, addressee_id: profileId }).select("id").single();
    setBusy(false);
    if (!error && data) { setRowId(data.id as string); setRel("outgoing"); }
  }
  async function accept() {
    if (!rowId) return;
    setBusy(true);
    const { error } = await createClient().from("friendships").update({ status: "accepted" }).eq("id", rowId);
    setBusy(false);
    if (!error) setRel("friends");
  }
  async function remove() {
    if (!rowId) return;
    setBusy(true);
    await createClient().from("friendships").delete().eq("id", rowId);
    setBusy(false);
    setRowId(null); setRel("none");
  }

  if (rel === "loading" || rel === "hidden") return null;

  return (
    <div className="friendbtn">
      {rel === "none" && <button className="friendbtn__add" onClick={add} disabled={busy}>+ Add friend</button>}
      {rel === "outgoing" && <button className="friendbtn__pending" onClick={remove} disabled={busy} title="Cancel request">Request sent ✕</button>}
      {rel === "incoming" && (
        <>
          <button className="friendbtn__add" onClick={accept} disabled={busy}>Accept friend</button>
          <button className="friendbtn__decline" onClick={remove} disabled={busy}>Decline</button>
        </>
      )}
      {rel === "friends" && <button className="friendbtn__friends" onClick={remove} disabled={busy} title="Unfriend">Friends ✓</button>}
    </div>
  );
}
