// The Upset Meter — one 0-100 reading per game, on the model board under Special Considerations.
//
// Derek: "I want each game to have an 'Upset Meter' (not chaos board anymore) and we rate each
// game's upset potential based on our model, special considerations (scoring, weather, referee
// data) and chaos potential." So the Upset Lab's chaos index stops being its own page and becomes
// ONE INPUT here, beside the model's own disagreement with the market and the situational factors
// that were already on the board.
//
// ⚠️ WHAT THIS IS, SAID PLAINLY, BECAUSE THE PROJECT HAS A RULE ABOUT IT.
// "Panels inform, they do not vote": combining zero-edge signals produces zero edge while the
// appearance of rigor rises, and that is the machine the competition runs. So the meter is built
// to keep its parts legible rather than to launder them into a pick:
//
//   * MODEL is the only component with a measured claim behind it — our line-blind margin against
//     the market's number, which we publish and grade. It carries the most weight.
//   * SCORING, WEATHER and REFEREE are context. Each is a real, measured fact about the game; none
//     of them beats the closing line, and the file says so where it is scored.
//   * CHAOS is explicitly non-predictive — volatility and ceiling percentiles from the last two
//     seasons (lib/chaos.ts). It is the smallest weight and it is named on the card.
//
// The meter therefore reads as "how upset-prone does this game look, and why", with every driver
// shown, and it is never a pick. It does not feed The Model, calibration, or Value Finder.

export interface UpsetInput {
  /** Market spread from the HOME team's perspective; negative = home favoured. */
  marketSpreadHome: number | null;
  /** Our line-blind projected margin, home perspective. */
  modelMarginHome: number | null;
  /** Wind at the site, mph — null indoors or when no forecast has landed. */
  windMph?: number | null;
  /** Referee penalties per game, when the crew is known. */
  refPen?: number | null;
  /** League-average penalties per game, to read `refPen` against. */
  refLeaguePen?: number | null;
  /** % of this crew's games that went OVER the total, and the league's rate. */
  refOverPct?: number | null;
  refLeagueOverPct?: number | null;
  /** % of this crew's games the FAVOURITE covered, and the league's rate. */
  refFavCoverPct?: number | null;
  refLeagueFavCoverPct?: number | null;
  /** % of this crew's games the HOME side covered, and the league's rate. Read through
   *  `dogIsHome` so the reading always points at the underdog. */
  refHomeCoverPct?: number | null;
  refLeagueHomeCoverPct?: number | null;
  dogIsHome?: boolean;
  /** Points per game the underdog scores, and the favourite allows (season to date). */
  dogOff?: number | null;
  favDef?: number | null;
  /** League-average points per game, to read those two against. */
  leaguePts?: number | null;
  /** The Upset Lab's non-predictive chaos index for this game, 0-100. */
  chaosIndex?: number | null;
}

export interface UpsetDriver {
  key: "model" | "scoring" | "weather" | "referee" | "chaos";
  label: string;
  /** 0-100 — how much this factor argues for an upset. */
  score: number;
  /** What it is actually saying, in one clause. */
  note: string;
}

