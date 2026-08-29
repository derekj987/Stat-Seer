import type { NcaafCardGame } from "./model-data";

// Shared "our lean" logic for the CFB model boards (model page + homepage snapshot), so the board
// never reads as "take the points on everything." On a BIG spread (>=17) the market is efficient —
// heavy favorites cover ~half the time and our rating doesn't beat the spread — so we DEFER: the
// tag reads "≈ market", i.e. agreement, not an underdog pick. On closer games we show the real
// line-blind lean (which side our number has covering) with the margin.
const BIG_SPREAD = 17;

export function marginHome(sp: { fav: string; num: number } | null | undefined, home: string): number | null {
  if (!sp) return null;
  return sp.fav === home ? -sp.num : sp.num;   // num is the favorite's negative line
}

export function marketGap(g: NcaafCardGame): number | null {
  const m = marginHome(g.marketSpread, g.home), p = marginHome(g.projSpread, g.home);
  return m === null || p === null ? null : p - m;   // + = we're higher on the home team than the market
}

export function ncaafLean(g: NcaafCardGame): { cls: string; txt: string; tip: string } | null {
  const ms = g.marketSpread;
  if (!ms) return null;
  const line = Math.abs(ms.num);
  const favMargin = g.projSpread.fav === ms.fav ? Math.abs(g.projSpread.num) : -Math.abs(g.projSpread.num);
  const diff = favMargin - line;   // + = our number has the FAVORITE covering; − = the underdog
  if (line >= BIG_SPREAD) return { cls: "defer", txt: "≈ market",
    tip: "The model agrees with the market here. On a spread this big the market is efficient — heavy favorites cover about half the time — so we defer to the line rather than lean to the underdog. This is agreement, not a pick." };
  if (Math.abs(diff) < 1) return { cls: "even", txt: "≈ even",
    tip: "Our line-blind number is essentially the market's on this game — no lean either way." };
  if (diff > 0) return { cls: "fav", txt: `fav +${diff.toFixed(1)}`,
    tip: `Our line-blind read has the favorite covering by ${diff.toFixed(1)} pts — context, not a pick (our rating doesn't beat the spread).` };
  return { cls: "dog", txt: `dog +${Math.abs(diff).toFixed(1)}`,
    tip: `Our line-blind read has the underdog covering by ${Math.abs(diff).toFixed(1)} pts — context, not a pick (our rating doesn't beat the spread).` };
}

export function LeanTag({ g }: { g: NcaafCardGame }) {
  const l = ncaafLean(g);
  return l ? <span className={`hb-lean hb-lean--${l.cls}`} title={l.tip}>{l.txt}</span> : null;
}
