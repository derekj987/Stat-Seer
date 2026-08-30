"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MAX = 5000;
const MAX_IMAGES = 4;
const MAX_IMG_BYTES = 5 * 1024 * 1024; // 5 MB each

export default function WallForm({ profileId, ownName }: { profileId: string; ownName: string | null }) {
  const router = useRouter();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<string[]>([]);   // uploaded public URLs
  const [uploading, setUploading] = useState(false);
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

  async function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file later
    if (!picked.length || !userId) return;
    setMsg("");
    const room = MAX_IMAGES - media.length;
    if (room <= 0) { setMsg(`Up to ${MAX_IMAGES} photos per post.`); return; }

    setUploading(true);
    const supabase = createClient();
    const added: string[] = [];
    for (const file of picked.slice(0, room)) {
      if (!file.type.startsWith("image/")) { setMsg("Only image files."); continue; }
      if (file.size > MAX_IMG_BYTES) { setMsg("Each image must be under 5 MB."); continue; }
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${userId}/${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
      const up = await supabase.storage.from("wall-media").upload(path, file, { contentType: file.type });
      if (up.error) {
        setMsg(/bucket|not found|does not exist/i.test(up.error.message)
          ? "Run ingest/wall_media.sql in Supabase to enable photos." : up.error.message);
        continue;
      }
      added.push(supabase.storage.from("wall-media").getPublicUrl(path).data.publicUrl);
    }
    setMedia((m) => [...m, ...added]);
    setUploading(false);
  }

  async function removeImage(url: string) {
    setMedia((m) => m.filter((u) => u !== url));
    // best-effort delete from storage (path is everything after the bucket segment)
    const marker = "/wall-media/";
    const idx = url.indexOf(marker);
    if (idx !== -1) {
      const path = url.slice(idx + marker.length).split("?")[0];
      try { await createClient().storage.from("wall-media").remove([path]); } catch { /* leave orphan */ }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || uploading) return;
    if (body.trim().length < 1 && media.length === 0) return;
    setStatus("loading"); setMsg("");
    const row: Record<string, unknown> = { profile_id: profileId, author_id: userId, body: body.trim() };
    if (media.length) row.media = media;
    const { error } = await createClient().from("wall_posts").insert(row);
    if (error) { setStatus("error"); setMsg(error.message); return; }
    setBody(""); setMedia([]); setStatus("idle");
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
  const canPost = status !== "loading" && !uploading && (body.trim().length > 0 || media.length > 0);

  return (
    <form onSubmit={submit} className="composer">
      <div className="composer__toolbar" role="toolbar" aria-label="Formatting">
        {tools.map(([label, node, fn]) => (
          <button key={label} type="button" className="composer__tbtn" title={label} aria-label={label}
            onMouseDown={(e) => e.preventDefault()} onClick={fn}>{node}</button>
        ))}
        <label className="composer__tbtn composer__tbtn--photo" title="Add photos"
          aria-label="Add photos" aria-disabled={media.length >= MAX_IMAGES}>
          🖼 Photo
          <input type="file" accept="image/*" multiple hidden
            disabled={uploading || media.length >= MAX_IMAGES} onChange={onPickImages} />
        </label>
        <span className="composer__hint">Markdown supported</span>
      </div>

      <textarea ref={taRef} className="composer__body" value={body} onChange={(e) => setBody(e.target.value)}
        placeholder={ownName ? "Share a pick, a photo, or a thought…" : "Write something…"} maxLength={MAX} />

      {(media.length > 0 || uploading) && (
        <div className="composer__media">
          {media.map((u) => (
            <div className="composer__thumb" key={u}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" />
              <button type="button" className="composer__thumbx" onClick={() => removeImage(u)}
                aria-label="Remove photo">×</button>
            </div>
          ))}
          {uploading && <div className="composer__thumb composer__thumb--load">…</div>}
        </div>
      )}

      <div className="composer__foot">
        <span className="composer__count">{body.length}/{MAX}{media.length ? ` · ${media.length} photo${media.length === 1 ? "" : "s"}` : ""}</span>
        <button type="submit" className="btn btn--primary" disabled={!canPost}>
          {status === "loading" ? "Posting…" : uploading ? "Uploading…" : "Post"}
        </button>
      </div>
      {msg && <p className="authcard__err">{msg}</p>}
    </form>
  );
}
