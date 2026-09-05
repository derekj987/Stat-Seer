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

  // Username, and whether the one change has been used. `changedAt === undefined` means we
  // haven't loaded yet; null means never changed (the change is still available).
  const [uname, setUname] = useState("");
  const [changedAt, setChangedAt] = useState<string | null | undefined>(undefined);
  const [newName, setNewName] = useState("");
  const [nameMsg, setNameMsg] = useState("");
  const [nameBusy, setNameBusy] = useState(false);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      setEmail(data.user?.email ?? null);
      if (!data.user) return;
      // Two-step read, because profiles is locked to a column allow-list
      // (roster_privacy_authed.sql) and `username_changed_at` was added to the table after that
      // list was written. Selecting a column a member cannot read fails the WHOLE select, so the
      // first attempt used to return null, this effect returned early, and the Username card was
      // never drawn — which is exactly how it looked to a member: silently absent.
      //
      // So: ask for the timestamp, and if that is refused fall back to the username alone and
      // still offer the form. Nothing is lost by guessing "not yet changed" here — the once-rule
      // lives in change_username(), which returns `already_changed` and refuses. The UI is a
      // convenience; the database is the authority.
      const full = await sb.from("profiles")
        .select("username,username_changed_at").eq("id", data.user.id).single();
      if (full.data) {
        setUname((full.data.username as string) ?? "");
        setChangedAt((full.data as Record<string, unknown>).username_changed_at as string ?? null);
        return;
      }
      const basic = await sb.from("profiles").select("username").eq("id", data.user.id).single();
      if (!basic.data) return;                     // no profile at all — leave the card hidden
      setUname((basic.data.username as string) ?? "");
      setChangedAt(null);                          // offer it; the RPC enforces the real rule
    });
  }, []);

  async function changeUsername(e: React.FormEvent) {
    e.preventDefault();
    setNameMsg("");
    const want = newName.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(want)) {
      setNameMsg("3–20 characters, letters, numbers or underscores only."); return;
    }
    setNameBusy(true);
    // The once-rule lives in the database, not here — this call can't be talked out of it from
    // the console. The client check above is only to give a faster, friendlier message.
    const { data, error } = await createClient().rpc("change_username", { new_username: want });
    setNameBusy(false);
    if (error) { setNameMsg("Couldn't change your username. Please try again."); return; }
    const r = (data ?? {}) as { ok?: boolean; error?: string; username?: string };
    if (r.ok) {
      setUname(r.username ?? want);
      setChangedAt(new Date().toISOString());
      setNameMsg("Username updated ✓");
      return;
    }
    setNameMsg(
      r.error === "taken" ? "That username is already taken — try another." :
      r.error === "already_changed" ? "You've already used your one username change." :
      r.error === "bad_format" ? "3–20 characters, letters, numbers or underscores only." :
      r.error === "unchanged" ? "That's already your username." :
      "Couldn't change your username. Please try again.");
  }

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

      {/* First card on the page: a member who signed in with Google was handed a generated name
          like member_f315ce11, and this is the only place to fix it. */}
      {changedAt !== undefined && (
        <section className="setcard">
          <h2 className="setcard__h">Username</h2>
          <p className="setcard__email">{uname}</p>
          {changedAt === null ? (
            <form onSubmit={changeUsername} className="setform">
              <p className="setcard__warn">
                You can change your username <b>once</b>. Pick carefully — it&apos;s how you show up
                in the forum, on your profile and in chat, and it can&apos;t be changed again.
              </p>
              <input className="setinput" placeholder="New username" value={newName}
                onChange={(e) => setNewName(e.target.value)} autoComplete="username"
                maxLength={20} aria-label="New username" />
              {nameMsg && <p className="setmsg">{nameMsg}</p>}
              <button type="submit" className="btn btn--primary" disabled={nameBusy || !newName.trim()}>
                {nameBusy ? "Saving…" : "Change my username"}
              </button>
              <p className="setcard__hint">3–20 characters — letters, numbers and underscores.</p>
            </form>
          ) : (
            <>
              {nameMsg && <p className="setmsg">{nameMsg}</p>}
              <p className="setcard__hint">
                You&apos;ve used your one username change
                {` (${new Date(changedAt).toLocaleDateString()})`}. Message us if something&apos;s wrong.
              </p>
            </>
          )}
        </section>
      )}

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
