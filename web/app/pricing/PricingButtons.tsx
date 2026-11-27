"use client";

import { useState } from "react";

// The pay button. The DISCLOSURE sits beside it rather than on /terms alone, because that is what
// automatic-renewal law actually asks for: the recurring terms, clearly and conspicuously, at the
// point of purchase — not a link to a document containing them.
export default function PricingButtons({ annual }: { annual: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function go(plan: "monthly" | "annual") {
    setBusy(plan); setErr("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) { window.location.href = "/login?next=/pricing"; return; }
      if (!j?.ok || !j.url) { setErr(j?.error || "Could not start checkout."); setBusy(null); return; }
      window.location.href = j.url;          // Stripe-hosted checkout
    } catch {
      setErr("Could not start checkout."); setBusy(null);
    }
  }

  return (
    <div className="pricing__act">
      <button className="btn btn--primary" onClick={() => go("monthly")} disabled={busy !== null}>
        {busy === "monthly" ? "Starting…" : "Subscribe monthly"}
      </button>
      {annual ? (
        <button className="btn" onClick={() => go("annual")} disabled={busy !== null}>
          {busy === "annual" ? "Starting…" : "Subscribe annually"}
        </button>
      ) : null}
      {err ? <p className="pricing__err">{err}</p> : null}
    </div>
  );
}
