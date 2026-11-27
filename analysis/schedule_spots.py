"""
Schedule "spots" -- look-ahead, let-down, road trips, short weeks, opponent off a bye.

Four P1 rows in ATTRIBUTE_CATALOG, all derived from the same table, so they are tested together
in one pass with one control and one multiple-comparison correction. Testing them one at a time
and reporting the best is how you manufacture a finding.

🚨 EVERY DEFINITION IS KNOWABLE BEFORE KICKOFF, which rules out the obvious one. The natural way
to define a look-ahead spot is "next week's game has a tighter spread than this one" -- but next
week's closing spread does not exist at this week's kickoff, and a feature built from it is
leakage. Opponent strength here is the PRIOR SEASON's win percentage, fixed before a ball is
thrown, so the spots can be listed in August.

THE SPOTS
  look-ahead     next week's opponent was much better last season than this week's (>= .25 win%)
  let-down       last week's opponent was much better than this week's
  road trip      second or later consecutive away game
  long trip      third or later consecutive away game
  short week     this team on <= 4 days rest
  opp off bye    the opponent on >= 13 days rest

MULTIPLE COMPARISONS. Six spots, each bet both ways, is twelve tests. At p < .05 you expect
roughly one to look significant from nothing, so a single 53% on one split is not a finding --
which is why every line below is reported on BOTH splits against the same control, and why the
script prints how many of the twelve cleared the bar on each.

    python analysis/schedule_spots.py
    python analysis/schedule_spots.py --placebo
"""
import argparse
import csv
import math
import os
import random
import sys
from collections import defaultdict

TRAIN = set(range(2016, 2023))
TEST = set(range(2023, 2026))
VIG = 52.38


def wilson(w, n):
    if not n:
        return (0.0, 0.0)
    p, z = w / n, 1.96
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (100 * (c - m), 100 * (c + m))


def load_games():
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
            if (r.get("game_type") or "REG") != "REG":
                continue
            try:
                hs, as_ = float(r["home_score"]), float(r["away_score"])
            except (ValueError, TypeError, KeyError):
                continue
            spread = r.get("spread_line")
            out.append({
                "season": yr, "week": wk, "date": r.get("gameday") or "",
                "home": r["home_team"], "away": r["away_team"],
                "margin": hs - as_,
                "spread": float(spread) if spread not in (None, "", "NA") else None,
                "home_rest": _int(r.get("home_rest")), "away_rest": _int(r.get("away_rest")),
            })
    out.sort(key=lambda g: (g["season"], g["week"], g["date"]))
    return out


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def prior_winpct(games):
    """(season, team) -> win% in the PREVIOUS season. Fixed before the season starts, so a spot
    built on it could have been listed in August — no leakage."""
    rec = defaultdict(lambda: [0, 0])
    for g in games:
        if g["margin"] > 0:
            rec[(g["season"], g["home"])][0] += 1
            rec[(g["season"], g["away"])][1] += 1
        elif g["margin"] < 0:
            rec[(g["season"], g["away"])][0] += 1
            rec[(g["season"], g["home"])][1] += 1
    out = {}
    for (yr, team), (w, l) in rec.items():
        if w + l:
            out[(yr + 1, team)] = w / (w + l)
    return out


def team_schedule(games):
    """team-season -> ordered list of (index, game, is_home)."""
    sched = defaultdict(list)
    for g in games:
        sched[(g["season"], g["home"])].append((g, True))
        sched[(g["season"], g["away"])].append((g, False))
    return sched


def build(games):
    """One row per TEAM-GAME with every spot flag, plus whether that team covered."""
    pw = prior_winpct(games)
    sched = team_schedule(games)
    rows = []
    for (yr, team), seq in sched.items():
        road_run = 0
        for i, (g, is_home) in enumerate(seq):
            if g["spread"] is None:
                road_run = road_run + 1 if not is_home else 0
                continue
            opp = g["away"] if is_home else g["home"]
            # team's own margin against its own spread
            team_margin = g["margin"] if is_home else -g["margin"]
            team_spread = g["spread"] if is_home else -g["spread"]
            covered = team_margin > team_spread
            if team_margin == team_spread:
                road_run = road_run + 1 if not is_home else 0
                continue

            this_opp = pw.get((yr, opp))
            nxt = seq[i + 1][0] if i + 1 < len(seq) else None
            prv = seq[i - 1][0] if i > 0 else None

            def opp_of(gg):
                if gg is None:
                    return None
                o = gg["away"] if gg["home"] == team else gg["home"]
                return pw.get((yr, o))

            nxt_opp, prv_opp = opp_of(nxt), opp_of(prv)
            rest = g["home_rest"] if is_home else g["away_rest"]
            opp_rest = g["away_rest"] if is_home else g["home_rest"]
            road_run = road_run + 1 if not is_home else 0

            rows.append({
                "season": yr, "team": team, "covered": covered,
                "look_ahead": (this_opp is not None and nxt_opp is not None
                               and nxt_opp - this_opp >= 0.25),
                "let_down": (this_opp is not None and prv_opp is not None
                             and prv_opp - this_opp >= 0.25),
                "road_trip": road_run >= 2,
                "long_trip": road_run >= 3,
                "short_week": rest is not None and rest <= 4,
                "opp_off_bye": opp_rest is not None and opp_rest >= 13,
            })
    return rows


SPOTS = ["look_ahead", "let_down", "road_trip", "long_trip", "short_week", "opp_off_bye"]


def report(name, rows):
    print(f"\n  {name}  n={len(rows)} team-games")
    base_w = sum(1 for r in rows if r["covered"])
    print(f"    control: every team-game covers {100*base_w/len(rows):.2f}% "
          f"(must be ~50 — each game contributes both sides)")
    cleared = 0
    for s in SPOTS:
        sel = [r for r in rows if r[s]]
        if len(sel) < 60:
            print(f"      {s:<13} n={len(sel):>4}  (too few to read)")
            continue
        w = sum(1 for r in sel if r["covered"])
        lo, hi = wilson(w, len(sel))
        back = 100 * w / len(sel)
        # Report the BETTER of the two directions, and say which, then judge that one.
        side, pct, l, h = ("back", back, lo, hi) if back >= 50 else ("fade", 100 - back, 100 - hi, 100 - lo)
        mark = ""
        if l > VIG:
            mark = "  <= CLEARS"
            cleared += 1
        print(f"      {s:<13} n={len(sel):>4}  {side} it: {pct:5.2f}%  CI [{l:.1f}, {h:.1f}]{mark}")
    print(f"    {cleared} of {len(SPOTS)} spots clear {VIG}% on this split "
          f"(expect ~0.3 from noise at 12 two-sided tests)")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--placebo", action="store_true", help="shuffle the spot flags")
    args = ap.parse_args(argv)

    games = [g for g in load_games() if g["season"] in TRAIN or g["season"] in TEST]
    if not games:
        return 1
    rows = build(games)
    print(f"  {len(games)} games -> {len(rows)} team-games with a spread")

    if args.placebo:
        rnd = random.Random(20261127)
        flags = [[r[s] for s in SPOTS] for r in rows]
        rnd.shuffle(flags)
        for r, fl in zip(rows, flags):
            for s, v in zip(SPOTS, fl):
                r[s] = v
        print("\n*** PLACEBO: spot flags shuffled ***")

    report("TRAIN 2016-2022", [r for r in rows if r["season"] in TRAIN])
    report("HELD OUT 2023-2025", [r for r in rows if r["season"] in TEST])
    print(f"\nA spot is only interesting if it clears {VIG}% on BOTH splits in the SAME direction.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
