// The Upset Meter for hockey — one 0-100 reading per game, under each NHL card's Special
// Considerations, built from the same parts and rendered by the same component as the NFL's.
//
// Derek: "add the Upset Lab panel to the NHL cards too". The football meter cannot simply be
// called: two of its five drivers do not exist in hockey, one of its drivers is NHL-specific, and
// the one shared with football is measured on a scale six times smaller. So the recipe is written
// out here with hockey's own numbers, and only the TYPE and the COMPONENT are shared — which keeps
// the two boards reading identically without pretending the inputs are the same.
//
// ⚠️ WHAT THIS IS, SAID PLAINLY, BECAUSE THE PROJECT HAS A RULE ABOUT IT. "Panels inform, they do
// not vote": combining zero-edge signals produces zero edge while the appearance of rigor rises.
// So the parts stay legible rather than laundered:
//
//   * MODEL is the only component with a measured claim behind it — our line-blind margin against
//     the market's, which we publish and grade. It carries the most weight, as in football.
//   * SCORING is context: each club's goals for and against, which are real and measured.
//   * CHAOS is explicitly non-predictive and carries the least.
//
// WHAT IS DELIBERATELY ABSENT, because every one of these was considered and three were tried:
//   * WEATHER — indoors.
//   * REFEREE — no NHL crew assignments are captured by this project.
//   * REST — a back-to-back is on the card because it predicts the LINEUP, but the raw data shows
//     no scoring penalty for one (§14c), so it is not scored here. A driver measured at zero adds
//     nothing to a weighted blend except the look of having more drivers.
//   * GOALTENDING — written, rendered, measured against §15c, and REMOVED. A driver reading the two
//     clubs' recent save percentage is the obvious hockey factor and it looked like the best thing
//     on the panel: on the first live board it was the loudest driver on 5 of 13 cards. It is
//     noise. §15c swept how hard to pull a goalie's save% toward the league mean and the result was
//     monotone to the limit — the best projection IGNORES HIS OWN SAVE PERCENTAGE ENTIRELY, because
//     it persists at r = 0.307. In October that driver was swinging 0 to 100 on four or five
//     starts. The honest consequence is that the correctly-shrunk version is the league average for
//     both clubs, i.e. a constant 50, which is not a driver at all. The goaltending FACTS stay on
//     the card above as history; they are not allowed to move a number.
import type { UpsetDriver, UpsetRead } from "./upsetMeter";
import { NHL_MARGIN_SD } from "./nhlGameModel";
import type { NhlTeamRating } from "./nhlGameModel";

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export interface NhlUpsetInput {
  /** The market's expected margin in GOALS, home perspective (lib/nhlBoard marketMargin). */
  marketMarginHome: number | null;
  /** Our line-blind projected margin, home perspective. */
  modelMarginHome: number;
  home: NhlTeamRating | undefined;
  away: NhlTeamRating | undefined;
  /** League goals per game, to read each club's scoring against. */
  leagueGoals: number;
}

/**
 * Score one NHL game's upset potential. `dogName`/`favName` are used only for the wording.
 *
 * Weights: model 40, scoring 18, chaos 16 — renormalised over whichever drivers the game actually
 * has, so a game in the season's first week still reads 0-100. The model's share is more than
 * double any single context factor, exactly as in football.
 */
