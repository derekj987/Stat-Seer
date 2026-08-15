"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MAX = 500;

export default function EditBio({ userId, bio, canEdit }: {
  userId: string;
  bio: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(bio ?? "");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading"); setMsg("");
    const value = text.trim() || null;
    const { error } = await createClient().from("profiles").update({ bio: value }).eq("id", userId);
    if (error) { setStatus("error"); setMsg(error.message); return; }
    setStatus("idle"); setEditing(false);
    router.refresh();
  }

  if (!canEdit) {
    return bio ? <p className="phead__bio">{bio}</p> : null;
  }

  if (!editing) {
    return (
      <div className="phead__bioedit">
        {bio ? <p className="phead__bio">{bio}</p> : <p className="phead__bio phead__bio--empty">No bio yet.</p>}
        <button type="button" className="postact__btn" onClick={() => { setText(bio ?? ""); setEditing(true); }}>
          {bio ? "Edit bio" : "Add a bio"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="bioform">
      <textarea className="composer__body" value={text} maxLength={MAX} rows={3}
        placeholder="A line or two about you…" onChange={(e) => setText(e.target.value)} />
      <div className="bioform__foot">
        <span className="bioform__count">{text.length}/{MAX}</span>
        {msg && <span className="authcard__err">{msg}</span>}
        <button type="submit" className="btn btn--primary" disabled={status === "loading"}>
          {status === "loading" ? "Saving…" : "Save"}
        </button>
        <button type="button" className="postact__btn" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}
