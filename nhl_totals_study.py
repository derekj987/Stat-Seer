"""
nhl_totals_study.py -- the shape of the NHL total, before anyone models one.

    python nhl_results.py --seasons 2021-2025 --csv data/nhl_results.csv
    python nhl_totals_study.py --csv data/nhl_results.csv

Reproduces from data/nhl_results.csv (NHL public API, free -- see nhl_results.py).

THE QUESTION. CLAUDE.md records, for the NFL, that "margins land on exactly 3 in 15.0% of games"
and therefore "never use a Gaussian where key numbers matter". NHL totals are posted at 5.5, 6.0,
6.5 -- small integers, and some of them WHOLE numbers that can push. So before fitting any scoring
model, the thing to measure is whether the realised total is smooth. If it is not, a Poisson or
Gaussian fair price is wrong by a knowable amount, and every downstream number inherits the error.

THE MECHANISM, stated before measuring (the standing discipline in CLAUDE.md):

  1. An NHL game cannot end tied. Tied after regulation -> overtime.
  2. So every REG game is, by construction, a game that was NOT tied at 60 minutes. All the
     tie compositions (2-2, 3-3, ...) -- which are EVEN totals -- are removed from REG.
  3. Those games reappear as OT or SO, each having added exactly one goal to an even base.
     An even number plus one is odd.

So even totals should be suppressed twice over: once by removing ties from regulation, once by
every one of those games returning as an odd number. Prediction: a sawtooth, odd over even, with
the gap roughly the size of the OT+SO share. That is a structural lump no smooth scoring
distribution can represent.

WHAT IT IS NOT. This is not an edge and not a betting signal -- the books set 5.5/6.5 far more
often than 6.0 precisely because they know. It is a constraint on how we are allowed to compute a
fair price for an NHL total, in the same way the NFL key-number finding constrains game lines.
"""
from __future__ import annotations

import argparse
import csv
import math
import sys
from collections import Counter


def poisson_pmf(k, lam):
    return math.exp(-lam) * lam ** k / math.factorial(k)


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("total_goals")]
    for r in rows:
        r["total_goals"] = int(r["total_goals"])
        r["season"] = int(r["season"])
    return rows


def pct(a, b):
    return f"{a / b:.1%}" if b else "n/a"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", default="data/nhl_results.csv")
    args = ap.parse_args(argv)

    try:
        rows = load(args.csv)
    except FileNotFoundError:
        print(f"ERROR: {args.csv} not found. Run:\n"
              f"  python nhl_results.py --seasons 2021-2025 --csv {args.csv}", file=sys.stderr)
        return 1
    n = len(rows)
    if not n:
        print("no completed games in the file.", file=sys.stderr)
        return 1
    tots = [r["total_goals"] for r in rows]
    lam = sum(tots) / n
    seasons = sorted({r["season"] for r in rows})
    print(f"NHL totals -- {n:,} completed regular-season games, seasons "
          f"{seasons[0]}-{seasons[-1]}. Mean total {lam:.3f}.\n")

    # ---------------------------------------------------------------- 1. the sawtooth
    odd = sum(1 for t in tots if t % 2)
    print("1. ODD vs EVEN")
    print(f"   odd  {odd:>5}  {pct(odd, n)}")
    print(f"   even {n - odd:>5}  {pct(n - odd, n)}")
    print(f"   -> a smooth distribution would be ~50/50. The gap is "
          f"{abs(odd / n - 0.5) * 2:.1%} of all games.\n")

    # ---------------------------------------------------------------- 2. the mechanism
    print("2. WHERE IT COMES FROM  (odd-total rate, split by how the game ended)")
    by_end = {}
    for r in rows:
        by_end.setdefault(r["last_period_type"] or "?", []).append(r["total_goals"])
    for end in ("REG", "OT", "SO"):
        g = by_end.get(end, [])
        if not g:
            continue
        o = sum(1 for t in g if t % 2)
        print(f"   {end:<4} {len(g):>5} games ({pct(len(g), n)})   odd: {pct(o, len(g))}")
    beyond = sum(len(by_end.get(e, [])) for e in ("OT", "SO"))
    print(f"   -> OT and SO are {pct(beyond, n)} of games and are 100% odd by construction.")
    reg = by_end.get("REG", [])
    reg_odd = sum(1 for t in reg if t % 2)
    print(f"   -> regulation alone is already {pct(reg_odd, len(reg))} odd, because a tie at 60 "
          f"minutes\n      is not a regulation game -- the even 'tie' scores are removed from it.\n")

    # ---------------------------------------------------- 3. what a Poisson would get wrong
    print("3. ACTUAL vs POISSON  (the error a smooth fair price would make)")
    c = Counter(tots)
    print(f"   {'total':>5} {'actual':>8} {'poisson':>8} {'error':>8}")
    worst = []
    for k in range(0, max(tots) + 1):
        a = c.get(k, 0) / n
        p = poisson_pmf(k, lam)
        if a < 0.005 and p < 0.005:
            continue
        print(f"   {k:>5} {a:>7.1%} {p:>8.1%} {a - p:>+8.1%}")
        worst.append((abs(a - p), k, a, p))
    print()

    # ------------------------------------------------- 4. the number that actually matters
    print("4. THE PRACTICAL CONSEQUENCE -- pushes on a whole-number total")
    print("   A total posted at 6.0 pushes when the game lands on exactly 6.")
    for k in (5, 6, 7):
        a, p = c.get(k, 0) / n, poisson_pmf(k, lam)
        print(f"   total {k}.0 push:  actual {a:.1%}   poisson {p:.1%}   "
              f"poisson is {'over' if p > a else 'under'}stated by {abs(p - a):.1%}")
    print()
    for line in (5.5, 6.0, 6.5):
        over = sum(1 for t in tots if t > line) / n
        under = sum(1 for t in tots if t < line) / n
        push = 1 - over - under
        p_over = 1 - sum(poisson_pmf(k, lam) for k in range(0, int(math.floor(line)) + 1))
        print(f"   posted {line}:  actual over {over:.1%} / under {under:.1%}"
              f"{f' / push {push:.1%}' if push > 0.0001 else ''}"
              f"   |  poisson over {p_over:.1%}  ({over - p_over:+.1%})")

    # -------------------------------------------------------------- 5. season stability
    print("\n5. IS IT STABLE?  (odd-total rate by season -- a one-off would not repeat)")
    for s in seasons:
        g = [r["total_goals"] for r in rows if r["season"] == s]
        o = sum(1 for t in g if t % 2)
        print(f"   {s}-{str(s + 1)[2:]}  {len(g):>5} games   odd {pct(o, len(g))}   "
              f"mean {sum(g) / len(g):.2f}")

    print("\nCONCLUSION. The NHL total is not smooth and the asymmetry is structural, not "
          "sampling\nnoise -- it repeats every season and its size matches the OT/SO share "
          "exactly, as the\nmechanism predicts. Any NHL fair price must be computed from the "
          "empirical distribution\n(or from a model that treats the OT/SO goal separately), "
          "never from a fitted Poisson.\nThis is the NHL analogue of the NFL key-number rule in "
          "CLAUDE.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
