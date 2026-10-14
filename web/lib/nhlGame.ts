// Turn two team ratings into a projected game: expected score, margin, total and win probability.
//
// Logic lives here rather than in lib/nhlGameModel.ts, which is AUTO-GENERATED and rewritten on
// every refresh — a helper added there is wiped by the next run.
//
// 🚨 WHAT THIS IS WORTH, MEASURED, so nothing downstream overstates it. Held out on 2,504 games
// across two seasons the model never saw:
//
//     margin  MAE 1.7405 against a no-information baseline of 1.7768   +2.04%
//     total   MAE 1.8622 against 1.8635                                +0.07%
//     winner called right 54.0%, Brier 0.2465 against 0.2500
//
// So the margin carries a little, and THE TOTAL CARRIES ESSENTIALLY NOTHING — +0.07% over "always
// say the league average" is not a signal. It is published because a line-blind number graded in
// public is the point of this section, not because it finds a price error. Nothing here has been
// scored against the closing line.
import { NHL_RATINGS, NHL_LEAGUE_GOALS, NHL_HOME_ICE, NHL_MARGIN_SD } from "./nhlGameModel";
import { NHL_TEAM_ABBREV } from "./nhlRosters";
import { teamKey } from "./nhlTeamTag";

const BY_TEAM = new Map(NHL_RATINGS.map((r) => [r.team, r]));

/** Normal CDF — the margin distribution is summarised by its SD and nothing finer. */
function normCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26, plenty for a number printed as a whole percentage.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937
          + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

export interface NhlGameProj {
  home: string; away: string;
  homeAbbr: string; awayAbbr: string;
  homeGoals: number; awayGoals: number;
  margin: number;          // positive = home favoured, in goals
  total: number;
  homeWinPct: number;      // 0..1
}

/** Project one game from the two clubs' full names as the odds feed spells them. */
export function projectGame(homeName: string, awayName: string): NhlGameProj | null {
  const h = NHL_TEAM_ABBREV[teamKey(homeName)];
  const a = NHL_TEAM_ABBREV[teamKey(awayName)];
  if (!h || !a) return null;
  const rh = BY_TEAM.get(h), ra = BY_TEAM.get(a);
  if (!rh || !ra) return null;
  // Attack and the opposing defence are two estimates of the same quantity from different
  // directions, and neither is better informed, so they are averaged rather than multiplied.
  const hg = Math.max(0.5, (rh.attack + ra.defence) / 2 + NHL_HOME_ICE / 2);
  const ag = Math.max(0.5, (ra.attack + rh.defence) / 2 - NHL_HOME_ICE / 2);
  const margin = hg - ag;
  return {
    home: homeName, away: awayName, homeAbbr: h, awayAbbr: a,
    homeGoals: Math.round(hg * 100) / 100,
    awayGoals: Math.round(ag * 100) / 100,
    margin: Math.round(margin * 100) / 100,
    total: Math.round((hg + ag) * 100) / 100,
    // 🚨 A WIN PROBABILITY, NOT A PUCK-LINE CALL. The puck line is ±1.5 on every game in the
    // league and 43.2% of games finish inside one goal, so comparing our margin to a 1.5 "spread"
    // is the mistake the MLB run line already taught this project. P(margin > 0) is the question
    // the number can actually answer.
    //
    // THE NORMAL STAYS, AND THAT IS NOW MEASURED RATHER THAN ASSUMED. §14d warns against putting a
    // smooth distribution over NHL scoring, so two replacements were fitted on the training seasons
    // and scored on 2,504 held-out games (EMPIRICAL_REFERENCE §19):
    //
    //     normal, as here                       Brier 0.24400   winner 56.6%
    //     empirical 9-band win curve            Brier 0.24449   -0.35%
    //     normal with a fitted width (k=1.5)    Brier 0.24396   +0.02%
    //
    // Neither beats it, so neither ships. KNOWN LIMITATION, worth stating because it is real: the
    // normal COMPRESSES at the edges — at an expected margin of +0.85 it says 63.0% where the
    // observed rate is 68.7% (n=734, about 3 SE). Correcting that globally does not pay, because a
    // scale that helps the tails hurts the middle, where nearly every game sits. A proper fix is a
    // non-linear recalibration, which is the empirical table, which overfits at this sample size.
    // Revisit with more seasons; until then the page prints a whole percentage and never a price.
    homeWinPct: normCdf(margin / NHL_MARGIN_SD),
  };
}

export { NHL_LEAGUE_GOALS, NHL_HOME_ICE };
