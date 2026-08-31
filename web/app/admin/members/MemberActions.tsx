"use client";

// Approve / reject a beta member. Calls the SECURITY DEFINER set_member_status RPC,
// which enforces founder/admin on the server. Optimistic-ish: on success we refresh.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function MemberActions({ id, username, status }: { id: string; username: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function set(next: "approved" | "rejected" | "pending") {
    setBusy(next); setErr("");
    const { error } = await createClient().rpc("set_member_status", { target: id, new_status: next });
    setBusy(null);
    if (error) { setErr(error.message || "Couldn't update — try again."); return; }
    router.refresh();
  }

  return (
    <div className="memberrow__actions">
      {err && <span className="memberrow__err">{err}</span>}
      {status !== "approved" && (
        <button className="btn btn--primary btn--sm" disabled={!!busy} onClick={() => set("approved")}
          title={`Approve ${username}`}>{busy === "approved" ? "…" : "Approve"}</button>
      )}
      {status === "pending" && (
        <button className="btn btn--sm" disabled={!!busy} onClick={() => set("rejected")}
          title={`Reject ${username}`}>{busy === "rejected" ? "…" : "Reject"}</button>
      )}
      {status === "approved" && (
        <button className="btn btn--sm" disabled={!!busy} onClick={() => set("pending")}
          title={`Revoke ${username}'s access`}>{busy === "pending" ? "…" : "Revoke"}</button>
      )}
      {status === "rejected" && (
        <button className="btn btn--sm" disabled={!!busy} onClick={() => set("pending")}
          title={`Move ${username} back to pending`}>{busy === "pending" ? "…" : "Undo"}</button>
      )}
    </div>
  );
}
