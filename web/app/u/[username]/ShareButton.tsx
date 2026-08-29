"use client";

import { useState } from "react";

// Copy the profile's public link to the clipboard — the standard "share profile" affordance.
export default function ShareButton({ username }: { username: string }) {
  const [done, setDone] = useState(false);
  async function share() {
    const url = `${window.location.origin}/u/${username}`;
    try {
      if (navigator.share) { await navigator.share({ title: `${username} on StatSeer`, url }); return; }
      await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch { /* user dismissed the share sheet, or clipboard blocked — no-op */ }
  }
  return (
    <button type="button" className="pbtn pbtn--ghost" onClick={share} title="Copy link to this profile">
      {done ? "✓ Link copied" : "↗ Share"}
    </button>
  );
}
