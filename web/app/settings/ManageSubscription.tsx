"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// The settings card that makes /terms section 4 true: "You can cancel at any time from your
// account settings, by yourself, without contacting us."
//
// 🚨 THE BUTTON IS ALWAYS OFFERED TO A MEMBER WHO HAS A ROW, including one whose subscription is
// already cancelling or past due. Hiding "Manage" the moment status leaves 'active' is how a
// member with a failed card ends up with no way to fix it and no way out — which is exactly the
// dark pattern the cancellation promise exists to rule out.
interface Sub {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  card_brand: string | null;
  card_last4: string | null;
}

const WORDING: Record<string, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Payment failed — we're retrying",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
  incomplete_expired: "Incomplete",
  paused: "Paused",
};

export default function ManageSubscription() {
  const [sub, setSub] = useState<Sub | null | undefined>(undefined);   // undefined = loading
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setSub(null); return;
    }
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { setSub(null); return; }
      // RLS limits this to the member's own row (see ingest/subscriptions.sql).
      const { data: rows, error } = await sb.from("subscriptions")
        .select("status,current_period_end,cancel_at_period_end,card_brand,card_last4")
        .eq("user_id", data.user.id).limit(1);
      if (error) { setSub(null); return; }     // table not migrated yet — render nothing
      setSub((rows?.[0] as Sub) ?? null);
    });
  }, []);

  async function openPortal() {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!j?.ok || !j.url) { setErr(j?.error || "Could not open billing."); setBusy(false); return; }
      window.location.href = j.url;
    } catch { setErr("Could not open billing."); setBusy(false); }
  }

  if (sub === undefined) return null;              // still loading — no flicker
  if (sub === null) {
    return (
      <section className="setcard">
        <h2 className="setcard__h">Subscription</h2>
        <p className="setcard__email">No active subscription.</p>
        <p className="setcard__hint"><a href="/pricing">See what a subscription includes</a>.</p>
      </section>
    );
  }

  const renews = sub.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <section className="setcard">
      <h2 className="setcard__h">Subscription</h2>
      <p className="setcard__email">{WORDING[sub.status] ?? sub.status}</p>
      {renews ? (
        <p className="setcard__hint">
          {sub.cancel_at_period_end
            // Say what actually happens, with the date. "Cancelled" on its own reads as access
            // already gone, and a member who has paid through the period has not lost it.
            ? <>Cancelled — your access continues until <b>{renews}</b>, and you will not be charged again.</>
            : <>Renews automatically on <b>{renews}</b> unless you cancel before then.</>}
        </p>
      ) : null}
      {sub.card_brand && sub.card_last4 ? (
        <p className="setcard__hint">{sub.card_brand} ending {sub.card_last4}</p>
      ) : null}
      <button type="button" className="btn" onClick={openPortal} disabled={busy}>
        {busy ? "Opening…" : "Manage or cancel subscription"}
      </button>
      {err ? <p className="setcard__warn">{err}</p> : null}
      <p className="setcard__hint">
        Opens our payment provider, where you can cancel, change plan, update your card and see past invoices.
      </p>
    </section>
  );
}
