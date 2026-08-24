// Speculative "Chaos Board" scoring — for the Upset Lab panel only. This is deliberately
// NON-predictive fun for aggressive bettors: it scores how upset-RIPE a game feels from
// size-independent flavors (a boom/bust favorite, a high-ceiling dog, wildcard variance)
// plus the dog's payout. It never feeds The Model, calibration, or Value Finder, and the
// UI states plainly that the market thinks these are long shots.
import type { ChaosTrait, StadiumEnv } from "./chaosTraits";

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
  comfortPct?: number; // 0-100: how much the venue resembles the dog's home (NFL only)
  comfortNote?: string; // one-line reason when the dog is notably in/out of its element
  improvePct?: number; // 0-100: how much the dog improved this offseason (CFB SP+ riser / NFL FPI)
}

export interface ChaosEntry extends ChaosInput {
  index: number;
  tier: "hot" | "warm" | "cool";
  earlyActive: boolean;
  comfortActive: boolean;
  improveActive: boolean;
  subs: { boom: number; ceiling: number; wild: number; payout: number; early: number; comfort: number; improved: number };
  story: string;
}

/** How much the venue resembles the away dog's own home (0-100) + a one-line reason. Not
 * weather — structural: a warm/indoor team dropped into a genuinely COLD outdoor venue is
 * the real disadvantage, and only LATE in the season when those venues are actually cold (a
 * dome team in mild September weather is fine — we don't assume indoor teams struggle
 * outdoors). Tested: comfortable away dogs win outright ~33% vs ~27% for hostile ones (a real
 * upset-frequency gap), but it's ~priced ATS, so it's chaos flavor, not an edge. */
export function comfortInfo(dog: string, away: StadiumEnv, venue: StadiumEnv, week: number): { score: number; note: string } {
  let c = 100;
  const coldSeason = week >= 10; // northern outdoor venues are only truly cold late in the year
  const hostileCold = coldSeason && !venue.indoor && venue.climate === "cold" &&
    (away.climate === "controlled" || away.climate === "warm");
  if (hostileCold) c -= 45; // a warm/dome team out in the late-season cold
  if (away.surface !== venue.surface) c -= 8; // turf<->grass, minor
  c = clamp(c);
  let note = "";
  if (hostileCold) {
    note = `${dog} are out of their element — a warm/indoor team out in a cold ${venue.indoor ? "" : "outdoor "}venue this late.`;
  } else if (away.indoor && venue.indoor && c >= 92) {
    note = `${dog} bring their dome game to another dome — right at home, nothing to adjust to.`;
  } else if (away.climate === "cold" && venue.climate === "cold" && coldSeason && c >= 92) {
    note = `${dog} are a cold-weather team in the cold — right in their element.`;
  }
  return { score: c, note };
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
  const early = earlyActive ? clamp(30 + liveZone(g.line)) : 0;
  const comfortActive = g.comfortPct != null;
  const comfort = g.comfortPct ?? 0;
  const improveActive = g.improvePct != null;
  const improved = g.improvePct ?? 0;

  // Relative weights; inactive factors drop out and the rest renormalize, so the scale stays
  // 0-100 whichever factors a game has. boom/ceiling stay dominant so the board differentiates.
  const wRaw: Record<string, number> = {
    boom: 24, ceiling: 22, wild: 14, payout: 16,
    early: earlyActive ? 12 : 0,
    comfort: comfortActive ? 12 : 0,
    improved: improveActive ? 12 : 0,
  };
  const subs = { boom, ceiling, wild, payout, early, comfort, improved };
  const wsum = Object.values(wRaw).reduce((a, b) => a + b, 0);
  const index = Math.round(
    (Object.keys(wRaw) as (keyof typeof subs)[]).reduce((s, k) => s + wRaw[k] * subs[k], 0) / wsum,
  );
  const tier = index >= 72 ? "hot" : index >= 58 ? "warm" : "cool";

  // Story: lead with the loudest ingredient, always keep the payout as a candidate.
  const parts: [number, string][] = [
    [boom, `${g.fav} run hot and cold — ${Math.round(boom)}th-percentile boom/bust margins.`],
    [ceiling, `${g.dog} carry a monster ceiling — one big day and this flips.`],
    [wind > 0 ? wild : 0, wind > 0 ? `A ${Math.round(wind)} mph wind drags this toward a coin flip.` : ""],
    [improveActive && improved >= 72 ? improved : 0, `${g.dog} come in much improved — the preseason numbers have them well up on last year, and a rising team catches favorites looking.`],
    [earlyActive ? 52 : 0, `Weeks 1-3 wildcard — rosters and rhythm aren't settled yet, and a live dog can steal one.`],
    [comfortActive && comfort >= 88 && g.comfortNote ? comfort : 0, g.comfortNote || ""],
    [payout, `A genuine long shot — but a $100 ticket comes back $${g.dogReturn.toLocaleString()} if they win outright.`],
  ];
  const story = parts.filter((p) => p[1]).sort((a, b) => b[0] - a[0])[0][1];

  return { ...g, index, tier, earlyActive, comfortActive, improveActive, subs, story };
}

/** Score, rank hottest-first, and keep the top N. */
export function buildChaosBoard(inputs: ChaosInput[], top = 6): ChaosEntry[] {
  return inputs.map(scoreChaos).sort((a, b) => b.index - a.index).slice(0, top);
}
