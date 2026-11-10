// Parlay of the Week — our 3-4 highest-confidence calls priced as one ticket.
//
// WHY THIS SHAPE, because the project's founding rule says "panels inform, they do not vote" and a
// parlay is unavoidably a vote. What keeps it honest is WHAT SELECTS THE LEGS and WHAT IS PRINTED
// BESIDE THE PAYOUT:
//
//   * legs are chosen by OUR OWN published win probability (prediction_ledger.model_prob -- the
//     number that is locked before kickoff and graded on /report), never by how far we disagree
//     with the market. Disagreement is the one selector that would make this the combine-zero-edge-
//     signals machine CLAUDE.md warns about: our record against the close is 48-50%, so the size of
//     a disagreement is not demonstrably information.
//   * the card prints our combined probability NEXT TO the break-even the price implies. A 4-leg
//     +500 ticket needs 16.7% to break even; if we rate it 16.8% the reader can see that is a
//     coin-flip of an edge, which is the truth. A payout with no probability beside it is the
//     thing this product exists not to be.
//
// Derek asked for +500 or better and 3-4 legs. Those two pull against "most confident", because the
// most confident picks are the shortest prices -- four 70% favourites pay about +324, not +500. So
// the objective is MAXIMISE OUR COMBINED PROBABILITY SUBJECT TO the ticket paying at least +500.
// The constraint binds from below, so the search naturally lands on the shortest legs that still
// clear the target rather than reaching for longshots to pad the number.
import { toDecimal, decToAmerican, bestParlayBook } from "./slipPricing";
import type { SlipItem } from "./slip";
import type { Game } from "./board";
import type { ModelPrediction } from "./model";

/** +500. A ticket must pay at least this to be shown. */
export const MIN_DECIMAL = 6.0;
/** Derek: "no more than 3 or 4 picks". */
export const LEG_COUNTS = [3, 4] as const;

export interface ParlayLeg {
  eventId: string;
  matchup: string;
  pick: string;
  ourProb: number;
  /** De-vigged fair probability of the SAME side, for the comparison column. */
  marketProb: number | null;
  price: number;
  books: string[];
  byBook: Record<string, number>;
}

export interface Parlay {
  legs: ParlayLeg[];
  /** Product of the legs' probabilities. Assumes independence across games -- see the note on
   *  `independenceCaveat` below; it is stated on the card rather than hidden. */
  ourProb: number;
  decimal: number;
  american: string;
  /** What the price implies you must hit to break even: 1 / decimal. */
  breakEven: number;
  /** The MARKET's combined fair probability — the product of each leg's de-vigged fair price.
   *
   *  🚨 THIS FIELD EXISTS BECAUSE THE FIRST VERSION OF THE CARD WAS MISLEADING. It printed our
   *  combined probability against the break-even and badged the difference in green: on the live
   *  week-10 slate that read "we rate 27.7% · pays 16.4% · +11.3pt". An eleven-point edge on a
   *  PARLAY is not a plausible claim for this model, and the report card says so in numbers --
   *  week 9 went 7-7 against the close with a Brier of 0.1488 against the market's 0.1115. Our
   *  probabilities are measurably WORSE than the market's, so a gap in our favour is evidence
   *  that we are overconfident, not that there is money on the table.
   *
   *  It is worse than a presentation slip, because of WHAT SELECTS THE LEGS. Ranking by our own
   *  probability preferentially picks the games where our number sits furthest above the market's
   *  -- the live legs ran +0.0, +16.0, +13.6 and +7.0 points against the de-vigged fair price. So
   *  the selector is adverse: "most confident by our number" and "most overconfident versus the
   *  market" are close to the same list. Multiplying four of those compounds it.
   *
   *  Printing the market's combined number alongside ours is what keeps the card informative
   *  rather than a vote: the reader sees both and can see they disagree, which is the truth.
   *  null when any leg has no two-sided price to de-vig. */
  marketProb: number | null;
  bestBook: { book: string; american: string } | null;
  /** True when no combination reached MIN_DECIMAL and this is the longest available instead. */
  belowTarget: boolean;
}

/** One leg per GAME, for the side we rate higher, priced at the best US book.
 *
 *  Pregame only. Every market number on StatSeer is a pregame price (Derek: never offer live or
 *  in-play bets), and a moneyline that is still being quoted after kickoff is a live line. */
