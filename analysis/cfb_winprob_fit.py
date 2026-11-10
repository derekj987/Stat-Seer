#!/usr/bin/env python3
"""Does the NCAAF card's margin give an honest WIN probability?

The Parlay of the Week ranks legs by our own published win probability, and NCAAF publishes a
margin and no probability at all -- its report-card Brier line reads `None`. This fits the same
conversion MLB already ships and, more importantly, SCORES it, because a probability nobody has
graded is a decoration with a percent sign on it.

    P(home win) = Phi(card_margin / sd)      sd = pstdev(pred - actual) on the TRAIN seasons only

Method, copied deliberately from mlb_game_model.cover_calibration so the two sports are judged the
same way:

  * the margin is PRODUCTION'S, not a re-derivation. analysis/cfb_card_backtest.run() walks forward
    exactly as the live card does -- ridge ratings refit before each slate, CARD_SCALE, the
    anchored big-spread de-bias and the close/mid correction all applied. A validator that builds
    its own margin drifts the moment production changes, and it drifts silently.
  * sd is fitted on the CHOOSE seasons and every number reported is from the CONFIRM seasons. Not
    pooled: a conversion fitted and scored on the same games will always look calibrated.
  * the baseline is the HOME-WIN BASE RATE on the same held-out games, captured from those games
    rather than from the full set, so the thing we have to beat is not flattered.
  * a Brier score alone is NOT a calibration check -- it can improve while every number on the
    board sits above the truth. The bucket table is the point; the Brier is the summary.

    python analysis/cfb_winprob_fit.py                 # choose 2021-23, confirm 2024-25
    python analysis/cfb_winprob_fit.py --split 2022
"""
import argparse
import math
import os
import statistics
import sys
from statistics import NormalDist

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cfb_card_backtest as cb   # noqa: E402

ND = NormalDist()


def brier(pairs):
    """(model Brier, base-rate Brier, base rate) over (p, y)."""
    base = statistics.mean(y for _, y in pairs)
    return (statistics.mean((p - y) ** 2 for p, y in pairs),
            statistics.mean((base - y) ** 2 for _, y in pairs),
            base)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="data/cfb.db")
    ap.add_argument("--start", type=int, default=2021)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--split", type=int, default=2023, help="choose on <= this, confirm after")
    ap.add_argument("--lam", type=float, default=5.0)
    ap.add_argument("--cap", type=int, default=28)
    ap.add_argument("--from-week", type=int, default=6)
    ap.add_argument("--decay", type=float, default=0.6)
    args = ap.parse_args(argv)

    games = cb.load(args.db, args.start, args.end)
    print(f"{len(games):,} FBS-vs-FBS games with a closing line, {args.start}-{args.end}")
    tr_games = [g for g in games if g["season"] <= args.split]
    te_games = [g for g in games if g["season"] > args.split]
    if not tr_games or not te_games:
        print("ERROR: split leaves one side empty", file=sys.stderr)
        return 1

    # Production's margin construction, walk-forward, on each era separately. Running the two eras
    # through run() independently is what keeps the confirm seasons out of the ratings the choose
    # seasons were fitted with.
    tr = cb.run(tr_games, args.lam, args.cap, args.from_week, args.decay, True, "fav")
    te = cb.run(te_games, args.lam, args.cap, args.from_week, args.decay, True, "fav")
    print(f"  choose  <= {args.split}: {len(tr):,} scored games")
    print(f"  confirm  > {args.split}: {len(te):,} scored games\n")

    # --- the one fitted parameter, from TRAIN only -----------------------------------------
    sd = statistics.pstdev([r["pred"] - r["actual"] for r in tr])
    print(f"sd of (ours - actual) on the CHOOSE seasons: {sd:.2f} points")
    print(f"  (for scale: NFL sits near 13.5, MLB's run-margin sd is 4.65)\n")

    # --- scored on HELD-OUT ----------------------------------------------------------------
    pw = [(ND.cdf(r["pred"] / sd), 1 if r["actual"] > 0 else 0) for r in te]
    bw, bw0, home_rate = brier(pw)
    gain = (bw0 - bw) / bw0 * 100
    decided = [r for r in te if abs(r["pred"]) >= 0.05]
    acc = statistics.mean(1 if (r["pred"] > 0) == (r["actual"] > 0) else 0 for r in decided)
    print(f"HELD OUT ({len(te):,} games)")
    print(f"  Phi(m / {sd:.2f})   Brier {bw:.4f}  vs {bw0:.4f} for the home base rate "
          f"({home_rate*100:.1f}%)  -> {gain:+.2f}%")
    print(f"  our favourite won {acc*100:.1f}% of {len(decided):,} games")

    # --- CALIBRATION, which is the part a Brier cannot tell you -----------------------------
    mp = statistics.mean(p for p, _ in pw)
    mr = statistics.mean(y for _, y in pw)
    print(f"  mean predicted {mp*100:.1f}%  vs mean realized {mr*100:.1f}%  "
          f"({(mp-mr)*100:+.1f}pt)")
    # Folded onto the favourite's side so every bucket is >= 50% and reads like the board does.
    fav = [(max(p, 1 - p), y if p >= 0.5 else 1 - y) for p, y in pw]
    print("\n  bucket        n     predicted   realized    gap")
    for lo, hi in ((0.50, 0.55), (0.55, 0.60), (0.60, 0.65), (0.65, 0.70),
                   (0.70, 0.80), (0.80, 0.90), (0.90, 1.01)):
        bb = [(p, y) for p, y in fav if lo <= p < hi]
        if len(bb) < 25:
            continue
        pp = statistics.mean(p for p, _ in bb)
        yy = statistics.mean(y for _, y in bb)
        print(f"  {lo:.2f}-{hi:.2f}  {len(bb):5,}    {pp*100:6.1f}%    {yy*100:6.1f}%   "
              f"{(pp-yy)*100:+5.1f}pt")

    # --- the verdict, stated rather than left to the reader ---------------------------------
    print()
    ok = gain > 0
    print(f"VERDICT: {'beats' if ok else 'does NOT beat'} the home base rate out of sample "
          f"({gain:+.2f}%).")
    if not ok:
        print("  Do not publish it. A probability that cannot beat 'the home team wins X% of the")
        print("  time' is not carrying information, and putting it on a card implies it is.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
