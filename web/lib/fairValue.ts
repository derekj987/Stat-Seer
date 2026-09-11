// Pick Auditor — the fair-price engine. Given a book's price and (where available) the OTHER side of
// the same market, strip the vig to get the market's own fair probability, then price a bet against
// it. This is pure arithmetic on the market's own numbers — no model edge claim (our projections
// don't beat the closing line, so the honest signal is "this price vs the de-vigged market", not
// "our model says…"). One-sided markets (e.g. anytime-TD with no "No") can't be de-vigged, so their
// audit falls back to cross-book shopping (this price vs the best available).

export type AuditVerdict = "value" | "fair" | "cheat";

/** American odds → implied probability (with the book's vig still in it). */
export function impliedProb(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

/** Probability → fair American odds (no vig). */
export function probToAmerican(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return p <= 0.5 ? Math.round((1 - p) / p * 100) : -Math.round(p / (1 - p) * 100);
}

/** Strip the vig from a two-sided market → the fair probability of the FIRST side.
 *
 *  POWER method, not proportional. Proportional (a / (a + b)) hands both sides an equal share of
 *  the hold, and that under-prices favourites: books load more of the vig onto the longshot (the
 *  favourite–longshot bias), so the favourite's true chance sits ABOVE its proportional share.
 *  Power finds k with a^k + b^k = 1 and returns a^k — identical to proportional at −110/−110
 *  (game lines), and 1–1.5 points higher for the favourite on a lopsided prop such as 1+ hit at
 *  −230/+175 (proportional 65.7%, power 67.0%).
 *
 *  Why it changed: the MLB hits board read above the book on 77% of rows. Half of that gap was
 *  our level (fixed by a trailing calibration in mlb_player_props.py); the other half was THIS
 *  number being low for a favourite market. After both, 56% of rows. Same method in
 *  mlb_player_props._power_devig so the grader and the board agree. */
export function deVig(sidePrice: number, otherPrice: number): number {
  const a = impliedProb(sidePrice), b = impliedProb(otherPrice);
  if (a <= 0 || b <= 0 || a + b <= 1) return a + b > 0 ? a / (a + b) : a;
  let lo = 0.5, hi = 4;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    if (Math.pow(a, k) + Math.pow(b, k) > 1) lo = k; else hi = k;
  }
  return Math.pow(a, (lo + hi) / 2);
}

/**
 * Audit a bet: how its offered price compares to the fair price.
 * `edgePct` = how much better (+) or worse (−) the offered payout is than fair, in probability terms.
 * A price is "cheat" when it pays meaningfully worse than fair, "value" when meaningfully better.
 */
export interface Audit { fair: number; edgePct: number; verdict: AuditVerdict }

export function audit(offered: number, fairProb: number, cheatBps = 0.02, valueBps = 0.02): Audit | null {
  if (fairProb <= 0 || fairProb >= 1) return null;
  const fair = probToAmerican(fairProb);
  // Compare in probability space: what the book implies you must pay vs the fair chance.
  const offeredProb = impliedProb(offered);
  const edge = fairProb - offeredProb;   // + = book pays for a rarer event than fair ⇒ value to bettor
  const verdict: AuditVerdict = edge <= -cheatBps ? "cheat" : edge >= valueBps ? "value" : "fair";
  return { fair, edgePct: edge, verdict };
}

export const VERDICT_LABEL: Record<AuditVerdict, string> = {
  value: "Value",
  fair: "Fair",
  cheat: "Overpriced",
};

// Auditor board calibration. A single book price always carries some vig, so it sits a little
// worse than its own de-vigged fair even at a fair book — so "fair" (white) spans the normal
// vig range, "value" (green) is a price that actually beats fair, and "cheat" (red) is a price
// worse than even a typical hold explains.
export const AUDIT_VALUE_BPS = 0.01;
export const AUDIT_CHEAT_BPS = 0.03;

/** 3-state verdict for the Pick Auditor board (null when the market can't be de-vigged). */
export function auditVerdict(offered: number, fairProb: number | null | undefined): Audit | null {
  if (fairProb == null) return null;
  return audit(offered, fairProb, AUDIT_CHEAT_BPS, AUDIT_VALUE_BPS);
}
