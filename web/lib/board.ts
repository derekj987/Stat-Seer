// Value Finder board logic — TypeScript port of analysis/the_board.py.
// Runs server-side only (uses the Supabase service key from server env).

import { empWinProb } from "./winCurve";
import { usBooks } from "./bookLabel";
import { deVig } from "./fairValue";

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
  byBook: Record<string, number>;   // every book's best price at this point
  fairProb?: number | null;         // Pick Auditor: de-vigged fair probability of this side
}
export interface MlSide {
  price: number;
  books: string[];
  byBook: Record<string, number>;   // every book's best price for this side
  edge: number;
  n: number;
  fairProb?: number | null;         // Pick Auditor: de-vigged fair probability of this side
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

function bestPrice(rows: OddsRow[]): { price: number; books: string[]; byBook: Record<string, number> } {
  const byBook: Record<string, number> = {};
  for (const r of rows) {
    if (byBook[r.book] === undefined || r.price_american > byBook[r.book]) byBook[r.book] = r.price_american;
  }
  const top = Math.max(...rows.map((r) => r.price_american));
  const books = [...new Set(rows.filter((r) => r.price_american === top).map((r) => r.book))].sort();
  return { price: top, books, byBook };
}

function moneyline(rows: OddsRow[]): Record<string, MlSide> {
  const sides: Record<string, OddsRow[]> = {};
  for (const r of rows) (sides[r.outcome_name] ??= []).push(r);
  const out: Record<string, MlSide> = {};
  for (const [side, rs] of Object.entries(sides)) {
    const { price, books, byBook } = bestPrice(rs);
    const edge = (median(rs.map((r) => implied(r.price_american))) - implied(price)) * 100;
    out[side] = { price, books, byBook, edge, n: rs.length };
  }
  return out;
}

function lineSide(rows: OddsRow[], want: "max" | "min"): Line | null {
  const pts = rows.map((r) => r.outcome_point).filter((p): p is number => p !== null);
  if (!pts.length) return null;
  const tgt = want === "max" ? Math.max(...pts) : Math.min(...pts);
  const at = rows.filter((r) => r.outcome_point === tgt);
  const { price, books, byBook } = bestPrice(at);
  return { point: tgt, price, books, byBook };
}

// Books trade in half-points, but a median across an even number of books can land on
// a quarter (e.g. median of 49.0 and 49.5 = 49.25). Snap the consensus to the nearest
// half so what we show is always a real, bettable number.
const halfPt = (x: number) => Math.round(x * 2) / 2;

/** THE market line a board shows is FanDuel's, where FanDuel has posted one; the half-point-snapped
 *  median across US books only where it has not. Derek's rule, applied first to the player board,
 *  then NCAAF, then here: a median across books is nobody's number, and a reader checks the board
 *  against FanDuel. The field keeps its name (`consensus`) because every reader — NFL/MLB/NCAAF
 *  model boards, the homepage card, Context — reads it as "the market line", which it still is. */
export const LINE_BOOK = "fanduel";
const bookPoint = (rows: OddsRow[]) => rows.find((r) => r.book === LINE_BOOK && r.outcome_point !== null)?.outcome_point ?? null;

function spread(rows: OddsRow[], home: string, away: string): Game["spread"] {
  const sides: Record<string, OddsRow[]> = {};
  for (const r of rows) (sides[r.outcome_name] ??= []).push(r);
  const homePts = (sides[home] ?? []).map((r) => r.outcome_point).filter((p): p is number => p !== null);
  const consensus = bookPoint(sides[home] ?? []) ?? (homePts.length ? halfPt(median(homePts)) : null);
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
  const consensus = bookPoint(sides["Over"] ?? []) ?? (pts.length ? halfPt(median(pts)) : null);
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

// Pick Auditor: de-vig a two-sided market (per book, then average) → fair probability of each side.
function pairFair(a: { byBook: Record<string, number>; fairProb?: number | null } | null | undefined,
                  b: { byBook: Record<string, number>; fairProb?: number | null } | null | undefined) {
  if (!a || !b) return;
  const probs: number[] = [];
  for (const book of Object.keys(a.byBook)) if (b.byBook[book] != null) probs.push(deVig(a.byBook[book], b.byBook[book]));
  if (!probs.length) return;
  const p = probs.reduce((x, y) => x + y, 0) / probs.length;
  a.fairProb = p;
  b.fairProb = 1 - p;
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
    const game: Game = {
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
    };
    // Pick Auditor fair prices for each two-sided market.
    pairFair(game.spread.home, game.spread.away);
    pairFair(game.total.over, game.total.under);
    const mlSides = Object.values(game.ml);
    if (mlSides.length === 2) pairFair(mlSides[0], mlSides[1]);
    board.push(game);
  }
  board.sort((a, b) => a.commence.localeCompare(b.commence));
  return board;
}

// ---- Supabase fetch (server-side) ----
/** PostgREST read, PAGED.
 *
 *  A `limit=` in the query string does NOT raise PostgREST's ceiling — the server caps every
 *  response at 1000 rows, so `&limit=5000` returns 1000 and looks complete.
 *
 *  fetchWeek/fetchPreseason below pin to a single snapshot and carried the comment "so it's whole
 *  and under the 1000-row cap". That was true when written and has since expired: one Week 1
 *  snapshot is now 1,042 rows, so the board was silently dropping the tail. Paging removes the
 *  assumption rather than re-tuning it — a snapshot only grows as books and markets are added.
 *
 *  A `limit=1` query still works: the first page comes back short and the loop stops. */
async function pgFrom(table: string, path: string): Promise<unknown[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const base = `${url.replace(/\/$/, "")}/rest/v1/${table}${path}`;
  const PAGE = 1000;
  const out: unknown[] = [];
  for (let off = 0; off < 200000; off += PAGE) {
    const res = await fetch(base, {
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        "Range-Unit": "items", Range: `${off}-${off + PAGE - 1}`,
      },
      next: { revalidate: 120 }, // refresh at most every 2 min
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as unknown[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
const pg = (path: string) => pgFrom("odds_snapshots", path);

/** The current NFL week: the earliest week that still has an un-kicked-off game.
 * Rotates automatically — once a week's games are all in the past it advances. */
export async function currentWeek(season = 2026): Promise<number | null> {
  const now = new Date().toISOString();
  const rows = (await pg(
    `?season=eq.${season}&commence_time=gt.${encodeURIComponent(now)}` +
      `&select=week&order=week.asc&limit=1`
  )) as { week: number }[];
  return rows.length ? rows[0].week : null;
}

/** The min/max NFL week that currently has any odds captured, for the week nav. */
export async function weekRange(season = 2026): Promise<{ min: number; max: number } | null> {
  const lo = (await pg(`?season=eq.${season}&select=week&order=week.asc&limit=1`)) as { week: number }[];
  const hi = (await pg(`?season=eq.${season}&select=week&order=week.desc&limit=1`)) as { week: number }[];
  if (!lo.length || !hi.length) return null;
  return { min: lo[0].week, max: hi[0].week };
}

/** The latest full preseason snapshot (isolated `preseason_odds` table — exhibition
 * lines, never graded). No week: preseason games are listed by kickoff. Reuses the
 * same OddsRow shape + buildBoard, which groups by event_id and ignores week. */
export async function fetchPreseason(season = 2026): Promise<OddsRow[]> {
  const latest = (await pgFrom("preseason_odds",
    `?season=eq.${season}&capture_reason=in.(SCHEDULED,MANUAL)` +
      `&select=snapshot_at&order=snapshot_at.desc&limit=1`
  )) as { snapshot_at: string }[];
  if (!latest.length) return [];
  const snap = encodeURIComponent(latest[0].snapshot_at);
  return usBooks((await pgFrom("preseason_odds",
    `?season=eq.${season}&snapshot_at=eq.${snap}` +
      `&select=snapshot_at,event_id,commence_time,home_team,away_team,book,market,` +
      `outcome_name,outcome_point,price_american&limit=5000`
  )) as OddsRow[]);
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
  return usBooks((await pg(
    `?season=eq.${season}&week=eq.${week}&snapshot_at=eq.${snap}` +
      `&select=snapshot_at,event_id,commence_time,home_team,away_team,book,market,` +
      `outcome_name,outcome_point,price_american&limit=5000`
  )) as OddsRow[]);
}
