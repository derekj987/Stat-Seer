// Shared best-price math for a betslip — used by both the live SlipBar and the public
// shared-slip page, so a shared link shows the SAME value StatSeer computes live: the best
// book per leg, and the one book with the best COMBINED price for the whole parlay.
import type { SlipItem } from "./slip";

// ONE label map, in lib/bookLabel.ts. This file used to carry its own copy, and the two drifted:
// the day the us2 books arrived, the homepage shopping table read "ballybet / betparx" beside
// "BetRivers / Caesars" because only the other map had learned the new names.
import { bookLabel } from "./bookLabel";
export const bookName = bookLabel;
export const fmtOdds = (p?: number) => (p === undefined ? "" : p > 0 ? `+${p}` : String(p));

// American ↔ decimal, so we can multiply prices across legs and show the combined number.
export const toDecimal = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
export const decToAmerican = (d: number) => {
  const a = d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
  return a > 0 ? `+${a}` : String(a);
};

/** A leg's best available price + which book(s) offer it. Falls back to the item's own
 *  price/books when there's no per-book map. */
export function legBest(i: SlipItem): { best: number | undefined; books: string[] } {
  const e = Object.entries(i.byBook ?? {});
  if (!e.length) return { best: i.price, books: i.books ?? [] };
  const best = Math.max(...e.map(([, p]) => p));
  return { best, books: e.filter(([, p]) => p === best).map(([b]) => b) };
}

/** The best single book to place ALL these legs as one parlay ticket: for each book that
 *  prices every leg, multiply its prices; the winner is the highest combined payout. Falls
 *  back to the book covering the MOST legs when none covers them all. */
export function bestParlayBook(legs: SlipItem[]) {
  const books = new Set<string>();
  for (const l of legs) for (const b of Object.keys(l.byBook ?? {})) books.add(b);
  let full: { book: string; decimal: number } | null = null;
  let partial: { book: string; decimal: number; covers: number } | null = null;
  for (const b of books) {
    const priced = legs.filter((l) => l.byBook?.[b] !== undefined);
    if (!priced.length) continue;
    const dec = priced.reduce((acc, l) => acc * toDecimal(l.byBook![b]), 1);
    if (priced.length === legs.length) {
      if (!full || dec > full.decimal) full = { book: b, decimal: dec };
    }
    if (!partial || priced.length > partial.covers || (priced.length === partial.covers && dec > partial.decimal)) {
      partial = { book: b, decimal: dec, covers: priced.length };
    }
  }
  return { full, partial };
}

export interface BookQuote { book: string; decimal: number; covers: number }

/** Everything the UI needs to summarise a slip's pricing in one call — including the FULL
 *  ranking of books that price the whole parlay (best combined first), for a top-3 list and
 *  a "best vs next-best" dollar comparison. */
export function priceSlip(items: SlipItem[]) {
  const legs = items.filter((i) => i.byBook && Object.keys(i.byBook).length > 0);
  const books = new Set<string>();
  for (const l of legs) for (const b of Object.keys(l.byBook ?? {})) books.add(b);
  const all: BookQuote[] = [];
  for (const b of books) {
    const priced = legs.filter((l) => l.byBook?.[b] !== undefined);
    if (!priced.length) continue;
    const decimal = priced.reduce((acc, l) => acc * toDecimal(l.byBook![b]), 1);
    all.push({ book: b, decimal, covers: priced.length });
  }
  // Books that price EVERY leg, best combined first — the fair whole-parlay ranking.
  const ranked = all.filter((r) => r.covers === legs.length).sort((a, b) => b.decimal - a.decimal);
  // Placing each leg at its OWN best book — the theoretical max combined ("best-price equivalent").
  const bestEachDec = legs.length ? legs.reduce((acc, i) => acc * toDecimal(legBest(i).best!), 1) : 0;
  // Headline book: best full-coverage; else the book covering the most legs at the best price.
  const partial = all.slice().sort((a, b) => b.covers - a.covers || b.decimal - a.decimal)[0] ?? null;
  const oneBook = ranked[0] ?? partial;
  return { legs, ranked, bestEachDec, oneBook };
}
