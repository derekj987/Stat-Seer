import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { approveMember, verifyApprove, SITE_URL } from "@/lib/betaMail";

export const runtime = "nodejs";

function page(title: string, body: string, ok = true): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — StatSeer</title>
  <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:12vh auto;padding:28px;text-align:center;
    border:1px solid #d7e2d7;border-radius:16px;background:#f4f9f2;color:#12261b">
    <h1 style="color:${ok ? "#17794a" : "#b04521"};font-size:22px">${title}</h1>
    <p style="font-size:15px;line-height:1.6;color:#576a5e">${body}</p>
    <p><a href="${SITE_URL}/admin/members" style="color:#17794a;font-weight:700">Open Beta approvals →</a></p>
  </div>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });
}

// One-click approve straight from the ops-inbox email (HMAC-signed, expiring link — no login needed).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const m = url.searchParams.get("m") || "";
  const exp = Number(url.searchParams.get("exp") || 0);
  const t = url.searchParams.get("t") || "";
  if (!verifyApprove(m, exp, t)) {
    return page("Link invalid or expired", "This approve link is no longer valid. Approve the member from the Beta approvals page instead.", false);
  }
  const done = await approveMember(m);
  return done
    ? page("Approved ✓", "That member is now approved and has been emailed the good news.")
    : page("Couldn't approve", "Something went wrong — try the Beta approvals page.", false);
}

// Approve from the admin Beta-approvals page (founder/admin session) — also emails the member.
export async function POST(request: Request) {
  let role = "member";
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    role = (me?.role as string) ?? "member";
  } catch { /* env */ }
  if (!["founder", "admin"].includes(role)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const memberId = String(body?.memberId ?? "");
  if (!memberId) return NextResponse.json({ error: "No member." }, { status: 400 });
  const done = await approveMember(memberId);
  return NextResponse.json(done ? { ok: true } : { error: "Approve failed — is the service key configured?" }, { status: done ? 200 : 200 });
}
