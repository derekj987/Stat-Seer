"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB (covers are wide)

export default function CoverUpload({ userId }: { userId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg("");
    if (!file.type.startsWith("image/")) { setMsg("Pick an image."); return; }
    if (file.size > MAX_BYTES) { setMsg("Under 4 MB, please."); return; }
    setBusy(true);
    const supabase = createClient();
    const path = `${userId}/cover`; // owner-scoped folder, same bucket as avatars
    const up = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
    if (up.error) { setBusy(false); setMsg(up.error.message); return; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = `${data.publicUrl}?v=${Date.now()}`;
    const { error } = await supabase.from("profiles").update({ cover_url: url }).eq("id", userId);
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    router.refresh();
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
      <button type="button" className="pcover__edit" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? "Uploading…" : "📷 Edit cover"}
      </button>
      {msg && <span className="pcover__msg">{msg}</span>}
    </>
  );
}
