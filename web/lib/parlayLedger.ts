// Reading the published parlay record.
//
// The card claims "Every ticket is published before kickoff and graded at /report". These are the
// two reads that make that true: `lockedParlays` returns the ticket AS PUBLISHED (not recomputed
// from today's prices), and `parlayRecord` returns what those tickets actually did.
//
// 🚨 THE POINT IS THAT NOTHING HERE RECOMPUTES A SELECTION. The live selector runs once, in the
// publisher, before the first kickoff. Afterwards the board renders what the ledger holds. Before
// this existed the card recomputed its legs on every render, so the "published" ticket drifted
// with the market all week and no version of it was ever written down — a graded record was not
// merely missing, it was impossible.
import { bestParlayBook, decToAmerican } from "./slipPricing";
import type { SlipItem } from "./slip";
import { MIN_DECIMAL, type Parlay, type ParlayLeg } from "./parlayOfWeek";

export type Sport = "NFL" | "NCAAF";

interface LedgerRow {
  id: string;
  ticket: string;
  american: string;
  decimal_odds: string | number;
  our_prob: string | number;
  market_prob: string | number | null;
  break_even: string | number;
  legs: ParlayLeg[];
}

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : typeof v === "number" ? v : Number(v);

async function pg(path: string): Promise<unknown[]> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    // Same reasoning as lib/board.ts: in Next 16 `next.revalidate` alone caches NOTHING on a
    // request that sends an Authorization header. Without force-cache every render re-reads.
    cache: "force-cache",
    next: { revalidate: 120 },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return (await res.json()) as unknown[];
}

/** Rebuild the published Parlay objects for a week, exactly as they were locked.
 *
 *  `bestBook` and `belowTarget` are derived rather than stored: both are pure functions of data
 *  already in the row (`byBook` on each leg, and the ticket's own price), so storing them would
 *  create a second copy that could disagree with the first. */
export async function lockedParlays(sport: Sport, season: number, week: number): Promise<Parlay[]> {
  const rows = (await pg(
    `parlay_ledger?sport=eq.${sport}&season=eq.${season}&week=eq.${week}` +
    `&select=id,ticket,american,decimal_odds,our_prob,market_prob,break_even,legs&order=published_at.asc`
  )) as LedgerRow[];

  return rows.map((r) => {
    const legs = (r.legs ?? []) as ParlayLeg[];
    const items = legs.map((l) => ({ byBook: l.byBook } as unknown as SlipItem));
    const bb = legs.length ? bestParlayBook(items).full : null;
    const dec = num(r.decimal_odds) ?? 0;
    return {
      legs,
      ourProb: num(r.our_prob) ?? 0,
      decimal: dec,
      american: r.american,
      breakEven: num(r.break_even) ?? 0,
      marketProb: num(r.market_prob),
      bestBook: bb ? { book: bb.book, american: decToAmerican(bb.decimal) } : null,
      belowTarget: dec < MIN_DECIMAL,
      title: r.ticket,
    } satisfies Parlay;
  });
}

/** The season's graded ticket record: how many were settled, and how many landed.
 *
 *  Counts GRADED tickets only. A ticket published for a week still in play is not a 0 — treating
 *  pending as a loss would make the record worse than the truth, which is the mirror image of the
 *  flattery this panel is built to avoid, and just as wrong. */
export async function parlayRecord(sport: Sport, season: number): Promise<{ tickets: number; hit: number }> {
  const rows = (await pg(
    `parlay_ledger?sport=eq.${sport}&season=eq.${season}&select=id,parlay_results(outcome)`
  )) as { id: string; parlay_results: { outcome: string }[] | null }[];

  let tickets = 0, hit = 0;
  for (const r of rows) {
    const o = r.parlay_results?.[0]?.outcome;
    if (!o || o === "VOID") continue;      // ungraded, or ungradable — neither is a result
    tickets += 1;
    if (o === "WIN") hit += 1;
  }
  return { tickets, hit };
}
