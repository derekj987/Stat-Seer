"""
Offensive line continuity -- does a settled front five beat the closing line?

ATTRIBUTE_CATALOG calls this "the highest-value untested roster item: widely believed, rarely
tested", and the data has been sitting in data/snaps_*.csv.gz the whole time.

MECHANISM, STATED IN ADVANCE as the standing discipline requires: five linemen who have played
together call protections, pass off stunts and time combo blocks better than five who have not.
If that is worth anything it should show up as the offence beating expectation -- and if the
market does not already price it, as the team beating the SPREAD.

🚨 THE METRIC MUST BE KNOWABLE BEFORE KICKOFF. The tempting definition -- "did the same five
start this week as last week" -- uses THIS game's starters, which nobody knows until the inactives
drop, and a feature built from them is hindsight dressed as a signal. What is knowable on Friday
is how settled the unit has been UP TO NOW, so continuity entering week w is the number of
consecutive prior games in which the team started an identical five. That is strictly backward
looking.

HOW IT IS SCORED, because "does it predict" and "does it beat the price" are different questions:
  * margin residual: actual home margin minus the closing spread. Does continuity move it?
  * ATS: does betting the side with the better-rested line clear 52.4% (-110 break-even)?
Both are reported, because a variable can be real and unprofitable -- which is the result most
of this project's candidates have produced.

CHOOSE on 2016-2022, CONFIRM on held-out 2023-2025. Never pooled: this repo has a documented case
of a pooled sample manufacturing a signal that vanished on a proper split.

    python analysis/ol_continuity.py
    python analysis/ol_continuity.py --placebo    # same test on shuffled continuity
"""
import argparse
import csv
import gzip
import math
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

OL_POS = {"T", "G", "C", "OL", "OT", "OG"}
TRAIN = range(2016, 2023)
TEST = range(2023, 2026)
VIG = 52.38   # -110 break-even


def ol_units(seasons):
    """(season, week, team) -> frozenset of the five OL who took the most offensive snaps.

    Top five by snaps rather than a 'starter' flag, because the feed has no starter column and a
    lineman who plays 62 of 62 snaps is the starter whatever the box score calls him."""
    units = {}
    for yr in seasons:
        path = f"data/snaps_{yr}.csv.gz"
        if not os.path.exists(path):
            continue
        per = defaultdict(list)
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r.get("game_type") not in (None, "", "REG"):
                    continue
                if (r.get("position") or "").upper() not in OL_POS:
                    continue
                try:
                    snaps = int(r.get("offense_snaps") or 0)
                    wk = int(r["week"])
                except ValueError:
                    continue
                if snaps <= 0:
                    continue
                per[(yr, wk, r["team"])].append((snaps, r["player"]))
        for k, v in per.items():
            v.sort(reverse=True)
            if len(v) >= 5:
                units[k] = frozenset(p for _s, p in v[:5])
    return units


def entering_streak(units, seasons):
    """(season, week, team) -> consecutive PRIOR games with an identical five.

    0 means the unit changed last week (or it is the team's first game of the season). Streaks do
    not cross seasons: a new year is a new line."""
    out = {}
    byteam = defaultdict(list)
    for (yr, wk, team) in units:
        byteam[(yr, team)].append(wk)
    for (yr, team), weeks in byteam.items():
        weeks.sort()
        streak = 0
        prev = None
        for wk in weeks:
            out[(yr, wk, team)] = streak          # BEFORE this game — no leakage
            cur = units[(yr, wk, team)]
            streak = streak + 1 if prev is not None and cur == prev else 0
            prev = cur
    return out


def games(seasons):
    """Closing spread + result per regular-season game, home perspective."""
    path = "data/games.csv"
    if not os.path.exists(path):
        print("data/games.csv missing — run analysis/fetch_data.py", file=sys.stderr)
        return []
    out = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                yr, wk = int(r["season"]), int(r["week"])
            except (ValueError, KeyError):
                continue
            if yr not in seasons or (r.get("game_type") or "REG") != "REG":
                continue
            try:
                hs, as_ = float(r["home_score"]), float(r["away_score"])
                spread = float(r["spread_line"])       # home perspective, + = home favoured
            except (ValueError, TypeError, KeyError):
                continue
            out.append({"season": yr, "week": wk, "home": r["home_team"], "away": r["away_team"],
                        "margin": hs - as_, "spread": spread})
    return out


