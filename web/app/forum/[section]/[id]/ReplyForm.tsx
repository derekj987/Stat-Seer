"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ReplyForm({ section, threadId }: { section: string; threadId: string }) {
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
    const { error } = await createClient().from("replies")
      .insert({ thread_id: threadId, body: body.trim(), author_id: userId });
    if (error) { setStatus("error"); setMsg(error.message); return; }
    setBody(""); setStatus("idle");
    router.refresh(); // re-fetch the server-rendered replies
  }

  if (userId === undefined) return null; // still checking auth
  if (userId === null) {
    return (
      <p className="replyprompt">
        <a href="/login">Log in</a> or <a href="/signup">sign up</a> to reply.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="replyform">
      <textarea className="composer__body" value={body} onChange={(e) => setBody(e.target.value)}
        placeholder="Write a reply…" rows={4} maxLength={20000} />
      {msg && <p className="authcard__err">{msg}</p>}
      <div className="composer__actions">
        <button type="submit" className="btn btn--primary" disabled={status === "loading" || !body.trim()}>
          {status === "loading" ? "Posting…" : "Reply"}
        </button>
      </div>
    </form>
  );
}
