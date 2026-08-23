"use client";

// The "Raise your hit rate" value-prop drawer renders OPEN by default (server-side)
// so first-time visitors and logged-out members are greeted by it. Logged-in members
// have already seen the pitch, so this tiny helper closes the drawer on mount once it
// confirms a Supabase session exists. Pure-CSS toggle stays the mechanism; this only
// flips the checkbox for signed-in users, and the left-edge tab still reopens it.
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function PitchAutoClose() {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    let active = true;
    createClient().auth.getUser().then(({ data }) => {
      if (!active || !data.user) return;   // logged out → leave the drawer open
      const chk = document.getElementById("lp-pitch-toggle") as HTMLInputElement | null;
      if (chk) chk.checked = false;        // logged in → collapse it to the pinned tab
    });
    return () => { active = false; };
  }, []);
  return null;
}
