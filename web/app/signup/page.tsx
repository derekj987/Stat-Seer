"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LEGAL_VERSION } from "@/lib/legal";
import { GoogleButton } from "../GoogleAuth";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [over21, setOver21] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      setStatus("error"); setMsg("Username must be 3–20 letters, numbers, or underscores."); return;
    }
    if (password.length < 8) {
      setStatus("error"); setMsg("Password must be at least 8 characters."); return;
    }
    if (!over21) {
      setStatus("error"); setMsg("You must confirm you are 21+ and agree to the Terms and Privacy Policy."); return;
    }
    setStatus("loading");
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Consent details recorded with the account (a trigger writes the `consents` audit
        // row from this metadata): which legal version, when they agreed, and the device.
        data: {
          username,
          legal_version: LEGAL_VERSION,
          consent_at: new Date().toISOString(),
          user_agent: (navigator.userAgent || "").slice(0, 300),
        },
        emailRedirectTo: `${location.origin}/auth/callback`,
      },
    });
    if (error) { setStatus("error"); setMsg(error.message); return; }
    setStatus("sent");
  }

  return (
    <main className="authwrap">
      <div className="authcard">
        <a href="/" className="authcard__brand">STATSEER</a>
        <h1 className="authcard__h">Create your account</h1>

        {status === "sent" ? (
          <p className="authcard__ok">
            Check your email — we sent a confirmation link to <b>{email}</b>. Click it to activate your
            account, then <a href="/login">log in</a>.
          </p>
        ) : (
          <>
            {/* Consent gates BOTH sign-up methods — you must be 21+ and agree before Google or email. */}
            <label className="authcheck">
              <input type="checkbox" checked={over21} onChange={(e) => setOver21(e.target.checked)} />
              <span>I am 21 or older and agree to the{" "}
                <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and{" "}
                <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span>
            </label>
            <GoogleButton label="Sign up with Google" disabled={!over21}
              onBlocked={() => { setStatus("error"); setMsg("Please confirm you're 21+ and agree to the Terms above first."); }} />
            <form onSubmit={submit} className="authform">
              <label className="authfield">Username
                <input value={username} onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username" placeholder="how you'll show up in the forum" required />
              </label>
              <label className="authfield">Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email" required />
              </label>
              <label className="authfield">Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password" minLength={8} required />
              </label>
              {msg && <p className="authcard__err">{msg}</p>}
              <button type="submit" className="btn btn--primary authbtn" disabled={status === "loading"}>
                {status === "loading" ? "Creating…" : "Create account"}
              </button>
            </form>
          </>
        )}

        <p className="authcard__alt">Already a member? <a href="/login">Log in</a></p>
      </div>
    </main>
  );
}