export function candidateLegs(
  board: Game[],
  preds: ModelPrediction[],
  now = new Date(),
): ParlayLeg[] {
  const byEvent = new Map(board.map((g) => [g.eventId, g]));
  const legs: ParlayLeg[] = [];
  for (const p of preds) {
    if (Date.parse(p.commence) <= now.getTime()) continue;      // kicked off: not a pregame price
    const g = byEvent.get(p.eventId);
    if (!g) continue;
    const pick = p.favored;
    if (!pick) continue;
    const ourProb = pick === p.home ? p.homeWinProb : 1 - p.homeWinProb;
    if (!Number.isFinite(ourProb) || ourProb <= 0 || ourProb >= 1) continue;
    const side = g.ml?.[pick];
    if (!side || !side.byBook || !Object.keys(side.byBook).length) continue;
    const best = Math.max(...Object.values(side.byBook));
    legs.push({
      eventId: p.eventId,
      matchup: g.matchup,
      pick,
      ourProb,
      marketProb: side.fairProb ?? null,
      price: best,
      books: Object.entries(side.byBook).filter(([, v]) => v === best).map(([b]) => b),
      byBook: side.byBook,
    });
  }
  return legs;
}

const combos = <T,>(arr: T[], k: number): T[][] => {
  const out: T[][] = [];
  const walk = (start: number, acc: T[]) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); walk(i + 1, acc); acc.pop(); }
  };
  walk(0, []);
  return out;
};

/** The ticket: most confident combination that still pays MIN_DECIMAL or better.
 *
 *  An exhaustive search is fine here and cheaper than being clever: an NFL slate is 13-16 games,
 *  so C(16,4) + C(16,3) = 2,380 combinations of at most four multiplications each. Legs are capped
 *  at the 24 highest-probability candidates so a 60-game college slate cannot blow that up
 *  (C(24,4) = 10,626, still trivial, and nothing below our 24th-most-confident call belongs on a
 *  card about confidence). */
export function pickParlay(legs: ParlayLeg[]): Parlay | null {
  const pool = [...legs].sort((a, b) => b.ourProb - a.ourProb).slice(0, 24);
  if (pool.length < Math.min(...LEG_COUNTS)) return null;

  let best: { legs: ParlayLeg[]; prob: number; dec: number } | null = null;
  let longest: { legs: ParlayLeg[]; prob: number; dec: number } | null = null;
  for (const k of LEG_COUNTS) {
    if (pool.length < k) continue;
    for (const c of combos(pool, k)) {
      const dec = c.reduce((a, l) => a * toDecimal(l.price), 1);
      const prob = c.reduce((a, l) => a * l.ourProb, 1);
      if (!longest || dec > longest.dec) longest = { legs: c, prob, dec };
      if (dec < MIN_DECIMAL) continue;
      // Maximise OUR probability; break ties on the bigger payout.
      if (!best || prob > best.prob || (prob === best.prob && dec > best.dec)) {
        best = { legs: c, prob, dec };
      }
    }
  }
  // Nothing cleared +500 (a slate of heavy favourites). Show the longest honest ticket and SAY it
  // is short of the target rather than quietly publishing a +300 card under a "+500" promise.
  const chosen = best ?? longest;
  if (!chosen) return null;

  const items = chosen.legs.map((l) => ({ byBook: l.byBook } as unknown as SlipItem));
  const bb = bestParlayBook(items).full;
  const mkt = chosen.legs.every((l) => l.marketProb !== null)
    ? chosen.legs.reduce((a, l) => a * (l.marketProb as number), 1)
    : null;
  return {
    legs: chosen.legs,
    ourProb: chosen.prob,
    decimal: chosen.dec,
    american: decToAmerican(chosen.dec),
    breakEven: 1 / chosen.dec,
    marketProb: mkt,
    bestBook: bb ? { book: bb.book, american: decToAmerican(bb.decimal) } : null,
    belowTarget: best === null,
  };
}

/** Said on the card. Legs are in DIFFERENT games, so multiplying is defensible — but it is still
 *  an assumption, and a reader comparing our 16.8% to a book's price deserves to know which. */
export const independenceCaveat =
  "Combined chance multiplies the legs, which assumes the games are independent of each other.";
