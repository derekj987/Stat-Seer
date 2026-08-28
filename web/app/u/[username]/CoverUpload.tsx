"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB (covers are wide)

export default function CoverUpload({ userId }: { userId: string }) {
  const router = useRouter();
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

  // Native <label> so the picker opens on tap without a JS input.click() (mobile-safe).
  return (
    <>
      <label className="pcover__edit">
        {busy ? "Uploading…" : "📷 Edit cover"}
        <input type="file" accept="image/*" hidden disabled={busy} onChange={onPick} />
      </label>
      {msg && <span className="pcover__msg">{msg}</span>}
    </>
  );
}
