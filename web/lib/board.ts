// Value Finder board logic — TypeScript port of analysis/the_board.py.
// Runs server-side only (uses the Supabase service key from server env).

import { empWinProb } from "./winCurve";

const KEY_NUMBERS: Record<number, number> = { 3: 9.0, 7: 6.2 };
// Total-points key numbers, measured 1999-2025 (analysis/total_key_numbers.py).
// Value = P(total lands exactly on N). Weaker than spread keys (~4% vs 9%).
const TOTAL_KEY_NUMBERS: Record<number, number> = { 37: 3.7, 41: 3.8, 43: 3.5, 44: 3.8, 51: 3.8 };

export interface OddsRow {
  snapshot_at: string;
  event_id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  book: string;
  market: string;
  outcome_name: string;
  outcome_point: number | null;
  price_american: number;
}

export interface Line {
  point: number | null;
  price: number;
  books: string[];
}
export interface MlSide {
  price: number;
  books: string[];
  edge: number;
  n: number;
}
export interface Coherence {
  fav: string;
  hold: number;
  mktFair: number;
  emp: number;
  gap: number;
  flag: "fair" | "investigate";
}
export interface Game {
  eventId: string;
  matchup: string;
  home: string;
  away: string;
  commence: string;
  snapshot: string;
  ml: Record<string, MlSide>;
  spread: {
    consensus: number | null;
    home: Line | null;
    away: Line | null;
    key: { num: number; cost: number } | null;
  };
  total: {
    consensus: number | null;
    over: Line | null;
    under: Line | null;
    key: { num: number; cost: number } | null;
  };
  coherence: Coherence | null;
}

// ---- odds math ----
export function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}
export function fmtOdds(price: number): string {
  return price > 0 ? `+${price}` : String(price);
}
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function bestPrice(rows: OddsRow[]): { price: number; books: string[] } {
  const top = Math.max(...rows.map((r) => r.price_american));
  const books = [...new Set(rows.filter((r) => r.price_american === top).map((r) => r.book))].sort();
  return { price: top, books };
}

function moneyline(rows: OddsRow[]): Record<string, MlSide> {
  const sides: Record<string, OddsRow[]> = {};
  for (const r of rows) (sides[r.outcome_name] ??= []).push(r);
  const out: Record<string, MlSide> = {};
  for (const [side, rs] of Object.entries(sides)) {
    const { price, books } = bestPrice(rs);
    const edge = (median(rs.map((r) => implied(r.price_american))) - implied(price)) * 100;
    out[side] = { price, books, edge, n: rs.length };
  }
  return out;
}

function lineSide(rows: OddsRow[], want: "max" | "min"): Line | null {
  const pts = rows.map((r) => r.outcome_point).filter((p): p is number => p !== null);
  if (!pts.length) return null;
  const tgt = want === "max" ? Math.max(...pts) : Math.min(...pts);
  const at = rows.filter((r) => r.outcome_point === tgt);
  const { price, books } = bestPrice(at);
  return { point: tgt, price, books };
}

function spread(rows: OddsRow[], home: string, away: string): Game["spread"] {
  const sides: Record<string, OddsRow[]> = {};
  for (const r of rows) (sides[r.outcome_name] ??= []).push(r);
  const homePts = (sides[home] ?? []).map((r) => r.outcome_point).filter((p): p is number => p !== null);
  const consensus = homePts.length ? median(homePts) : null;
  const key = consensus !== null && KEY_NUMBERS[Math.abs(consensus)]
    ? { num: Math.abs(consensus), cost: KEY_NUMBERS[Math.abs(consensus)] }
    : null;
  return {
    consensus,
    home: lineSide(sides[home] ?? [], "max"),
    away: lineSide(sides[away] ?? [], "max"),
    key,
  };
}

function total(rows: OddsRow[]): Game["total"] {
  const sides: Record<string, OddsRow[]> = {};
  for (const r of rows) (sides[r.outcome_name] ??= []).push(r);
  const pts = rows.map((r) => r.outcome_point).filter((p): p is number => p !== null);
  const consensus = pts.length ? median(pts) : null;
  const key = consensus !== null && TOTAL_KEY_NUMBERS[consensus]
    ? { num: consensus, cost: TOTAL_KEY_NUMBERS[consensus] }
    : null;
  return {
    consensus,
    over: lineSide(sides["Over"] ?? [], "min"),
    under: lineSide(sides["Under"] ?? [], "max"),
    key,
  };
}

