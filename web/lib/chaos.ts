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
  week: number; // part-of-season drives the early X-factor
  dogReturn: number; // $ back on a $100 dog ticket (stake + profit)
  returnEst: boolean; // true = derived from the spread (no live moneyline)
  favTrait?: ChaosTrait;
  dogTrait?: ChaosTrait;
  windMph?: number | null;
  riserPct?: number; // 0-100: dog's preseason SP+ rank above last year's (CFB only)
}

export interface ChaosEntry extends ChaosInput {
  index: number;
  tier: "hot" | "warm" | "cool";
  earlyActive: boolean;
  subs: { boom: number; ceiling: number; wild: number; payout: number; early: number };
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

// Early-season X-factor: weeks 1-3 carry more real chaos (measured: dogs win ~1.5pts more at
// the same spread, and small/mid dogs most). It rewards the live-dog zone and, for CFB, an
// underdog whose preseason SP+ ranks it well above last year's results — an improved team the
// market is slow to respect, the classic "bad team catches a good team off guard." Zero after
// week 3. Not an edge — early dogs cover only ~53.5% ATS, within noise of the vig.
const liveZone = (line: number) => clamp(35 - Math.abs(line - 8) * 2.5, 0, 35);

export function scoreChaos(g: ChaosInput): ChaosEntry {
  const boom = g.favTrait?.volPct ?? 50; // a boom/bust favorite is more crashable
  const ceiling = g.dogTrait?.ceilPct ?? 50; // the dog's best-day upside
  const wind = g.windMph ?? 0;
  const wild = clamp(25 + (wind > 0 ? Math.min(60, wind * 3) : 0)); // variance amplifiers
  const payout = payoutScore(g.dogReturn);
  const earlyActive = g.week <= 3;
  const early = earlyActive ? clamp(30 + liveZone(g.line) + (g.riserPct ?? 0) * 0.4) : 0;

  // Keep boom/ceiling in the driver's seat so the board stays differentiated; the early
  // factor is a modest tilt toward live-dog / riser games, not a uniform floor.
  const w = earlyActive
    ? { boom: 0.27, ceiling: 0.25, wild: 0.16, payout: 0.17, early: 0.15 }
    : { boom: 0.3, ceiling: 0.28, wild: 0.2, payout: 0.22, early: 0 };
  const index = Math.round(w.boom * boom + w.ceiling * ceiling + w.wild * wild + w.payout * payout + w.early * early);
  const tier = index >= 72 ? "hot" : index >= 58 ? "warm" : "cool";

  // Story: lead with the loudest ingredient, always keep the payout as a candidate.
  const parts: [number, string][] = [
    [boom, `${g.fav} run hot and cold — ${Math.round(boom)}th-percentile boom/bust margins.`],
    [ceiling, `${g.dog} carry a monster ceiling — one big day and this flips.`],
    [wind > 0 ? wild : 0, wind > 0 ? `A ${Math.round(wind)} mph wind drags this toward a coin flip.` : ""],
    [earlyActive ? (g.riserPct ?? 0) : 0, `${g.dog} come in underrated — preseason ratings jumped them well past last year, and early-season favorites get caught looking.`],
    [earlyActive ? 52 : 0, `Weeks 1-3 wildcard — rosters and rhythm aren't settled yet, and a live dog can steal one.`],
    [payout, `A genuine long shot — but $100 comes back $${g.dogReturn.toLocaleString()}.`],
  ];
  const story = parts.filter((p) => p[1]).sort((a, b) => b[0] - a[0])[0][1];

  return { ...g, index, tier, earlyActive, subs: { boom, ceiling, wild, payout, early }, story };
}

/** Score, rank hottest-first, and keep the top N. */
export function buildChaosBoard(inputs: ChaosInput[], top = 6): ChaosEntry[] {
  return inputs.map(scoreChaos).sort((a, b) => b.index - a.index).slice(0, top);
}
