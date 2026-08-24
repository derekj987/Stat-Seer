// Speculative "Chaos Board" scoring — for the Upset Lab panel only. This is deliberately
// NON-predictive fun for aggressive bettors: it scores how upset-RIPE a game feels from
// size-independent flavors (a boom/bust favorite, a high-ceiling dog, wildcard variance)
// plus the dog's payout. It never feeds The Model, calibration, or Value Finder, and the
// UI states plainly that the market thinks these are long shots.
import type { ChaosTrait } from "./chaosTraits";

export interface ChaosInput {
  sport: "NFL" | "CFB";
  away: string;
  home: string;
  dog: string;
  fav: string;
  line: number; // |spread| in points
  dogReturn: number; // $ back on a $100 dog ticket (stake + profit)
  returnEst: boolean; // true = derived from the spread (no live moneyline)
  favTrait?: ChaosTrait;
  dogTrait?: ChaosTrait;
  windMph?: number | null;
}

export interface ChaosEntry extends ChaosInput {
  index: number;
  tier: "hot" | "warm" | "cool";
  subs: { boom: number; ceiling: number; wild: number; payout: number };
  story: string;
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

/** Fair-ish $ return on a $100 underdog ticket, derived from the spread when no live
 * moneyline exists (NCAAF). Logistic dog win-prob with a sport-tuned scale, then a light
 * book haircut so it reads like a real long-shot price. */
export function returnFromSpread(line: number, sport: "NFL" | "CFB"): number {
  const scale = sport === "NFL" ? 7.2 : 10.0;
  const p = 1 / (1 + Math.exp(line / scale)); // P(dog wins outright)
  const book = clamp(p * 1.06, 0.01, 0.95); // ~6% vig
  return Math.round((100 / book) / 10) * 10; // total return, nearest $10
}

/** Log-scaled payout appeal: a small dog (~$150 back) ≈ 0, a monster long shot (~$3000) ≈ 100. */
function payoutScore(dogReturn: number): number {
  const lo = 150, hi = 3000;
  return clamp((100 * Math.log(Math.max(dogReturn, lo) / lo)) / Math.log(hi / lo));
}

export function scoreChaos(g: ChaosInput): ChaosEntry {
  const boom = g.favTrait?.volPct ?? 50; // a boom/bust favorite is more crashable
  const ceiling = g.dogTrait?.ceilPct ?? 50; // the dog's best-day upside
  const wind = g.windMph ?? 0;
  const wild = clamp(25 + (wind > 0 ? Math.min(60, wind * 3) : 0)); // variance amplifiers
  const payout = payoutScore(g.dogReturn);

  const index = Math.round(0.3 * boom + 0.28 * ceiling + 0.2 * wild + 0.22 * payout);
  const tier = index >= 72 ? "hot" : index >= 58 ? "warm" : "cool";

  // Story: lead with the loudest ingredient, always name the payout.
  const parts: [number, string][] = [
    [boom, `${g.fav} run hot and cold — ${Math.round(boom)}th-percentile boom/bust margins.`],
    [ceiling, `${g.dog} carry a monster ceiling — one big day and this flips.`],
    [wind > 0 ? wild : 0, wind > 0 ? `A ${Math.round(wind)} mph wind drags this toward a coin flip.` : ""],
    [payout, `A genuine long shot — but $100 comes back $${g.dogReturn.toLocaleString()}.`],
  ];
  const story = parts.filter((p) => p[1]).sort((a, b) => b[0] - a[0])[0][1];

  return { ...g, index, tier, subs: { boom, ceiling, wild, payout }, story };
}

/** Score, rank hottest-first, and keep the top N. */
export function buildChaosBoard(inputs: ChaosInput[], top = 6): ChaosEntry[] {
  return inputs.map(scoreChaos).sort((a, b) => b.index - a.index).slice(0, top);
}
