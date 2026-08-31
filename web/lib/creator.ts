// Data layer for the private Creator dashboard (/creator). Founder-only — the page gates
// on role before calling any of this. Everything runs server-side with the service key,
// and every read is wrapped so a missing table (e.g. site_visits before its SQL is run)
// degrades to null instead of crashing the page.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

function base(): string | null {
  return URL && KEY ? URL.replace(/\/$/, "") : null;
}
function headers(extra?: Record<string, string>) {
  return { apikey: KEY as string, Authorization: `Bearer ${KEY}`, ...extra };
}

/** Exact row count for a PostgREST path, via the Content-Range header. null on any error. */
async function count(path: string): Promise<number | null> {
  const b = base();
  if (!b) return null;
  try {
    const res = await fetch(`${b}/rest/v1/${path}`, {
      headers: headers({ Prefer: "count=exact", Range: "0-0" }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const cr = res.headers.get("content-range"); // "0-0/123"
    const total = cr?.split("/")[1];
    return total && total !== "*" ? Number(total) : 0;
  } catch { return null; }
}

async function rows<T = Record<string, unknown>>(path: string): Promise<T[]> {
  const b = base();
  if (!b) return [];
  try {
    const res = await fetch(`${b}/rest/v1/${path}`, { headers: headers(), cache: "no-store" });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch { return []; }
}

/** Total bytes stored across all Storage buckets (recurses folders). null on any error. */
async function storageBytes(): Promise<number | null> {
  const b = base();
  if (!b) return null;
  try {
    const bres = await fetch(`${b}/storage/v1/bucket`, { headers: headers(), cache: "no-store" });
    if (!bres.ok) return null;
    const buckets = (await bres.json()) as { name: string }[];
    let total = 0;
    for (const bk of buckets) total += await sumFolder(b, bk.name, "", 0);
    return total;
  } catch { return null; }
}
async function sumFolder(b: string, bucket: string, prefix: string, depth: number): Promise<number> {
  if (depth > 5) return 0;
  try {
    const res = await fetch(`${b}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const items = (await res.json()) as { name: string; id: string | null; metadata: { size?: number } | null }[];
    let sum = 0;
    for (const it of items) {
      if (it.id === null) sum += await sumFolder(b, bucket, prefix ? `${prefix}/${it.name}` : it.name, depth + 1);
      else sum += Number(it.metadata?.size || 0);
    }
    return sum;
  } catch { return 0; }
}

/** Live health of outgoing email (Resend). Catches the silent "no key = no email" failure:
 *  approvals still succeed (they use an RPC), but the welcome/alert emails quietly no-op. */
export interface EmailHealth {
  keyPresent: boolean;             // RESEND_API_KEY set in the environment?
  keyValid: boolean | null;        // did Resend accept it? null = couldn't check
  domains: { name: string; status: string }[] | null;  // sending domains + verification state
  from: string;                    // the From address welcome/alert emails use
  error: string | null;            // human-readable reason it won't send, if any
}

export async function getEmailHealth(): Promise<EmailHealth> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.BETA_FROM || process.env.FEEDBACK_FROM || "StatSeer <notify@statseeredge.com>";
  if (!key) {
    return { keyPresent: false, keyValid: null, domains: null, from,
      error: "RESEND_API_KEY is not set in Vercel — welcome and alert emails won't send." };
  }
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      return { keyPresent: true, keyValid: false, domains: null, from,
        error: "Resend rejected the key (unauthorized) — it may be revoked or mistyped." };
    }
    if (!res.ok) {
      return { keyPresent: true, keyValid: null, domains: null, from,
        error: `Resend responded ${res.status} when checking the key.` };
    }
    const body = (await res.json()) as { data?: { name: string; status: string }[] };
    const domains = (body.data || []).map((d) => ({ name: d.name, status: d.status }));
    const anyVerified = domains.some((d) => d.status === "verified");
    return { keyPresent: true, keyValid: true, domains, from,
      error: domains.length === 0 ? "Key works, but no sending domain is added in Resend yet."
        : anyVerified ? null : "Key works, but no domain is verified yet — sends will bounce." };
  } catch {
    return { keyPresent: true, keyValid: null, domains: null, from,
      error: "Couldn't reach Resend to verify the key." };
  }
}

export interface CreatorStats {
  members: number | null;
  membersThisWeek: number | null;
  feedbackTotal: number | null;
  reportsOpen: number | null;
  pendingBeta: number | null;
  threads: number | null;
  replies: number | null;
  visitsTotal: number | null;   // null => site_visits table not set up yet
  visits7d: number | null;
  storageBytes: number | null;  // total Storage used (bytes); null if unreadable
  recentMembers: { username: string; created_at: string }[];
  recentFeedback: { message: string; created_at: string; email: string | null }[];
}

export async function getCreatorStats(): Promise<CreatorStats> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    members, membersThisWeek, feedbackTotal, reportsOpen, threads, replies, pendingBeta,
    recentMembers, recentFeedback, visitRows, storageUsed,
  ] = await Promise.all([
    count("profiles?select=id"),
    count(`profiles?select=id&created_at=gte.${weekAgo}`),
    count("feedback?select=id"),
    count("reports?select=id&resolved=eq.false"),
    count("threads?select=id"),
    count("replies?select=id"),
    count("profiles?select=id&status=eq.pending"),
    rows<{ username: string; created_at: string }>("profiles?select=username,created_at&order=created_at.desc&limit=6"),
    rows<{ message: string; created_at: string; email: string | null }>("feedback?select=message,created_at,email&order=created_at.desc&limit=5"),
    rows<{ day: string; hits: number }>("site_visits?select=day,hits"),
    storageBytes(),
  ]);

  // site_visits is optional (needs ingest/creator.sql run once). Missing => null, not zero.
  const hasVisits = visitRows.length > 0 || undefined;
  const sinceDay = weekAgo.slice(0, 10);
  const visitsTotal = hasVisits ? visitRows.reduce((a, r) => a + Number(r.hits || 0), 0) : null;
  const visits7d = hasVisits
    ? visitRows.filter((r) => r.day >= sinceDay).reduce((a, r) => a + Number(r.hits || 0), 0)
    : null;

  return {
    members, membersThisWeek, feedbackTotal, reportsOpen, threads, replies, pendingBeta,
    visitsTotal, visits7d, recentMembers, recentFeedback, storageBytes: storageUsed,
  };
}
