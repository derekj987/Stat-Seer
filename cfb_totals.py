"""
cfb_totals.py -- the missing test: does the CFB TOTALS model beat the closing over/under?

The card ships an OVER/UNDER lean (cfb_export.team_scoring: projTotal = 2*L + off[home]
+ def[away] + off[away] + def[home], each team's regressed scored/allowed deviation from
the league mean, shrunk n/(n+4) and damped 0.6). But nothing ever tested it out of sample.
This walk-forward does: for each week w, fit the scoring model on that season's games with
week < w (carried from the prior season by `decay`), project each game's total, and grade it
against the CLOSING total. We report MAE/RMSE of the projection and the O/U ATS record by
lean-size threshold. Same discipline as cfb_ats.py: a lean is only an edge if it clears the
-110 break-even (52.38%) out of sample; anything short is context, not a pick.

    python cfb_totals.py                 # 2020-2025, decay 0.6, from week 6
    python cfb_totals.py --end 2024 --decay 0.7

Line convention: `over_under` is the closing total; actual = home_points + away_points.
Over covers iff actual > total. Stdlib + numpy.
"""
import argparse
import sqlite3
import sys

import numpy as np

BREAKEVEN = 100.0 / 1.9090909  # -110 -> 52.38%
THRESHOLDS = [0.0, 1.0, 2.0, 3.0, 4.0, 6.0, 8.0]


def load(db, start, end):
    conn = sqlite3.connect(db)
    rows = conn.execute(
        """SELECT g.season, g.week, g.home_team, g.away_team, g.home_points, g.away_points,
                  (SELECT over_under FROM lines l WHERE l.game_id=g.id
                     AND l.provider='consensus' AND l.over_under IS NOT NULL) AS cons,
                  (SELECT AVG(over_under) FROM lines l WHERE l.game_id=g.id
                     AND l.over_under IS NOT NULL) AS avgt
             FROM games g
             WHERE g.season BETWEEN ? AND ? AND g.home_class='fbs' AND g.away_class='fbs'
               AND g.home_points IS NOT NULL
             ORDER BY g.season, g.week""", (start, end)).fetchall()
    conn.close()
    out = []
    for s, w, h, a, hp, ap, cons, avgt in rows:
        total = cons if cons is not None else avgt
        if total is None:
            continue
        out.append({"season": s, "week": w or 0, "home": h, "away": a,
                    "actual": hp + ap, "total": float(total)})
    return out


def team_scoring(games, decay, prior_off, prior_deff):
    """League mean L + each team's regressed off/def point deviation, seeded from the prior
    season for teams with little current-season data (shrink blends current into prior)."""
    scored, allowed = {}, {}
    for g in games:
        scored.setdefault(g["home"], []).append(g["hp"]); allowed.setdefault(g["home"], []).append(g["ap"])
        scored.setdefault(g["away"], []).append(g["ap"]); allowed.setdefault(g["away"], []).append(g["hp"])
    allpts = [p for v in scored.values() for p in v]
    L = sum(allpts) / len(allpts) if allpts else 27.0
    off, deff = {}, {}
    for t in set(scored) | set(prior_off) | set(prior_deff):
        if t in scored:
            n = len(scored[t]); shrink = n / (n + 4)
            cur_off = sum(scored[t]) / n - L
            cur_def = sum(allowed[t]) / n - L
        else:
            shrink, cur_off, cur_def = 0.0, 0.0, 0.0
        off[t] = decay * (shrink * cur_off + (1 - shrink) * prior_off.get(t, 0.0))
        deff[t] = decay * (shrink * cur_def + (1 - shrink) * prior_deff.get(t, 0.0))
    return L, off, deff


