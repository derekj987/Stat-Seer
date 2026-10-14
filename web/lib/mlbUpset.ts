// The Upset Meter for baseball — one 0-100 reading per game, under the MLB model board, built
// from the same parts and rendered by the same component as the NFL's and the NHL's.
//
// Derek: "add the Upset Meter to the MLB cards too". Baseball's drivers are its own: two of
// football's five do not exist here, and the one factor measured to actually move a baseball game
// has no football equivalent at all. So the recipe is written out with baseball's numbers and only
// the TYPE and the COMPONENT are shared — which keeps every board reading the same way without
// pretending the inputs are the same.
//
// ⚠️ WHAT THIS IS, SAID PLAINLY, BECAUSE THE PROJECT HAS A RULE ABOUT IT. "Panels inform, they do
// not vote": combining zero-edge signals produces zero edge while the appearance of rigor rises.
// So the parts stay legible rather than laundered:
//
//   * MODEL is the only component with a measured claim behind it — our line-blind margin against
//     the market's, which we publish and grade. It carries the most weight, as on every board.
//   * PITCHING is the one factor this project measured to MOVE a baseball game. The model's own
//     validation is blunt about it: team quality alone was worth 0.0%, and the starting pitcher
//     and the ballpark are what carry the projection. It is already inside our number, and the
//     scroll says so.
//   * SCORING is context — each club's park-neutral runs for and against.
//   * CHAOS is explicitly non-predictive and carries the least.
//
// WHAT IS DELIBERATELY ABSENT:
//   * WEATHER — this project captures forecasts for NFL stadiums, not ballparks. Wind at Wrigley
//     is a real baseball factor and we do not have it; an empty row is better than a borrowed one.
//   * UMPIRE — the plate umpire's zone is baseball's referee, and we capture no assignments.
//   * BULLPEN, RECENT FORM, LINEUP STRENGTH, HOME FIELD — each was tested walk-forward against the
//     model itself and none improved held-out results (MLB_GAME_SCORES.tried). Something that
//     could not help the projection does not become informative by being drawn as a bar.
import type { UpsetDriver, UpsetRead } from "./upsetMeter";
import type { MlbTeam } from "./mlbGameModel";

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** The margin SD lib/mlbBoard.ts converts moneylines through — the same number, so the two sides
 *  of the model driver are measured on one scale. */
const MLB_MARGIN_SD = 4.63;

export interface MlbUpsetInput {
  /** The market's expected margin in RUNS, home perspective (lib/mlbBoard marketMargin). */
  marketMarginHome: number | null;
  /** Our line-blind projected margin, home perspective. */
  modelMarginHome: number;
  home: MlbTeam | undefined;
  away: MlbTeam | undefined;
  /** Each starter's run factor: >1 gives up more than league, <1 suppresses. Pass null when the
   *  starter is not posted — the model defaults an unknown arm to exactly 1.0, and a driver built
   *  on two defaults is a fabricated 50, not a reading. */
  homeSpFactor: number | null;
  awaySpFactor: number | null;
  /** League runs per club per game, to read each club's rates against. */
  leagueRuns: number;
}

/**
 * Score one MLB game's upset potential. `dogName`/`favName` are used only for the wording.
 *
 * Weights: model 40, scoring 18, chaos 16, pitching 14 — renormalised over whichever drivers the
 * game actually has, so a game with no posted starters still reads 0-100. The model's share is
 * more than double any single context factor, exactly as on the other boards.
 */
