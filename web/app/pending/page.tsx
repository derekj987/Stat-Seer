"use client";

// Private-beta waiting room. A signed-in member whose account hasn't been approved
// yet is routed here by the proxy. If they're actually approved (or signed out) we
// bounce them on so this page is never a dead end.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Pending() {
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { location.href = "/login"; return; }
      setEmail(data.user.email ?? null);
      const { data: prof } = await sb.from("profiles").select("status").eq("id", data.user.id).maybeSingle();
      if (prof?.status === "approved") { location.href = "/nfl"; return; }
      // Let the ops inbox know a request is waiting (server sends once, then flags it).
      fetch("/api/beta/notify", { method: "POST" }).catch(() => {});
      setChecking(false);
    });
  }, []);

  async function logout() {
    await createClient().auth.signOut();
    location.href = "/";
  }

  return (
    <main className="authwrap">
      <div className="authcard">
        <a href="/" className="authcard__brand">STATSEER</a>
        <h1 className="authcard__h">You&apos;re on the list 🎉</h1>
        <p className="authcard__ok">
          Your account{email ? <> for <b>{email}</b></> : ""} was created and your request to join the{" "}
          <b>StatSeer private beta</b> has been submitted for approval.
        </p>
        <p className="authcard__ok" style={{ marginTop: 12 }}>
          We&apos;re onboarding members in small batches while we polish things up. You&apos;ll get an email
          the moment you&apos;re approved — then just sign in and the full site opens up.
        </p>
        {!checking && (
          <p className="authcard__alt">Nothing else to do for now — you can close this tab.</p>
        )}
        <div className="authcard__row">
          <a href="/" className="btn">Back to homepage</a>
          <button type="button" className="btn" onClick={logout}>Sign out</button>
        </div>
      </div>
    </main>
  );
}
