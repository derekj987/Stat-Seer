// Server-side beta-approval check for API routes. RLS (ingest/beta_gate_rls.sql) blocks a pending
// member's direct database writes, but routes that call a PAID external API (the Anthropic assistant /
// dashboard-chart) aren't a DB write, so they must check approval themselves before spending.
// profiles is world-readable, so the caller's own session client can read its status.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function isApprovedMember(supabase: SupabaseClient, userId: string): Promise<boolean> {
  try {
    // Preferred: the is_approved() definer (roster_privacy_authed.sql hides profiles.status from
    // clients). Fall back to a direct status read while that migration hasn't been applied yet.
    const rpc = await supabase.rpc("is_approved", { uid: userId });
    if (!rpc.error && typeof rpc.data === "boolean") return rpc.data;
    const { data, error } = await supabase.from("profiles").select("status").eq("id", userId).maybeSingle();
    if (error) return false;            // fail CLOSED — no approval read, no access
    return data?.status === "approved";
  } catch {
    return false;
  }
}