export function mlbUpsetMeter(
  g: MlbUpsetInput, dogName: string | null, favName: string | null,
): UpsetRead {
  const drivers: UpsetDriver[] = [];
  // Which side the market makes the underdog. Without a market there is no dog, and the meter is
  // about an upset, so everything downstream needs it.
  const homeIsDog = g.marketMarginHome !== null ? g.marketMarginHome < 0 : null;
  const dogR = homeIsDog === null ? undefined : homeIsDog ? g.home : g.away;
  const favR = homeIsDog === null ? undefined : homeIsDog ? g.away : g.home;
  const dogSp = homeIsDog === null ? null : homeIsDog ? g.homeSpFactor : g.awaySpFactor;
  const favSp = homeIsDog === null ? null : homeIsDog ? g.awaySpFactor : g.homeSpFactor;

  // --- Model: how far our own margin sits from the market's, in the dog's direction. ---
  //
  // 🚨 THE SCALE IS BASEBALL'S. Football reads 40 + 6 per point, so a touchdown lands near 82. A
  // run is not a point: margins here have an SD of 4.63 against football's ~13.5, so the same
  // slope would barely move the dial at all. Scaling by the ratio of the two SDs puts a full run
  // of disagreement where a touchdown sits on the football board — the same approach the hockey
  // meter takes in the other direction.
  const PER_RUN = 6 * (13.5 / MLB_MARGIN_SD);
  if (g.marketMarginHome !== null) {
    const gap = g.modelMarginHome - g.marketMarginHome;   // + = we like the home side more
    const towardDog = homeIsDog ? gap : -gap;             // + = we lean toward whoever is the dog
    const score = clamp(40 + towardDog * PER_RUN);
    const picksDog = homeIsDog ? g.modelMarginHome > 0 : g.modelMarginHome < 0;
    drivers.push({
      key: "model", label: "Our model", score,
      // 🚨 THE NOTE CARRIES THE SIZE, NOT JUST THE DIRECTION. "We project the dog to win outright"
      // is the strongest thing this driver can say, and in football it only happens on a real
      // disagreement. Baseball margins are small enough to cross zero on half a run, so the bare
      // sentence read as a scream beside a bar of 56 and a card that said the favourite should
      // hold. Naming the gap makes the words and the bar agree.
      note: picksDog
        ? `we have ${dogName ?? "the underdog"} winning outright, ${towardDog.toFixed(1)} of a run away from the market`
        : Math.abs(towardDog) < 0.1
          ? "our number and the market's agree"
          : towardDog > 0
            ? `our number is ${towardDog.toFixed(1)} of a run closer to ${dogName ?? "the dog"} than the market's`
            : `our number is ${Math.abs(towardDog).toFixed(1)} of a run further toward ${favName ?? "the favourite"}`,
    });
  }

  // --- Scoring: can the dog score, and does the favourite concede? Both against the league rate. ---
  if (dogR && favR && g.leagueRuns) {
    const off = dogR.off / g.leagueRuns;     // >1 = the dog scores more than a typical club
    const def = favR.dfn / g.leagueRuns;     // >1 = the favourite concedes more than typical
    const score = clamp(50 + (off - 1) * 70 + (def - 1) * 70);
    drivers.push({
      key: "scoring", label: "Scoring", score,
      note: `${dogName ?? "the dog"} score ${dogR.off.toFixed(2)} a game, ${favName ?? "the favourite"} allow ${favR.dfn.toFixed(2)}`,
    });
  }

  // --- Pitching: the one thing measured to move a baseball game. ---
  //
  // A factor is runs allowed against the league's rate, already shrunk the way the projection
  // shrinks it and only computed for an arm with real innings behind it. The upset case is the
  // obvious one and the one baseball people actually watch for: the underdog runs its best starter
  // out against a favourite's weak one.
  //
  // 🚨 ONLY WHEN BOTH ARE POSTED. An unknown starter defaults to exactly 1.0 in the projection,
  // which is the honest default there — but carried into here it would draw a confident 50 on a
  // game where nobody knows who is pitching. In October half the board has no probable yet.
  if (dogSp !== null && favSp !== null) {
    // Factors run roughly 0.80 to 1.20, so 100 puts a good arm against a bad one near the ends.
    const score = clamp(50 + (favSp - 1) * 100 + (1 - dogSp) * 100);
    const word = (f: number) => (f <= 0.93 ? "tough" : f >= 1.07 ? "hittable" : "middling");
    drivers.push({
      key: "pitching", label: "Pitching", score,
      note: `${dogName ?? "the dog"} throw a ${word(dogSp)} starter, ${favName ?? "the favourite"} a ${word(favSp)} one`,
    });
  }

  // --- Chaos: non-predictive by construction; smallest weight. ---
  //
  // 🚨 A PERCENTILE HIDES HOW CLOSE THESE CLUBS ARE, so the size was measured rather than assumed:
  // MLB margin volatility runs 3.87 to 5.27 runs across the 30 clubs, a spread of 31% of the league
  // median. Football's is 40% and hockey's 18%, so baseball sits between them — the ordering means
  // something, the ends are not as far apart as a 0-100 bar suggests, and the scroll says so.
  const boom = favR?.volPct ?? null;      // a boom-and-bust favourite is more crashable
  const ceiling = dogR?.ceilPct ?? null;  // the dog's best-night upside
  if (boom !== null || ceiling !== null) {
    const parts = [{ v: boom, w: 24 }, { v: ceiling, w: 22 }]
      .filter((p): p is { v: number; w: number } => p.v !== null);
    const wsumC = parts.reduce((s, p) => s + p.w, 0);
    drivers.push({
      key: "chaos", label: "Chaos",
      score: clamp(parts.reduce((s, p) => s + p.v * p.w, 0) / wsumC),
      note: "how streaky the favourite has been and how big the dog's best night has been — for flavour, not a forecast",
    });
  }

  const W: Partial<Record<UpsetDriver["key"], number>> = {
    model: 40, scoring: 18, chaos: 16, pitching: 14,
  };
  const wsum = drivers.reduce((s, d) => s + (W[d.key] ?? 0), 0);
  const score = wsum
    ? Math.round(drivers.reduce((s, d) => s + (W[d.key] ?? 0) * d.score, 0) / wsum)
    : 0;
  const tier = score >= 62 ? "high" : score >= 48 ? "notable" : "low";
  const ordered = [...drivers].sort((a, b) => b.score - a.score);
  return {
    score, tier, dog: dogName, drivers: ordered,
    headline: ordered[0]?.note ?? "not enough posted yet to read this game",
  };
}