def rows(seasons, units, streaks):
    out = []
    for g in games(seasons):
        h = streaks.get((g["season"], g["week"], g["home"]))
        a = streaks.get((g["season"], g["week"], g["away"]))
        if h is None or a is None:
            continue
        g["h_cont"], g["a_cont"] = h, a
        g["diff"] = h - a                      # + = home's line is the more settled
        g["resid"] = g["margin"] - g["spread"]  # + = home beat the number
        out.append(g)
    return out


def wilson(w, n):
    if not n:
        return (0.0, 0.0)
    p, z = w / n, 1.96
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (100 * (c - m), 100 * (c + m))


def report(label, rs):
    n = len(rs)
    if not n:
        print(f"  {label}: no rows"); return
    mean_resid = sum(r["resid"] for r in rs) / n
    print(f"\n  {label}  n={n}  mean margin residual {mean_resid:+.2f} "
          f"(home beat the number by this much on average — should be ~0)")

    # 1. Does continuity move the residual at all?
    print("    residual by continuity edge (home streak minus away streak):")
    buckets = [("away much steadier (<=-4)", lambda d: d <= -4),
               ("away steadier (-3..-1)", lambda d: -3 <= d <= -1),
               ("level (0)", lambda d: d == 0),
               ("home steadier (1..3)", lambda d: 1 <= d <= 3),
               ("home much steadier (>=4)", lambda d: d >= 4)]
    for name, f in buckets:
        sel = [r for r in rs if f(r["diff"])]
        if len(sel) < 25:
            print(f"      {name:<28} n={len(sel):>4}  (too few to read)"); continue
        mr = sum(r["resid"] for r in sel) / len(sel)
        cov = sum(1 for r in sel if r["resid"] > 0)
        lo, hi = wilson(cov, len(sel))
        print(f"      {name:<28} n={len(sel):>4}  residual {mr:+6.2f}   home covers "
              f"{100*cov/len(sel):5.1f}%  95% CI [{lo:.1f}, {hi:.1f}]")

    # 2. The bet: back the side with the steadier line, when there is a real difference.
    for edge in (1, 3, 5):
        sel = [r for r in rs if abs(r["diff"]) >= edge]
        if len(sel) < 50:
            continue
        w = sum(1 for r in sel if (r["resid"] > 0) == (r["diff"] > 0))
        push = sum(1 for r in sel if r["resid"] == 0)
        dec = len(sel) - push
        if not dec:
            continue
        lo, hi = wilson(w, dec)
        verdict = "BEATS the vig" if lo > VIG else "cannot rule out" if hi > VIG else "no edge"
        print(f"    back the steadier line, edge>={edge}: {w}-{dec-w} = {100*w/dec:5.2f}%  "
              f"95% CI [{lo:.1f}, {hi:.1f}]  vs {VIG}  -> {verdict}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--placebo", action="store_true",
                    help="shuffle the continuity values — any 'signal' that survives is the test lying")
    args = ap.parse_args(argv)

    allseasons = list(TRAIN) + list(TEST)
    units = ol_units(allseasons)
    if not units:
        print("no snap data found in data/ — run analysis/fetch_data.py", file=sys.stderr)
        return 1
    print(f"OL units built for {len(units)} team-games "
          f"({len({k[0] for k in units})} seasons)")
    streaks = entering_streak(units, allseasons)

    tr = rows(set(TRAIN), units, streaks)
    te = rows(set(TEST), units, streaks)
    if args.placebo:
        # Keep the marginal distribution, destroy the pairing. A test that still "finds" something
        # here is measuring its own construction, not football.
        rnd = random.Random(20261127)
        for rs in (tr, te):
            d = [r["diff"] for r in rs]
            rnd.shuffle(d)
            for r, v in zip(rs, d):
                r["diff"] = v
        print("\n*** PLACEBO: continuity values shuffled ***")

    report("TRAIN 2016-2022", tr)
    report("HELD OUT 2023-2025", te)
    print("\nA 95% interval straddling 52.38 means the sample cannot answer the question.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
