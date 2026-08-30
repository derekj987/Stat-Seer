"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [curPw, setCurPw] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delMsg, setDelMsg] = useState("");

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg("");
    if (pw.length < 8) { setPwMsg("New password must be at least 8 characters."); return; }
    if (pw !== pw2) { setPwMsg("New passwords don't match."); return; }
    setPwBusy(true);
    const supabase = createClient();
    // Supabase's "Secure password change" requires re-authentication — verify the current password
    // first (signing in again refreshes the session so updateUser is allowed).
    if (email && curPw) {
      const { error: reauth } = await supabase.auth.signInWithPassword({ email, password: curPw });
      if (reauth) { setPwBusy(false); setPwMsg("Your current password is incorrect."); return; }
    }
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) {
      setPwMsg(/reauthentication|current|not authenticated/i.test(error.message)
        ? "Enter your current password above. Forgot it? Use “Forgot your password?” on the log-in page to reset by email."
        : error.message);
      return;
    }
    setCurPw(""); setPw(""); setPw2(""); setPwMsg("Password updated ✓");
  }

  async function deleteAccount() {
    setDelBusy(true);
    setDelMsg("");
    const res = await fetch("/api/account/delete", { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setDelMsg(j.error || "Couldn't delete the account.");
      setDelBusy(false);
      return;
    }
    await createClient().auth.signOut();
    location.href = "/";
  }

  if (email === undefined) return <main className="wrap"><p className="foot">Loading…</p></main>;
  if (email === null) {
    return (
      <main className="wrap">
        <p className="replyprompt"><a href="/login">Log in</a> to manage your account.</p>
      </main>
    );
  }

  return (
    <main className="wrap settings">
      <h1 className="settings__h">Account settings</h1>

      <section className="setcard">
        <h2 className="setcard__h">Email</h2>
        <p className="setcard__email">{email}</p>
      </section>

      <section className="setcard">
        <h2 className="setcard__h">Change password</h2>
        <form onSubmit={changePw} className="setform">
          <input type="password" className="setinput" placeholder="Current password"
            value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" />
          <input type="password" className="setinput" placeholder="New password"
            value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          <input type="password" className="setinput" placeholder="Confirm new password"
            value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          {pwMsg && <p className="setmsg">{pwMsg}</p>}
          <button type="submit" className="btn btn--primary" disabled={pwBusy}>
            {pwBusy ? "Saving…" : "Update password"}
          </button>
          <p className="setcard__hint">
            Forgot your current password? <a href="/login">Reset it by email</a> instead.
          </p>
        </form>
      </section>

      <section className="setcard setcard--danger">
        <h2 className="setcard__h">Delete account</h2>
        <p className="setcard__warn">
          Permanently deletes your account, profile, and all your posts. This can&apos;t be undone.
        </p>
        {!confirmDel ? (
          <button type="button" className="btn btn--danger" onClick={() => setConfirmDel(true)}>
            Delete my account
          </button>
        ) : (
          <div className="setdel">
            <p className="setcard__warn"><b>Are you sure?</b> There&apos;s no going back.</p>
            {delMsg && <p className="setmsg">{delMsg}</p>}
            <div className="setdel__row">
              <button type="button" className="btn btn--danger" onClick={deleteAccount} disabled={delBusy}>
                {delBusy ? "Deleting…" : "Yes, delete everything"}
              </button>
              <button type="button" className="btn" onClick={() => setConfirmDel(false)} disabled={delBusy}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