export function nhlUpsetMeter(
  g: NhlUpsetInput, dogName: string | null, favName: string | null,
): UpsetRead {
  const drivers: UpsetDriver[] = [];
  // Which side the market makes the underdog. With no market we cannot name a dog at all, and the
  // meter is about an upset, so everything downstream needs it.
  const homeIsDog = g.marketMarginHome !== null ? g.marketMarginHome < 0 : null;
  const dogR = homeIsDog === null ? undefined : homeIsDog ? g.home : g.away;
  const favR = homeIsDog === null ? undefined : homeIsDog ? g.away : g.home;

  // --- Model: how far our own margin sits from the market's, in the dog's direction. ---
  //
  // 🚨 THE SCALE IS HOCKEY'S, NOT FOOTBALL'S. The NFL meter reads 40 + 6 per point of
  // disagreement, so a touchdown of daylight lands near 82. A goal is not a point: margins here
  // have an SD of 2.57 against football's ~13.5, so the same 6-per-point would make every ordinary
  // half-goal difference look like a scream. Scaling by the ratio of the two SDs puts a full goal
  // of disagreement at the same place on the dial a touchdown sits in football.
  const PER_GOAL = 6 * (13.5 / NHL_MARGIN_SD);
  if (g.marketMarginHome !== null) {
    const gap = g.modelMarginHome - g.marketMarginHome;    // + = we like the home side more
    const towardDog = homeIsDog ? gap : -gap;              // + = we lean toward whoever is the dog
    const score = clamp(40 + towardDog * PER_GOAL);
    const picksDog = homeIsDog ? g.modelMarginHome > 0 : g.modelMarginHome < 0;
    drivers.push({
      key: "model", label: "Our model", score,
      note: picksDog
        ? `we project ${dogName ?? "the underdog"} to win outright`
        : Math.abs(towardDog) < 0.1
          ? "our number and the market's agree"
          : towardDog > 0
            ? `our number is ${towardDog.toFixed(1)} of a goal closer to ${dogName ?? "the dog"} than the market's`
            : `our number is ${Math.abs(towardDog).toFixed(1)} of a goal further toward ${favName ?? "the favourite"}`,
    });
  }

  // --- Scoring: can the dog score on this defence? Both read against the league rate. ---
  // Same shape as football's, re-tuned for goals: the multiplier is set so a club a full goal above
  // the league rate (about the widest gap the league produces) moves the driver ~23 points, which
  // keeps it in the same band football's points-per-game version occupies.
  if (dogR && favR && g.leagueGoals) {
    const off = dogR.attack / g.leagueGoals;    // >1 = the dog scores more than a typical club
    const def = favR.defence / g.leagueGoals;   // >1 = the favourite concedes more than typical
    const score = clamp(50 + (off - 1) * 70 + (def - 1) * 70);
    drivers.push({
      key: "scoring", label: "Scoring", score,
      note: `${dogName ?? "the dog"} score ${dogR.attack.toFixed(2)} a game, ${favName ?? "the favourite"} allow ${favR.defence.toFixed(2)}`,
    });
  }

  // (A goaltending driver belongs here and is deliberately not here — see the header, §15c.)

  // --- Chaos: non-predictive by construction; smallest weight. ---
  //
  // 🚨 A PERCENTILE HIDES HOW CLOSE THESE CLUBS ARE. Measured across 32 teams and three seasons,
  // NHL margin volatility runs 2.39 to 2.85 goals — 18% of the league median, against football's
  // 40%. So the ends of this scale are a third of a goal apart, and the panel's scroll says so.
  // It is kept because the ORDERING is real and the weight is small, not because the gaps are big.
  const boom = favR?.volPct ?? null;      // a boom-and-bust favourite is more crashable
  const ceiling = dogR?.ceilPct ?? null;  // the dog's best-night upside
  if (boom !== null || ceiling !== null) {
    const parts = [
      { v: boom, w: 24 }, { v: ceiling, w: 22 },
    ].filter((p): p is { v: number; w: number } => p.v !== null);
    const wsumC = parts.reduce((s, p) => s + p.w, 0);
    drivers.push({
      key: "chaos", label: "Chaos",
      score: clamp(parts.reduce((s, p) => s + p.v * p.w, 0) / wsumC),
      note: "how streaky the favourite has been and how big the dog's best night has been — for flavour, not a forecast",
    });
  }

  const W: Partial<Record<UpsetDriver["key"], number>> = {
    model: 40, scoring: 18, chaos: 16,
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
