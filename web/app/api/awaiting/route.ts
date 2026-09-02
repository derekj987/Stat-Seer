import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "What's awaiting me" counts for the notification badge on the profile avatar. Everyone gets
// their pending friend requests; founders/admins also get beta-approval requests and open post
// reports (the actionable items that live in the Creator dashboard). Runs on the caller's own
// session, so RLS + the role check keep the founder-only counts founder-only.

type Countable = PromiseLike<{ count: number | null }>;
async function countOf(qb: Countable): Promise<number> {
  try { const { count } = await qb; return count ?? 0; } catch { return 0; }
}

export async function GET() {
  const empty = { friendRequests: 0, betaRequests: 0, reports: 0, isStaff: false };
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json(empty);

    const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    const role = (me?.role as string) ?? "member";
    const isStaff = ["founder", "admin"].includes(role);

    // Pending incoming friend requests (I'm the addressee, not yet accepted).
    const friendRequests = await countOf(
      supabase.from("friendships").select("id", { count: "exact", head: true })
        .eq("addressee_id", user.id).eq("status", "pending") as unknown as Countable,
    );

    if (!isStaff) return NextResponse.json({ friendRequests, betaRequests: 0, reports: 0, isStaff: false });

    const reports = await countOf(supabase.from("reports").select("id", { count: "exact", head: true }).eq("resolved", false) as unknown as Countable);
    // Pending-member count via the staff-only definer (profiles.status is no longer client-readable
    // once roster_privacy_authed.sql is applied); fall back to a direct count until then.
    let betaRequests = 0;
    const pc = await supabase.rpc("pending_member_count");
    if (!pc.error && typeof pc.data === "number") betaRequests = pc.data;
    else betaRequests = await countOf(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending") as unknown as Countable);
    return NextResponse.json({ friendRequests, betaRequests, reports, isStaff: true });
  } catch {
    return NextResponse.json(empty);
  }
}
