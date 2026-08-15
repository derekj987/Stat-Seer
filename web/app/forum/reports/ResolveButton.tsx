"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResolveButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    const { error } = await createClient().from("reports").update({ resolved: true }).eq("id", id);
    setBusy(false);
    if (error) { alert(error.message); return; }
    router.refresh();
  }

  return (
    <button type="button" className="btn btn--primary" onClick={resolve} disabled={busy}>
      {busy ? "…" : "Resolve"}
    </button>
  );
}