def backtest(games, decay, from_week):
    seasons = sorted({g["season"] for g in games})
    tally = {t: [0, 0, 0] for t in THRESHOLDS}  # wins, losses, pushes (over-lean basis)
    errs = []
    prior_off, prior_deff = {}, {}
    for s in seasons:
        weeks = sorted({g["week"] for g in games if g["season"] == s and g["week"] >= from_week})
        for w in weeks:
            train = [_split(g) for g in games if g["season"] == s and g["week"] < w]
            if len(train) < 40:
                continue
            L, off, deff = team_scoring(train, decay, prior_off, prior_deff)
            for g in [x for x in games if x["season"] == s and x["week"] == w]:
                proj = 2 * L + off.get(g["home"], 0.0) + deff.get(g["away"], 0.0) \
                    + off.get(g["away"], 0.0) + deff.get(g["home"], 0.0)
                lean = proj - g["total"]                 # + => model leans OVER
                cover = g["actual"] - g["total"]          # + => over hit
                errs.append(proj - g["actual"])
                for t in THRESHOLDS:
                    if abs(lean) < t:
                        continue
                    if cover == 0:
                        tally[t][2] += 1
                    elif np.sign(lean) == np.sign(cover):
                        tally[t][0] += 1
                    else:
                        tally[t][1] += 1
        full = [_split(g) for g in games if g["season"] == s]
        L, foff, fdeff = team_scoring(full, 1.0, {}, {})
        prior_off = {k: v for k, v in foff.items()}
        prior_deff = {k: v for k, v in fdeff.items()}
    return tally, np.array(errs)


# Split a loaded game (which stores combined actual) back into home/away points isn't
# possible from `actual` alone — so we carry the split from a side table built at load.
_SPLIT = {}


def _split(g):
    return _SPLIT[(g["season"], g["home"], g["away"], g["week"])]


def load_split(db, start, end):
    """Second read that keeps home/away points separately, keyed for the scoring fit."""
    conn = sqlite3.connect(db)
    rows = conn.execute(
        """SELECT season, week, home_team, away_team, home_points, away_points FROM games
             WHERE season BETWEEN ? AND ? AND home_class='fbs' AND away_class='fbs'
               AND home_points IS NOT NULL""", (start, end)).fetchall()
    conn.close()
    for s, w, h, a, hp, ap in rows:
        _SPLIT[(s, h, a, w or 0)] = {"home": h, "away": a, "hp": hp, "ap": ap, "week": w or 0, "season": s}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="data/cfb.db")
    ap.add_argument("--start", type=int, default=2020)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--from-week", type=int, default=6)
    ap.add_argument("--decay", type=float, default=0.6)
    args = ap.parse_args(argv)

    load_split(args.db, args.start, args.end)
    games = load(args.db, args.start, args.end)
    if not games:
        print("No games with a closing total -- run cfb_lines.py (with over/under) first.", file=sys.stderr)
        return 1
    print(f"{len(games)} games with a closing total, {args.start}-{args.end}. "
          f"decay={args.decay:g}, from week {args.from_week}. Break-even (-110) = {BREAKEVEN:.2f}%.\n")

    tally, errs = backtest(games, args.decay, args.from_week)
    print(f"Projection accuracy vs actual total: MAE {np.mean(np.abs(errs)):.2f}, RMSE {np.sqrt(np.mean(errs**2)):.2f} "
          f"(n={len(errs)})\n")
    print(f"{'lean >=':>8} | {'bets':>5} {'W':>5} {'L':>4} {'P':>3} | {'O/U %':>6} | {'ROI@-110':>8} | {'vs break-even':>13}")
    print("-" * 74)
    for t in THRESHOLDS:
        w, l, p = tally[t]
        dec = w + l
        if dec == 0:
            print(f"{t:8.1f} | {'0':>5}"); continue
        ats = 100.0 * w / dec
        roi = 100.0 * (w * (100.0 / 110.0) - l) / dec
        mark = "  <-- clears break-even" if ats > BREAKEVEN else ""
        print(f"{t:8.1f} | {w + l + p:5d} {w:5d} {l:4d} {p:3d} | {ats:6.2f} | {roi:+7.2f}% | {ats - BREAKEVEN:+6.2f} pts{mark}")
    print("\nReading: same bar as the spread — O/U% must clear 52.38% on a meaningful sample "
          "to be an edge. If it doesn't, the totals lean is context, not a pick, and should be "
          "presented that way.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
