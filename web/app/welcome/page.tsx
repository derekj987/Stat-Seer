"use client";

// Pick-your-username step for Google sign-in.
//
// A Google account carries no username, so handle_new_user() falls back to a generated
// 'member_<8 hex>' placeholder (see ingest/oauth_username.sql). That placeholder is the name that
// then shows in the forum, on their wall and in DMs. This page is where a Google member gets the
// choice the email signup form gives everyone else.
//
// /auth/callback sends them here whenever the profile still holds a placeholder — so it also
// catches the Google members who signed up before this shipped, on their next sign-in.
//
// It is NOT the one-time rename. claim_username() only accepts a placeholder and deliberately
// leaves username_changed_at null, so the member still keeps their one change afterwards.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PLACEHOLDER = /^member_[0-9a-f]{8}$/;

/** Same allow-list as the callback route: same-site paths only, never a bare "//" or "/\" which
 *  the URL parser turns into another host. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/forum";
  return raw;
}

export default function Welcome() {
  const router = useRouter();
  const [current, setCurrent] = useState<string | null>(null);   // null until loaded
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("/forum");

  useEffect(() => {
    setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.replace("/login"); return; }
      const { data: prof } = await sb.from("profiles").select("username").eq("id", data.user.id).single();
      const u = (prof?.username as string) ?? "";
      // Already has a real name (or we couldn't read one) — nothing to ask. Don't strand them here.
      if (!u || !PLACEHOLDER.test(u)) {
        router.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
        return;
      }
      setCurrent(u);
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const want = name.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(want)) {
      setMsg("3–20 characters, letters, numbers or underscores only."); return;
    }
    setBusy(true);
    // The rule lives in the database. This call cannot be talked into renaming a real username
    // from the console; the check above only buys a faster, friendlier message.
    const { data, error } = await createClient().rpc("claim_username", { new_username: want });
    setBusy(false);
    if (error) { setMsg("Couldn't save that username. Please try again."); return; }
    const r = (data ?? {}) as { ok?: boolean; error?: string };
    if (r.ok) { router.replace(next); return; }
    setMsg(
      r.error === "taken" ? "That username is already taken — try another." :
      r.error === "bad_format" ? "3–20 characters, letters, numbers or underscores only." :
      r.error === "not_placeholder" ? "You've already chosen a username." :
      "Couldn't save that username. Please try again.");
  }

  // Don't flash the form before we know there's anything to ask.
  if (current === null) return <main className="authwrap" />;

  return (
    <main className="authwrap">
      <div className="authcard">
        <a href="/" className="authcard__brand">STATSEER</a>
        <h1 className="authcard__h">Pick your username</h1>
        <p className="authcard__sub">
          You&apos;re signed in with Google, so we gave you a temporary handle
          — <b>{current}</b>. Choose the name you&apos;d rather show up as in the forum, on your
          wall and in messages.
        </p>
        <form onSubmit={submit} className="authform">
          <label className="authfield">Username
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username"
              placeholder="how you'll show up in the forum" maxLength={20} autoFocus required />
          </label>
          {msg && <p className="authcard__err">{msg}</p>}
          <button type="submit" className="btn btn--primary authbtn" disabled={busy}>
            {busy ? "Saving…" : "That's my name"}
          </button>
        </form>
        <p className="authcard__alt">
          You can change it once later in <a href="/settings">Settings</a> — this pick doesn&apos;t
          use that up. <a href={next}>Skip for now</a>
        </p>
      </div>
    </main>
  );
}
