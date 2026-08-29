"use client";

// Comments on a wall post. Reads come from the server (initial); writes go through the
// authenticated client + RLS (insert your own; delete own / as wall owner / as mod).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthorTag } from "../../forum/AuthorTag";
import RichText from "./RichText";
import type { WallComment } from "@/lib/profile";

const MOD_ROLES = ["founder", "admin", "mod"];
const MAX = 2000;
const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function PostComments({ postId, profileId, me, initial }: {
  postId: string;
  profileId: string;            // whose wall this post is on
  me: { id: string; role: string } | null;
  initial: WallComment[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initial.length > 0 && initial.length <= 3);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const count = initial.length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!me || body.trim().length < 1 || busy) return;
    setBusy(true); setErr("");
    const { error } = await createClient().from("wall_comments")
      .insert({ post_id: postId, author_id: me.id, body: body.trim() });
    setBusy(false);
    if (error) {
      setErr(/relation .*wall_comments|does not exist/.test(error.message)
        ? "Run ingest/wall_social.sql in Supabase to enable comments." : "Couldn't post that comment.");
      return;
    }
    setBody(""); router.refresh();
  }

  async function del(id: string) {
    if (!confirm("Delete this comment?")) return;
    const { error } = await createClient().from("wall_comments").delete().eq("id", id);
    if (error) { alert(error.message); return; }
    router.refresh();
  }

  return (
    <div className="cmts">
      <button type="button" className="cmts__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        💬 {count === 0 ? "Comment" : `${count} comment${count === 1 ? "" : "s"}`}
      </button>

      {open && (
        <div className="cmts__body">
          {initial.map((c) => {
            const canDelete = !!me && (me.id === c.authorId || me.id === profileId || MOD_ROLES.includes(me.role));
            return (
              <div key={c.id} className="cmt">
                <div className="cmt__head">
                  <AuthorTag author={c.author} />
                  <time className="cmt__time">{fmt.format(new Date(c.createdAt))} ET</time>
                  {canDelete && (
                    <button type="button" className="cmt__del" onClick={() => del(c.id)} title="Delete comment">×</button>
                  )}
                </div>
                <div className="cmt__text"><RichText text={c.body} /></div>
              </div>
            );
          })}

          {me ? (
            <form onSubmit={submit} className="cmtform">
              <textarea className="cmtform__ta" value={body} maxLength={MAX} rows={2}
                onChange={(e) => setBody(e.target.value)} placeholder="Write a comment…" />
              <div className="cmtform__foot">
                {err && <span className="cmtform__err">{err}</span>}
                <button type="submit" className="btn btn--primary cmtform__send" disabled={busy || !body.trim()}>
                  {busy ? "…" : "Comment"}
                </button>
              </div>
            </form>
          ) : (
            <p className="cmts__login"><a href="/login">Log in</a> to comment.</p>
          )}
        </div>
      )}
    </div>
  );
}
