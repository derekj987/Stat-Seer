"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading"); setMsg("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setStatus("error"); setMsg(error.message); return; }
    router.push("/forum");
    router.refresh();
  }

  return (
    <main className="authwrap">
      <div className="authcard">
        <a href="/" className="authcard__brand">STATSEER</a>
        <h1 className="authcard__h">Log in</h1>
        <form onSubmit={submit} className="authform">
          <label className="authfield">Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="email" required />
          </label>
          <label className="authfield">Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" required />
          </label>
          {msg && <p className="authcard__err">{msg}</p>}
          <button type="submit" className="btn btn--primary authbtn" disabled={status === "loading"}>
            {status === "loading" ? "Logging in…" : "Log in"}
          </button>
        </form>
        <p className="authcard__alt">New here? <a href="/signup">Create an account</a></p>
      </div>
    </main>
  );
}
