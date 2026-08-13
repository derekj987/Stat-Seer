// P(favorite wins outright) by spread magnitude, from 6,967 games (1999-2025).
// Generated from analysis/the_board.emp_winprob and baked in, so the coherence
// check needs no games.csv at runtime. Regenerate if the historical fit changes.
export const WIN_CURVE: Record<string, number> = {
  "1.0": 0.5321, "1.5": 0.5338, "2.0": 0.5558, "2.5": 0.5832, "3.0": 0.5956,
  "3.5": 0.6025, "4.0": 0.6222, "4.5": 0.6531, "5.0": 0.6706, "5.5": 0.685,
  "6.0": 0.7111, "6.5": 0.7196, "7.0": 0.7299, "7.5": 0.7462, "8.0": 0.7554,
  "8.5": 0.7625, "9.0": 0.7789, "9.5": 0.8014, "10.0": 0.8062, "10.5": 0.8156,
  "11.0": 0.8133, "11.5": 0.8262, "12.0": 0.8364, "12.5": 0.8419, "13.0": 0.8649,
  "13.5": 0.8724, "14.0": 0.8711,
};

/** Empirical favorite win prob for a spread magnitude (nearest 0.5 bucket). */
export function empWinProb(mag: number): number | null {
  const keys = Object.keys(WIN_CURVE).map(Number);
  if (!keys.length) return null;
  let best = keys[0];
  for (const k of keys) if (Math.abs(k - mag) < Math.abs(best - mag)) best = k;
  return WIN_CURVE[best.toFixed(1)] ?? null;
}
