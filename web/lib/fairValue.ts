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

/** Strip the vig from a two-sided market → the fair probability of the FIRST side. */
export function deVig(sidePrice: number, otherPrice: number): number {
  const a = impliedProb(sidePrice), b = impliedProb(otherPrice);
  const sum = a + b;
  return sum > 0 ? a / sum : a;
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
export const AUDIT_CHEAT_BPS = 0.045;

/** 3-state verdict for the Pick Auditor board (null when the market can't be de-vigged). */
export function auditVerdict(offered: number, fairProb: number | null | undefined): Audit | null {
  if (fairProb == null) return null;
  return audit(offered, fairProb, AUDIT_CHEAT_BPS, AUDIT_VALUE_BPS);
}
