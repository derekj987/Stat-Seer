"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GoogleButton } from "../GoogleAuth";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  function switchMode(m: "login" | "forgot") {
    setMode(m); setStatus("idle"); setMsg("");
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading"); setMsg("");
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) { setStatus("error"); setMsg(error.message); return; }
    // Return the member to the page they were gated from (?next=/...), else the community.
    const next = new URLSearchParams(window.location.search).get("next");
    // Reject "//evil.com" and "/\evil.com" (the URL parser normalizes the latter to //evil.com).
    router.push(next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/forum");
    router.refresh();
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    if (!email) { setStatus("error"); setMsg("Enter your account email first."); return; }
    setStatus("loading"); setMsg("");
    // Recovery link lands on /auth/callback, which exchanges the code for a (recovery)
    // session and forwards to /reset where the member sets a new password.
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/callback?next=/reset`,
    });
    if (error) { setStatus("error"); setMsg(error.message); return; }
    setStatus("sent");
  }

  return (
    <main className="authwrap">
      <div className="authcard">
        <a href="/" className="authcard__brand">STATSEER</a>

        {mode === "login" ? (
          <>
            <h1 className="authcard__h">Log in</h1>
            <GoogleButton />
            <form onSubmit={login} className="authform">
              <label className="authfield">Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email" required />
              </label>
              <label className="authfield">Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" required />
              </label>
              {status === "error" && msg && <p className="authcard__err">{msg}</p>}
              <button type="submit" className="btn btn--primary authbtn" disabled={status === "loading"}>
                {status === "loading" ? "Logging in…" : "Log in"}
              </button>
            </form>
            <p className="authcard__alt">
              <button type="button" className="authlink" onClick={() => switchMode("forgot")}>Forgot your password?</button>
            </p>
            <p className="authcard__alt">New here? <a href="/signup">Create an account</a></p>
          </>
        ) : (
          <>
            <h1 className="authcard__h">Reset your password</h1>
            {status === "sent" ? (
              <p className="authcard__ok">
                Check your email — we sent a password-reset link to <b>{email}</b>. Open it (that verifies your
                email) and you&apos;ll be able to set a new password.
              </p>
            ) : (
              <form onSubmit={sendReset} className="authform">
                <p className="authcard__sub">Enter your account email and we&apos;ll send you a secure link to set a new password.</p>
                <label className="authfield">Email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email" required />
                </label>
                {status === "error" && msg && <p className="authcard__err">{msg}</p>}
                <button type="submit" className="btn btn--primary authbtn" disabled={status === "loading"}>
                  {status === "loading" ? "Sending…" : "Send reset link"}
                </button>
              </form>
            )}
            <p className="authcard__alt">
              <button type="button" className="authlink" onClick={() => switchMode("login")}>← Back to log in</button>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