function coherence(h2h: OddsRow[], consensus: number | null, home: string, away: string): Coherence | null {
  if (consensus === null || !h2h.length) return null;
  const fav = consensus < 0 ? home : away;
  const mag = Math.abs(consensus);
  const byBook: Record<string, Record<string, number>> = {};
  for (const r of h2h) (byBook[r.book] ??= {})[r.outcome_name] = r.price_american;
  const holds: number[] = [];
  const favFair: number[] = [];
  for (const sides of Object.values(byBook)) {
    const names = Object.keys(sides);
    if (!(fav in sides) || names.length !== 2) continue;
    const dog = names.find((n) => n !== fav)!;
    const pF = implied(sides[fav]);
    const pD = implied(sides[dog]);
    const s = pF + pD;
    if (s > 0) {
      holds.push(s - 1);
      favFair.push(pF / s);
    }
  }
  const emp = empWinProb(mag);
  if (!favFair.length || emp === null) return null;
  const mkt = median(favFair);
  const gap = mkt - emp;
  return {
    fav,
    hold: median(holds),
    mktFair: mkt,
    emp,
    gap,
    flag: Math.abs(gap) > 0.055 ? "investigate" : "fair",
  };
}

export function buildBoard(rows: OddsRow[]): Game[] {
  const games: Record<string, OddsRow[]> = {};
  for (const r of rows) (games[r.event_id] ??= []).push(r);
  const board: Game[] = [];
  for (const [eventId, rs] of Object.entries(games)) {
    const home = rs[0].home_team;
    const away = rs[0].away_team;
    const byMarket: Record<string, OddsRow[]> = {};
    for (const r of rs) (byMarket[r.market] ??= []).push(r);
    const spr = spread(byMarket["spreads"] ?? [], home, away);
    board.push({
      eventId,
      matchup: `${away} @ ${home}`,
      home,
      away,
      commence: rs[0].commence_time,
      snapshot: rs[0].snapshot_at,
      ml: moneyline(byMarket["h2h"] ?? []),
      spread: spr,
      total: total(byMarket["totals"] ?? []),
      coherence: coherence(byMarket["h2h"] ?? [], spr.consensus, home, away),
    });
  }
  board.sort((a, b) => a.commence.localeCompare(b.commence));
  return board;
}

// ---- Supabase fetch (server-side) ----
async function pg(path: string): Promise<unknown[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/odds_snapshots${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    next: { revalidate: 120 }, // refresh at most every 2 min
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return (await res.json()) as unknown[];
}

/** The min/max NFL week that currently has any odds captured, for the week nav. */
export async function weekRange(season = 2026): Promise<{ min: number; max: number } | null> {
  const lo = (await pg(`?season=eq.${season}&select=week&order=week.asc&limit=1`)) as { week: number }[];
  const hi = (await pg(`?season=eq.${season}&select=week&order=week.desc&limit=1`)) as { week: number }[];
  if (!lo.length || !hi.length) return null;
  return { min: lo[0].week, max: hi[0].week };
}

/** One complete snapshot of the week's odds (pinned to the latest full sweep,
 * so it's whole and under the 1000-row cap). Mirrors the_board.fetch_week. */
export async function fetchWeek(week: number, season = 2026): Promise<OddsRow[]> {
  const latest = (await pg(
    `?season=eq.${season}&week=eq.${week}&capture_reason=in.(SCHEDULED,MANUAL)` +
      `&select=snapshot_at&order=snapshot_at.desc&limit=1`
  )) as { snapshot_at: string }[];
  if (!latest.length) return [];
  const snap = encodeURIComponent(latest[0].snapshot_at);
  return (await pg(
    `?season=eq.${season}&week=eq.${week}&snapshot_at=eq.${snap}` +
      `&select=snapshot_at,event_id,commence_time,home_team,away_team,book,market,` +
      `outcome_name,outcome_point,price_american&limit=5000`
  )) as OddsRow[];
}
