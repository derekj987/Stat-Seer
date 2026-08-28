// Fire-and-forget site-visit counter. The client beacon POSTs here once per browser
// session; we bump today's row via the bump_visits() RPC using the service key. If the
// site_visits table/function isn't set up yet (ingest/creator.sql), this quietly no-ops.
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return Response.json({ ok: false });

  // Don't count the site creator's own visits — the dashboard should reflect real users.
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (prof?.role === "founder") return Response.json({ ok: true, skipped: "founder" });
    }
  } catch { /* not signed in / auth not configured — fall through and count as a real visit */ }

  try {
    await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/bump_visits`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
  } catch { /* counter is best-effort */ }
  return Response.json({ ok: true });
}
