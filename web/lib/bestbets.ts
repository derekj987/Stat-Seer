// Best Bets — the honest "picks" surface. Everything here is a PRICE edge we can
// prove (same bet, better number), not an outcome prediction. Two kinds:
//   1. Sweet Spots — games on a key number (3/7), where a half-point is worth most.
//   2. Best prices — the biggest shopping edges (best book vs. the field median at
//      the same line) across moneyline / spread / total.
//
// Outcome picks ("we think team X wins") deliberately do NOT live here — those come
// from The Model / props once they beat the closing line with a public record.

import { fetchWeek, implied, median, fmtOdds, type OddsRow } from "./board";

const KEY_NUMBERS: Record<number, number> = { 3: 9.0, 7: 6.2 };
const TOTAL_KEY_NUMBERS: Record<number, number> = { 37: 3.7, 41: 3.8, 43: 3.5, 44: 3.8, 51: 3.8 };

export interface Play {
  eventId: string;
  game: string;
  commence: string;
  market: "Moneyline" | "Spread" | "Total";
  label: string;      // the exact bet, e.g. "SEA -3.5" or "Over 43.5"
  price: number;      // best available American price
  books: string[];    // book(s) offering it
  edge: number;       // shopping edge in % (best vs. field median at this number)
}

export interface KeyPlay {
  eventId: string;
  game: string;
  commence: string;
  market: "Spread" | "Total";
  num: number;        // the key number the line sits on (spread 3/7, total 37/41/43/44/51)
  cost: number;       // half-point value in %
  sideA: { label: string; price: number; books: string[] };
  sideB: { label: string; price: number; books: string[] };
}

function modal(nums: number[]): number {
  const c = new Map<number, number>();
  for (const n of nums) c.set(n, (c.get(n) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Best price + shopping edge for one side of one market. Compares only rows at
 * the modal line so the edge is same-bet-better-price, not apples-to-oranges. */
function sideEdge(rows: OddsRow[]): { price: number; books: string[]; edge: number; point: number | null } | null {
  if (!rows.length) return null;
  const pts = rows.map((r) => r.outcome_point).filter((p): p is number => p !== null);
  let use = rows;
  let point: number | null = null;
  if (pts.length) {
    point = modal(pts);
    use = rows.filter((r) => r.outcome_point === point);
  }
  const top = Math.max(...use.map((r) => r.price_american));
  const books = [...new Set(use.filter((r) => r.price_american === top).map((r) => r.book))].sort();
  const edge = (median(use.map((r) => implied(r.price_american))) - implied(top)) * 100;
  return { price: top, books, edge, point };
}

function fmtPoint(p: number): string {
  return p > 0 ? `+${p}` : String(p);
}

export function buildBets(rows: OddsRow[]): { plays: Play[]; keys: KeyPlay[] } {
  const byEvent: Record<string, OddsRow[]> = {};
  for (const r of rows) (byEvent[r.event_id] ??= []).push(r);

  const plays: Play[] = [];
  const keys: KeyPlay[] = [];

  for (const [eventId, rs] of Object.entries(byEvent)) {
    const home = rs[0].home_team;
    const away = rs[0].away_team;
    const game = `${away} @ ${home}`;
    const commence = rs[0].commence_time;

    const byMarket: Record<string, OddsRow[]> = {};
    for (const r of rs) (byMarket[r.market] ??= []).push(r);

    const sidesOf = (market: string) => {
      const s: Record<string, OddsRow[]> = {};
      for (const r of byMarket[market] ?? []) (s[r.outcome_name] ??= []).push(r);
      return s;
    };

    // Moneyline
    for (const [side, srows] of Object.entries(sidesOf("h2h"))) {
      const e = sideEdge(srows);
      if (e) plays.push({ eventId, game, commence, market: "Moneyline", label: `${side} ML`,
        price: e.price, books: e.books, edge: e.edge });
    }
    // Spread
    for (const [side, srows] of Object.entries(sidesOf("spreads"))) {
      const e = sideEdge(srows);
      if (e && e.point !== null) plays.push({ eventId, game, commence, market: "Spread",
        label: `${side} ${fmtPoint(e.point)}`, price: e.price, books: e.books, edge: e.edge });
    }
    // Total
    for (const [side, srows] of Object.entries(sidesOf("totals"))) {
      const e = sideEdge(srows);
      if (e && e.point !== null) plays.push({ eventId, game, commence, market: "Total",
        label: `${side === "Over" ? "Over" : "Under"} ${e.point}`, price: e.price, books: e.books, edge: e.edge });
    }

    // Spread key number (from the home team's modal spread)
    const homeSpread = sidesOf("spreads")[home] ?? [];
    const hpts = homeSpread.map((r) => r.outcome_point).filter((p): p is number => p !== null);
    if (hpts.length) {
      const cons = modal(hpts);
      const mag = Math.abs(cons);
      if (KEY_NUMBERS[mag]) {
        const favTeam = cons < 0 ? home : away;
        const dogTeam = cons < 0 ? away : home;
        const fe = sideEdge(sidesOf("spreads")[favTeam] ?? []);
        const de = sideEdge(sidesOf("spreads")[dogTeam] ?? []);
        if (fe && de && fe.point !== null && de.point !== null) {
          keys.push({
            eventId, game, commence, market: "Spread", num: mag, cost: KEY_NUMBERS[mag],
            sideA: { label: `${favTeam} ${fmtPoint(fe.point)}`, price: fe.price, books: fe.books },
            sideB: { label: `${dogTeam} ${fmtPoint(de.point)}`, price: de.price, books: de.books },
          });
        }
      }
    }

    // Total key number (from the modal total line)
    const totRows = byMarket["totals"] ?? [];
    const tpts = totRows.map((r) => r.outcome_point).filter((p): p is number => p !== null);
    if (tpts.length) {
      const consT = modal(tpts);
      if (TOTAL_KEY_NUMBERS[consT]) {
        const oe = sideEdge(sidesOf("totals")["Over"] ?? []);
        const ue = sideEdge(sidesOf("totals")["Under"] ?? []);
        if (oe && ue && oe.point !== null && ue.point !== null) {
          keys.push({
            eventId, game, commence, market: "Total", num: consT, cost: TOTAL_KEY_NUMBERS[consT],
            sideA: { label: `Over ${oe.point}`, price: oe.price, books: oe.books },
            sideB: { label: `Under ${ue.point}`, price: ue.price, books: ue.books },
          });
        }
      }
    }
  }

  plays.sort((a, b) => b.edge - a.edge);
  keys.sort((a, b) => b.cost - a.cost);
  return { plays, keys };
}

export { fmtOdds };

export async function fetchBets(week: number, season = 2026): Promise<{ plays: Play[]; keys: KeyPlay[] }> {
  return buildBets(await fetchWeek(week, season));
}
