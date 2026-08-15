"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export default function AvatarUpload({ userId }: { userId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg("");
    if (!file.type.startsWith("image/")) { setMsg("Pick an image file."); return; }
    if (file.size > MAX_BYTES) { setMsg("Image must be under 2 MB."); return; }

    setBusy(true);
    const supabase = createClient();
    const path = `${userId}/avatar`;
    const up = await supabase.storage.from("avatars").upload(path, file, {
      upsert: true, contentType: file.type,
    });
    if (up.error) { setBusy(false); setMsg(up.error.message); return; }

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    // cache-bust so the new image shows immediately (same storage path)
    const url = `${data.publicUrl}?v=${Date.now()}`;
    const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    router.refresh();
  }

  return (
    <div className="avup">
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
      <button type="button" className="postact__btn" disabled={busy}
        onClick={() => inputRef.current?.click()}>
        {busy ? "Uploading…" : "Change photo"}
      </button>
      {msg && <p className="avup__msg">{msg}</p>}
    </div>
  );
}
