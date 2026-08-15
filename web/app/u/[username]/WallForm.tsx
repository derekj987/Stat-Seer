"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function WallForm({ profileId, ownName }: { profileId: string; ownName: string | null }) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || body.trim().length < 1) return;
    setStatus("loading"); setMsg("");
    const { error } = await createClient().from("wall_posts")
      .insert({ profile_id: profileId, author_id: userId, body: body.trim() });
    if (error) { setStatus("error"); setMsg(error.message); return; }
    setBody(""); setStatus("idle");
    router.refresh();
  }

  if (userId === undefined) return null;
  if (userId === null) {
    return (
      <p className="replyprompt">
        <a href="/login">Log in</a> or <a href="/signup">sign up</a> to post on this wall.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="wallform">
      <textarea className="composer__body" value={body} onChange={(e) => setBody(e.target.value)}
        placeholder={ownName ? "Write something on your wall…" : "Write something…"} rows={3} maxLength={5000} />
      {msg && <p className="authcard__err">{msg}</p>}
      <div className="composer__actions">
        <button type="submit" className="btn btn--primary" disabled={status === "loading" || !body.trim()}>
          {status === "loading" ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}
