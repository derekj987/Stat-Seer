import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { approveMember } from "@/lib/betaMail";

export const runtime = "nodejs";

// Approve a beta member — from the Beta-approvals page OR the email-approve landing. Requires a
// founder/admin SESSION (the email link routes through /admin/approve, which logs you in first),
// then approves + emails the member.
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
