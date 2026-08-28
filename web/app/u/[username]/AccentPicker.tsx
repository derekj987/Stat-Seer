"use client";

// Owner-only: pick a personal accent color for your profile (drives the name tag, cover
// gradient + story rings). Stored on profiles.accent_color. A fixed palette keeps it on-brand.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const COLORS = ["#b8860b", "#17794a", "#2f6fed", "#8b5cf6", "#c0392b", "#0d9488", "#db2777", "#d97706"];

export default function AccentPicker({ userId, current }: { userId: string; current: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function pick(c: string | null) {
    setBusy(true); setErr("");
    const { error } = await createClient().from("profiles").update({ accent_color: c }).eq("id", userId);
    setBusy(false);
    if (error) {
      setErr(/accent_color/.test(error.message) ? "Run the latest profile_upgrade.sql to enable themes." : error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="paccent">
      <button className="paccent__btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>🎨 Theme</button>
      {open && (
        <div className="paccent__pop" role="menu">
          {COLORS.map((c) => (
            <button key={c} className={`paccent__sw${current === c ? " on" : ""}`} style={{ background: c }}
              onClick={() => pick(c)} disabled={busy} aria-label={`Accent ${c}`} />
          ))}
          <button className="paccent__reset" onClick={() => pick(null)} disabled={busy}>Default</button>
          {err && <p className="paccent__err">{err}</p>}
        </div>
      )}
    </div>
  );
}
