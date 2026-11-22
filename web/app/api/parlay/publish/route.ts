import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { currentWeek } from "@/lib/board";
import { buildWeekParlays } from "@/lib/weekParlays";

// Lock this week's Parlay of the Week tickets into parlay_ledger, before the first kickoff.
//
// WHY A ROUTE AND NOT A PYTHON JOB. The selection lives in TypeScript — pickParlays, candidateLegs,
// propLegs and the guards inside them. A Python publisher would be a SECOND implementation of the
// rule that decides what gets published, and the moment the two disagreed the graded record would
// stop describing the card the reader saw. Running it here means the ticket that is locked is
// produced by the same code that renders it; see lib/weekParlays.ts.
//
// WHY IT NEEDS NO NEW SECRET. proxy.ts lets /api through unauthenticated ("API routes self-gate"),
// so this one gates itself on the service key the workflow already holds. That key is never
// logged and is compared in constant time. A missing key on either side fails CLOSED.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEASON = 2026;

function authorised(request: Request): boolean {
  const expected = process.env.SUPABASE_SERVICE_KEY;
  if (!expected) return false;                                  // not configured: refuse, never allow
  const got = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!got) return false;
  const a = Buffer.from(got), b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak length, so compare the
  // lengths first and keep the constant-time compare for the equal-length case.
  return a.length === b.length && timingSafeEqual(a, b);
}

async function pg(path: string, init: RequestInit): Promise<Response> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("supabase env");
  return fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function POST(request: Request) {
  if (!authorised(request)) return NextResponse.json({ ok: false }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const season = Number(sp.get("season") ?? SEASON);
  let week = Number(sp.get("week") ?? NaN);
  if (!Number.isFinite(week)) {
    const cur = await currentWeek(season).catch(() => null);
    if (cur == null) return NextResponse.json({ ok: false, error: "no current week" }, { status: 503 });
    week = cur;
  }

  const now = new Date();
  const parlays = await buildWeekParlays(week, season, now);
  if (!parlays.length) return NextResponse.json({ ok: true, week, published: 0, note: "no qualifying tickets" });

  const rows = [];
  const skipped: string[] = [];
  for (const p of parlays) {
    // The earliest kickoff on the ticket. The ledger's CHECK refuses a row published at or after
    // it, so a ticket can never be back-dated into a week whose results are known. A leg with no
    // commence would make that guarantee unverifiable, so the ticket is skipped rather than
    // published without it.
    const kicks = p.legs.map((l) => l.commence).filter((c): c is string => !!c);
    if (kicks.length !== p.legs.length) { skipped.push(`${p.title}: a leg has no kickoff time`); continue; }
    const first = kicks.reduce((m, c) => (c < m ? c : m));
    if (Date.parse(first) <= now.getTime()) { skipped.push(`${p.title}: first leg has kicked off`); continue; }
    rows.push({
      first_commence: first,
      sport: "NFL",
      season, week,
      ticket: p.title ?? "Parlay",
      american: p.american,
      decimal_odds: p.decimal,
      our_prob: p.ourProb,
      market_prob: p.marketProb,
      break_even: p.breakEven,
      legs: p.legs,
    });
  }
  if (!rows.length) return NextResponse.json({ ok: true, week, published: 0, skipped });

  // 🚨 on_conflict + Prefer: resolution=ignore-duplicates is what makes the ticket WRITE-ONCE.
  // Re-running this job — the schedule does, several times before kickoff — must never replace a
  // ticket that is already locked, because "we'd have picked different legs by Sunday" is exactly
  // the hindsight the record exists to rule out. Later runs are a no-op by construction rather
  // than by the caller remembering to check first.
  const res = await pg("parlay_ledger?on_conflict=sport,season,week,ticket", {
    method: "POST",
    body: JSON.stringify(rows),
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
  });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: (await res.text()).slice(0, 300) }, { status: 502 });
  }
  const written = (await res.json()) as unknown[];
  return NextResponse.json({
    ok: true, week, offered: rows.length, published: written.length,
    alreadyLocked: rows.length - written.length, skipped,
  });
}
