"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MOD_ROLES = ["founder", "admin", "mod"];

export default function PostActions({ kind, id, authorId, section, me }: {
  kind: "thread" | "reply";
  id: string;
  authorId: string;
  section: string;
  me: { id: string; role: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState(false);

  if (!me) return null;
  const isAuthor = me.id === authorId;
  const canDelete = isAuthor || MOD_ROLES.includes(me.role);
  const canReport = !isAuthor;
  if (!canDelete && !canReport) return null;

  async function del() {
    if (!confirm(`Delete this ${kind}? This can't be undone.`)) return;
    setBusy(true);
    const { error } = await createClient()
      .from(kind === "thread" ? "threads" : "replies").delete().eq("id", id);
    setBusy(false);
    if (error) { alert(error.message); return; }
    if (kind === "thread") router.push(`/forum/${section}`);
    else router.refresh();
  }

  async function report() {
    const reason = prompt("Report this post — reason (optional):");
    if (reason === null) return; // cancelled
    setBusy(true);
    const { error } = await createClient().from("reports").insert({
      target_type: kind, target_id: id, reporter_id: me!.id, reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) { alert(error.message); return; }
    setReported(true);
  }

  return (
    <span className="postact">
      {canReport && (reported
        ? <span className="postact__done">Reported ✓</span>
        : <button type="button" className="postact__btn" onClick={report} disabled={busy}>Report</button>)}
      {canDelete && (
        <button type="button" className="postact__btn postact__btn--del" onClick={del} disabled={busy}>
          {isAuthor ? "Delete" : "Remove"}
        </button>
      )}
    </span>
  );
}
