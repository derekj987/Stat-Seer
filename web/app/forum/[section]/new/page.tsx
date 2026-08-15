"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sectionBySlug } from "@/lib/forum";

export default function NewThread() {
  const params = useParams();
  const router = useRouter();
  const section = String(params.section);
  const sec = sectionBySlug(section);

  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (!data.user) { router.replace("/login"); return; }
      setUserId(data.user.id);
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    if (title.trim().length < 3) { setStatus("error"); setMsg("Give it a title (3+ characters)."); return; }
    if (body.trim().length < 1) { setStatus("error"); setMsg("Write something in the body."); return; }
    setStatus("loading"); setMsg("");
    const { data, error } = await createClient().from("threads")
      .insert({ section, title: title.trim(), body: body.trim(), author_id: userId })
      .select("id").single();
    if (error) { setStatus("error"); setMsg(error.message); return; }
    router.push(`/forum/${section}/${data.id}`);
  }

  if (!sec) return <main className="wrap"><p className="foot">Unknown section.</p></main>;

  return (
    <main className="wrap">
      <nav className="crumbs">
        <a href="/forum">Community</a><span>›</span>
        <a href={`/forum/${section}`}>{sec.name}</a><span>›</span>New thread
      </nav>
      <form onSubmit={submit} className="composer">
        <h1 className="composer__h">New thread in {sec.name}</h1>
        <input className="composer__title" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Title" maxLength={200} />
        <textarea className="composer__body" value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="What's on your mind?" rows={8} maxLength={20000} />
        {msg && <p className="authcard__err">{msg}</p>}
        <div className="composer__actions">
          <a href={`/forum/${section}`} className="btn">Cancel</a>
          <button type="submit" className="btn btn--primary" disabled={status === "loading" || userId === undefined}>
            {status === "loading" ? "Posting…" : "Post thread"}
          </button>
        </div>
      </form>
    </main>
  );
}
