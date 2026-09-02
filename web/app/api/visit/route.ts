// Fire-and-forget site-visit counter. The client beacon POSTs here once per browser
// session; we bump today's row via the bump_visits() RPC using the service key. If the
// site_visits table/function isn't set up yet (ingest/creator.sql), this quietly no-ops.
//
// The creator's own visits are excluded three ways so the dashboard reflects real users:
//   1. a durable `ss_nocount` cookie stamped on any device once recognized (survives logout),
//   2. known owner IPs listed in the VISIT_EXCLUDE_IPS env var (comma-separated), and
//   3. a signed-in founder (which also stamps the cookie for that device going forward).
// Manual escape hatch: open /api/visit?exclude=1 on any device to exclude it (…?exclude=0 undoes it).
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/ratelimit";

const YEAR = 60 * 60 * 24 * 365;
const setCookie = (on: boolean) =>
  on
    ? `ss_nocount=1; Max-Age=${YEAR}; Path=/; HttpOnly; Secure; SameSite=Lax`
    : `ss_nocount=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

function hasNoCount(req: Request): boolean {
  return /(?:^|;\s*)ss_nocount=1(?:;|$)/.test(req.headers.get("cookie") || "");
}
function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0].trim() : null) || req.headers.get("x-real-ip");
}
function ownerIp(req: Request): boolean {
  const ip = clientIp(req);
  if (!ip) return false;
  return (process.env.VISIT_EXCLUDE_IPS || "")
    .split(",").map((s) => s.trim()).filter(Boolean).includes(ip);
}
const jsonWithCookie = (body: object, on: boolean) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "set-cookie": setCookie(on) },
  });

// Manual per-device toggle: /api/visit?exclude=1 (exclude) or ?exclude=0 (re-include).
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("exclude");
  if (p === "1") return new Response("✓ This device is now excluded from Site Visits.",
    { headers: { "content-type": "text/plain; charset=utf-8", "set-cookie": setCookie(true) } });
  if (p === "0") return new Response("This device will now be counted in Site Visits.",
    { headers: { "content-type": "text/plain; charset=utf-8", "set-cookie": setCookie(false) } });
  return Response.json({ ok: true, excluded: hasNoCount(req) });
}

export async function POST(req: Request) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return Response.json({ ok: false });

  // Cap per IP so the counter can't be looped to poison the "site visits" metric.
  if (!(await rateLimit(`visit:${clientIp(req)}`, 10, 60))) return Response.json({ ok: true, skipped: "rate" });

  // 1) Device already flagged as the owner's → never count.
  if (hasNoCount(req)) return Response.json({ ok: true, skipped: "device" });
  // 2) Known owner IP (env) → skip.
  if (ownerIp(req)) return Response.json({ ok: true, skipped: "ip" });
  // 3) Signed-in founder → skip AND stamp this device so its logged-out visits also stop counting.
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (prof?.role === "founder") return jsonWithCookie({ ok: true, skipped: "founder" }, true);
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