export interface UpsetRead {
  score: number;                       // 0-100
  tier: "high" | "notable" | "low";
  dog: string | null;                  // which side would be the upset — caller supplies names
  drivers: UpsetDriver[];              // every component, largest first
  headline: string;                    // the loudest driver, as a sentence
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Score a game's upset potential. `dogName`/`favName` are only used for the wording.
 *
 * Weights: model 40, scoring 18, chaos 16, weather 14, referee 12 — renormalised over whichever
 * components the game actually has, so a game with no forecast and no crew still reads 0-100.
 * The model's share is deliberately more than double any single context factor.
 */
export function upsetMeter(g: UpsetInput, dogName: string | null, favName: string | null): UpsetRead {
  const drivers: UpsetDriver[] = [];

  // --- Model: how far our own margin sits from the market's, in the dog's direction. ---
  // A model that OUTRIGHT picks the underdog is the strongest thing we can say; agreeing with the
  // market by a wide margin is the strongest thing against.
  if (g.marketSpreadHome !== null && g.modelMarginHome !== null) {
    const mktHome = -g.marketSpreadHome;                  // market's expected home margin
    const gap = g.modelMarginHome - mktHome;              // + = we like the home side more
    const towardDog = g.marketSpreadHome < 0 ? -gap : gap; // + = we lean toward whoever is the dog
    // 0 points of disagreement reads 40; a full touchdown toward the dog reads ~82.
    const score = clamp(40 + towardDog * 6);
    const picksDog = g.marketSpreadHome < 0
      ? g.modelMarginHome < 0
      : g.modelMarginHome > 0;
    drivers.push({
      key: "model", label: "Our model", score,
      note: picksDog
        ? `we project ${dogName ?? "the underdog"} to win outright`
        : Math.abs(towardDog) < 0.5
          ? "our number and the market's agree"
          : towardDog > 0
            ? `our number is ${towardDog.toFixed(1)} closer to ${dogName ?? "the dog"} than the market's`
            : `our number is ${Math.abs(towardDog).toFixed(1)} further toward ${favName ?? "the favourite"}`,
    });
  }

  // --- Scoring: can the dog score on this defence? Both read against the league rate. ---
  if (g.dogOff != null && g.favDef != null && g.leaguePts) {
    const off = g.dogOff / g.leaguePts;      // >1 = the dog scores more than a typical team
    const def = g.favDef / g.leaguePts;      // >1 = the favourite concedes more than typical
    const score = clamp(50 + (off - 1) * 70 + (def - 1) * 70);
    drivers.push({
      key: "scoring", label: "Scoring", score,
      note: `${dogName ?? "the dog"} scores ${g.dogOff.toFixed(1)} a game, ${favName ?? "the favourite"} allows ${g.favDef.toFixed(1)}`,
    });
  }

  // --- Weather: wind compresses a game toward a coin flip. Measured, and a Context flag only. ---
  if (g.windMph != null) {
    const score = clamp(28 + g.windMph * 2.6);
    drivers.push({
      key: "weather", label: "Weather", score,
      note: g.windMph >= 15 ? `${Math.round(g.windMph)} mph wind — enough to shrink the passing game`
        : g.windMph >= 8 ? `${Math.round(g.windMph)} mph wind`
        : "calm conditions",
    });
  }

  // --- Referee. Three readings, and they are NOT equal in standing.
  //
  // The penalty rate is the one crew tendency measured to persist year to year, so it leads: a
  // flag-heavy crew adds variance, which helps the side with less to lose. The over rate and the
  // favourite-cover rate are what Derek asked for ("do they favor over/unders, underdogs or
  // spreads covering") and they are HISTORY, not a tendency that carries — the referee analysis
  // this project published says so explicitly. They are included at half weight for that reason,
  // and the scroll on the card says which is which.
  if (g.refPen != null && g.refLeaguePen) {
    const pen = clamp(50 + (g.refPen / g.refLeaguePen - 1) * 160);
    const parts = [{ v: pen, w: 2 }];
    const bits: string[] = [
      g.refPen / g.refLeaguePen >= 1.06 ? `flag-heavy (~${g.refPen}/g)`
        : g.refPen / g.refLeaguePen <= 0.94 ? `lets them play (~${g.refPen}/g)`
        : `average flags (~${g.refPen}/g)`,
    ];
    if (g.refFavCoverPct != null && g.refLeagueFavCoverPct != null) {
      // A crew whose games see the favourite cover LESS often reads as upset-friendlier.
      parts.push({ v: clamp(50 + (g.refLeagueFavCoverPct - g.refFavCoverPct) * 2.2), w: 1 });
      bits.push(`favourites covered ${g.refFavCoverPct}% of his games`);
    }
    if (g.refHomeCoverPct != null && g.refLeagueHomeCoverPct != null && g.dogIsHome !== undefined) {
      // Turn "how often the home side covered" into "how often THIS game's underdog's side
      // covered", so the number always argues in the same direction as the meter.
      const dogCover = g.dogIsHome ? g.refHomeCoverPct : 100 - g.refHomeCoverPct;
      const lgDog = g.dogIsHome ? g.refLeagueHomeCoverPct : 100 - g.refLeagueHomeCoverPct;
      parts.push({ v: clamp(50 + (dogCover - lgDog) * 2.2), w: 1 });
      bits.push(`${g.dogIsHome ? "home" : "road"} teams covered ${Math.round(dogCover)}% of his games`);
    }
    if (g.refOverPct != null && g.refLeagueOverPct != null) {
      // A high-scoring environment gives a dog more ways back into a game.
      parts.push({ v: clamp(50 + (g.refOverPct - g.refLeagueOverPct) * 2.2), w: 1 });
      bits.push(`${g.refOverPct}% went over`);
    }
    const wsumR = parts.reduce((a, b) => a + b.w, 0);
    drivers.push({
      key: "referee", label: "Referee",
      score: parts.reduce((a, b) => a + b.v * b.w, 0) / wsumR,
      note: bits.join(" · "),
    });
  }

  // --- Chaos: the Upset Lab index. Non-predictive by construction; smallest weight. ---
  if (g.chaosIndex != null) {
    drivers.push({
      key: "chaos", label: "Chaos", score: clamp(g.chaosIndex),
      note: "volatility and ceiling from the last two seasons — for flavour, not a forecast",
    });
  }

  const W: Record<UpsetDriver["key"], number> = {
    model: 40, scoring: 18, chaos: 16, weather: 14, referee: 12,
  };
  const wsum = drivers.reduce((s, d) => s + W[d.key], 0);
  const score = wsum ? Math.round(drivers.reduce((s, d) => s + W[d.key] * d.score, 0) / wsum) : 0;
  const tier = score >= 62 ? "high" : score >= 48 ? "notable" : "low";
  const ordered = [...drivers].sort((a, b) => b.score - a.score);
  return {
    score, tier, dog: dogName,
    drivers: ordered,
    headline: ordered[0]?.note ?? "not enough posted yet to read this game",
  };
}
