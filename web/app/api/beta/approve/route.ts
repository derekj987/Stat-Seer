import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWelcomeEmail } from "@/lib/betaMail";

export const runtime = "nodejs";

// Approve a beta member — from the Beta-approvals page OR the email-approve landing. Requires a
// founder/admin SESSION (the email link routes through /admin/approve, which logs you in first).
// The status change goes through the set_member_status RPC on YOUR session (SECURITY DEFINER,
// bypasses RLS safely) — the same path Reject/Revoke use — so it doesn't depend on the service key.
// The welcome email is best-effort and never blocks approval.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const role = (me?.role as string) ?? "member";
  if (!["founder", "admin"].includes(role)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const memberId = String(body?.memberId ?? "");
  if (!memberId) return NextResponse.json({ error: "No member." }, { status: 400 });

  const { error } = await supabase.rpc("set_member_status", { target: memberId, new_status: "approved" });
  if (error) return NextResponse.json({ error: error.message || "Couldn't approve — try again." }, { status: 200 });

  // Fire-and-forget the welcome email so a mail hiccup can't fail the approval.
  sendWelcomeEmail(memberId).catch(() => {});
  return NextResponse.json({ ok: true });
}
