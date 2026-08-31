"use client";

// Confirm button on the email-approve landing. POSTs to /api/beta/approve (which re-checks the
// founder session), then approves + emails the member.
import { useState } from "react";

export default function ApproveConfirm({ memberId, username, already }: { memberId: string; username: string; already: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">(already ? "done" : "idle");
  const [msg, setMsg] = useState("");

  async function approve() {
    setState("busy"); setMsg("");
    try {
      const res = await fetch("/api/beta/approve", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) setState("done");
      else { setState("err"); setMsg(j.error || "Couldn't approve — try again."); }
    } catch { setState("err"); setMsg("Couldn't approve — try again."); }
  }

  if (state === "done") {
    return <div className="authcard__row">
      <span className="authcard__ok"><b>{username} is approved ✓</b> — they&apos;ve been emailed.</span>
      <a href="/admin/members" className="btn">Beta approvals</a>
    </div>;
  }

  return (
    <>
      {msg && <p className="authcard__err">{msg}</p>}
      <div className="authcard__row">
        <button type="button" className="btn btn--primary" disabled={state === "busy"} onClick={approve}>
          {state === "busy" ? "Approving…" : `Approve ${username}`}
        </button>
        <a href="/admin/members" className="btn">All requests</a>
      </div>
    </>
  );
}
