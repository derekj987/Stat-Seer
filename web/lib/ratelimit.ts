// Fixed-window rate limiter backed by Postgres (ingest/rate_limits.sql) — no external service.
// Returns true = allowed, false = over the limit. Calls the service-only rate_limit_hit RPC with the
// service key so counters can't be tampered with from the client.
//
// Fails OPEN if the limiter is unavailable (missing env, RPC error): the primary controls are auth +
// the beta-approval gate; this is a cost/abuse backstop, not the security boundary, so a limiter
// outage must not take a feature down.
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !svc) return true;
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/rate_limit_hit`, {
      method: "POST",
      headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_key: key, p_limit: limit, p_window: windowSec }),
      cache: "no-store",
    });
    if (!r.ok) return true;
    return (await r.json()) === true;
  } catch {
    return true;
  }
}

// Best-effort client IP for unauthenticated per-IP limits (Vercel populates x-forwarded-for).
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return (xff.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim() || "unknown";
}
