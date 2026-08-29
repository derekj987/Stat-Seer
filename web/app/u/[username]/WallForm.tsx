"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MAX = 5000;

export default function WallForm({ profileId, ownName }: { profileId: string; ownName: string | null }) {
  const router = useRouter();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Wrap the current selection with markdown (or prefix each line, for a list). Keeps focus and a
  // sensible caret so the toolbar feels native.
  function apply(before: string, after = before, linePrefix = false) {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = body.slice(s, e);
    let insert: string;
    if (linePrefix) {
      insert = (sel || "list item").split("\n").map((l) => before + l).join("\n");
    } else {
      insert = before + (sel || "text") + after;
    }
    const next = body.slice(0, s) + insert + body.slice(e);
    setBody(next.slice(0, MAX));
    requestAnimationFrame(() => {
      ta.focus();
      const caret = s + insert.length;
      ta.setSelectionRange(caret, caret);
    });
  }

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
        <a href="/login">Log in</a> or <a href="/signup">sign up</a> to post here.
      </p>
    );
  }

  const tools: [string, React.ReactNode, () => void][] = [
    ["Bold", <b key="b">B</b>, () => apply("**")],
    ["Italic", <i key="i">I</i>, () => apply("_")],
    ["Bulleted list", "• List", () => apply("- ", "", true)],
    ["Link", "🔗 Link", () => apply("[", "](https://)")],
  ];

  return (
    <form onSubmit={submit} className="composer">
      <div className="composer__toolbar" role="toolbar" aria-label="Formatting">
        {tools.map(([label, node, fn]) => (
          <button key={label} type="button" className="composer__tbtn" title={label} aria-label={label}
            onMouseDown={(e) => e.preventDefault()} onClick={fn}>{node}</button>
        ))}
        <span className="composer__hint">Markdown supported</span>
      </div>
      <textarea ref={taRef} className="composer__body" value={body} onChange={(e) => setBody(e.target.value)}
        placeholder={ownName ? "Share a pick or write something…" : "Write something…"} maxLength={MAX} />
      <div className="composer__foot">
        <span className="composer__count">{body.length}/{MAX}</span>
        <button type="submit" className="btn btn--primary" disabled={status === "loading" || !body.trim()}>
          {status === "loading" ? "Posting…" : "Post"}
        </button>
      </div>
      {msg && <p className="authcard__err">{msg}</p>}
    </form>
  );
}
