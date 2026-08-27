"use client";

// Global presence heartbeat: while a signed-in member has a tab open (and visible), stamp
// profiles.last_seen every ~60s so their friends can see them as "online". Cheap (one tiny
// update/minute per active user) and self-contained. No-op for guests / unconfigured env.
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Presence() {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const sb = createClient();
    let uid: string | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const beat = () => {
      if (!uid || document.hidden) return;
      sb.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", uid).then(() => {}, () => {});
    };
    sb.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      uid = data.user.id;
      beat();
      timer = setInterval(beat, 60000);
    });
    const onVis = () => { if (!document.hidden) beat(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { if (timer) clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return null;
}
