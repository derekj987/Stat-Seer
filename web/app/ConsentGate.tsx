"use client";

// Re-accept prompt: if a logged-in member's most recent consent isn't for the CURRENT
// LEGAL_VERSION (e.g. they agreed to the old 18+ terms, or predate consent recording), block
// the app with a modal until they agree to the updated Terms + Privacy. Agreeing appends a
// fresh consent row. Fails OPEN if the consents table isn't set up yet (so nothing breaks
// before the migration is run).
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LEGAL_VERSION } from "@/lib/legal";

export default function ConsentGate() {
  const [need, setNeed] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUid(data.user.id);
      const { data: rows, error } = await sb.from("consents")
        .select("legal_version").eq("user_id", data.user.id).order("recorded_at", { ascending: false }).limit(1);
      if (error) return; // table not migrated yet — don't block
      if (rows?.[0]?.legal_version !== LEGAL_VERSION) setNeed(true);
    });
  }, []);

  async function accept() {
    if (!uid || !agree) return;
    setBusy(true); setErr("");
    const { error } = await createClient().from("consents").insert({
      user_id: uid, legal_version: LEGAL_VERSION, agreed_at: new Date().toISOString(),
      user_agent: (navigator.userAgent || "").slice(0, 300),
    });
    setBusy(false);
    if (error) { setErr("Couldn't save that — please try again."); return; }
    setNeed(false);
  }

  if (!need) return null;

  return (
    <div className="consentgate" role="dialog" aria-modal="true" aria-labelledby="consentgate-h">
      <div className="consentgate__card">
        <h2 className="consentgate__h" id="consentgate-h">We&apos;ve updated our terms</h2>
        <p className="consentgate__p">
          Our <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> have changed — the minimum
          age for StatSeer is now <b>21+</b>. Please review and agree to keep using your account.
        </p>
        <label className="consentgate__check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I am 21 or older and agree to the updated Terms of Service and Privacy Policy.</span>
        </label>
        {err && <p className="consentgate__err">{err}</p>}
        <button className="btn btn--primary consentgate__btn" disabled={!agree || busy} onClick={accept}>
          {busy ? "Saving…" : "Agree & continue"}
        </button>
        <p className="consentgate__alt">Don&apos;t agree? You can <a href="/settings">delete your account</a>.</p>
      </div>
    </div>
  );
}
