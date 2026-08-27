"use client";

// Where a password-reset link lands (via /auth/callback?next=/reset). By the time the
// member is here they carry a recovery session (the callback exchanged the emailed code),
// which is exactly the "email verified" proof — so they can set a new password.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPassword() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null); // do we have a recovery session?
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => setReady(!!data.session));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setStatus("error"); setMsg("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setStatus("error"); setMsg("Those passwords don't match."); return; }
    setStatus("loading"); setMsg("");
    const { error } = await createClient().auth.updateUser({ password });
    if (error) { setStatus("error"); setMsg(error.message); return; }
    setStatus("done");
    setTimeout(() => { router.push("/forum"); router.refresh(); }, 1600);
  }

  return (
    <main className="authwrap">
      <div className="authcard">
        <a href="/" className="authcard__brand">STATSEER</a>
        <h1 className="authcard__h">Set a new password</h1>

        {ready === null ? (
          <p className="authcard__sub">Checking your reset link…</p>
        ) : !ready ? (
          <p className="authcard__err">
            This reset link is invalid or has expired. Request a fresh one from the{" "}
            <a href="/login">log in</a> page.
          </p>
        ) : status === "done" ? (
          <p className="authcard__ok">Password updated — signing you in…</p>
        ) : (
          <form onSubmit={submit} className="authform">
            <label className="authfield">New password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password" minLength={8} required />
            </label>
            <label className="authfield">Confirm new password
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password" minLength={8} required />
            </label>
            {status === "error" && msg && <p className="authcard__err">{msg}</p>}
            <button type="submit" className="btn btn--primary authbtn" disabled={status === "loading"}>
              {status === "loading" ? "Saving…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
