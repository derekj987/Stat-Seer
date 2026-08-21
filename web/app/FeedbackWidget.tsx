"use client";

// Global "have an idea, fix, or suggestion?" mailbox. A small floating envelope button on
// every page opens a comment form ("Tell us what's up?"); submitting writes a row to the
// Supabase `feedback` table (see ingest/feedback.sql), which founders review at /feedback.
// Open to everyone — anonymous or signed-in; captures the page they were on and, if signed
// in, their user id, plus an optional reply email.
import { useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "done" | "error";

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const path = usePathname() || "/";

  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!msg.trim() || status === "sending") return;
    setStatus("sending");
    try {
      if (!configured) throw new Error("not configured");
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      const { error } = await supabase.from("feedback").insert({
        message: msg.trim(),
        email: email.trim() || null,
        user_id: data.user?.id ?? null,
        path,
      });
      if (error) throw error;
      // Best-effort email to the team inbox — never block the UX on it (the row is saved).
      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg.trim(), email: email.trim() || null, path }),
      }).catch(() => {});
      setStatus("done");
      setMsg(""); setEmail("");
    } catch {
      setStatus("error");
    }
  }

  function close() { setOpen(false); }

  return (
    <>
      <button
        className="fbw__btn"
        aria-label="Send feedback — have an idea, fix, or suggestion?"
        title="Have an idea, fix, or suggestion?"
        onClick={() => { setOpen(true); setStatus("idle"); }}
      >
        <Image src="/pigeon.png" alt="" fill sizes="46px" aria-hidden="true"
          className="fbw__pigeon" style={{ objectFit: "cover", objectPosition: "72% 40%" }} />
      </button>

      {open && (
        <div className="fbw__scrim" onClick={close} role="presentation">
          <div className="fbw__card" role="dialog" aria-label="Send feedback" aria-modal="true"
            onClick={(e) => e.stopPropagation()}>
            <button className="fbw__x" onClick={close} aria-label="Close">✕</button>
            <h2 className="fbw__h">Tell us what&apos;s up?</h2>
            <p className="fbw__sub">Have an idea, a fix, or a suggestion? We read every one.</p>

            {status === "done" ? (
              <div className="fbw__done">
                <span className="fbw__done__ic" aria-hidden="true">📮</span>
                Thanks — got it! We&apos;ll take a look.
                <button className="btn fbw__doneclose" onClick={close}>Close</button>
              </div>
            ) : (
              <form onSubmit={submit}>
                <textarea
                  className="fbw__ta"
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  placeholder="Your idea, fix, or suggestion…"
                  rows={5}
                  maxLength={2000}
                  autoFocus
                />
                <input
                  className="fbw__email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email (optional — if you'd like a reply)"
                />
                {status === "error" && (
                  <p className="fbw__err">
                    Couldn&apos;t send that just now — please try again{configured ? "" : " once the site is fully live"}.
                  </p>
                )}
                <button className="btn btn--primary fbw__send" type="submit" disabled={status === "sending" || !msg.trim()}>
                  {status === "sending" ? "Sending…" : "Send it →"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
