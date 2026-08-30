import { NextResponse } from "next/server";

// Emails a feedback submission to the team inbox, on top of the Supabase row the widget
// already writes. Best-effort: if email isn't configured (no RESEND_API_KEY) or the send
// fails, we still return ok — the /feedback inbox remains the source of truth.
//
// Setup (Vercel env vars):
//   RESEND_API_KEY   — from resend.com (required to actually send)
//   FEEDBACK_TO      — inbox address (default customerservice@statseer.info)
//   FEEDBACK_FROM    — verified sender on your domain (default StatSeer <feedback@statseer.info>)

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { message?: string; email?: string | null; path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });

  const email = (body.email ?? "")?.toString().trim() || null;
  const path = (body.path ?? "")?.toString().trim() || "(unknown page)";

  const key = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_TO || "customerservice@statseer.info";
  const from = process.env.FEEDBACK_FROM || "StatSeer Feedback <feedback@statseer.info>";

  // No email service configured yet — the submission still lives in the /feedback inbox.
  if (!key) return NextResponse.json({ ok: true, emailed: false, reason: "no-key", from });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "New StatSeer feedback",
        ...(email ? { reply_to: email } : {}),
        text:
          `${message}\n\n` +
          `— page: ${path}\n` +
          (email ? `— reply-to: ${email}\n` : `— no reply email given\n`) +
          `\nReview all feedback: https://statseeredge.com/feedback`,
      }),
    });
    if (res.ok) return NextResponse.json({ ok: true, emailed: true });
    const detail = await res.text().catch(() => "");
    return NextResponse.json({ ok: true, emailed: false, reason: "resend-rejected", status: res.status, detail, from });
  } catch (e) {
    return NextResponse.json({ ok: true, emailed: false, reason: "fetch-threw", err: String(e) });
  }
}
