"""
cfb_ats.py -- the only test that matters: does the CFB power rating beat the CLOSING
SPREAD against the number, out of sample?

Same walk-forward rating as cfb_power.py (fit on weeks < w, predict week w, seed each
season with last year's regressed rating). For every test game with a closing line we
compute the model's edge vs the market and, when the edge clears a threshold, "bet"
that side against the spread. We report the ATS record by edge threshold against the
break-even a -110 bettor must clear: 52.38%.

Discipline (from the project): a rating is only an edge if it beats the closing line
out of sample. Matching Elo (cfb_power.py) is not that. This is.

    python cfb_ats.py                 # 2020-2024, lambda 5, cap 28
    python cfb_ats.py --lam 3 --decay 0.7

Line convention (CFBD): `spread` is the HOME number, negative = home favored, so the
market expects home to win by (-spread). Home covers iff (actual_margin + spread) > 0.
Uses the 'consensus' provider when present, else the average across books.
Stdlib + numpy; reuses cfb_power.fit_ratings.
"""
import argparse
import sqlite3
import sys

import numpy as np

from cfb_power import fit_ratings

BREAKEVEN = 52.38  # -110 vig
THRESHOLDS = [0.0, 0.5, 1.0, 2.0, 3.0, 4.0, 6.0, 8.0]


def load(db, start, end):
    conn = sqlite3.connect(db)
    rows = conn.execute(
        """SELECT g.id, g.season, g.week, g.home_team, g.away_team,
                  g.home_points, g.away_points, g.neutral_site,
                  (SELECT spread FROM lines l WHERE l.game_id=g.id
                     AND l.provider='consensus' AND l.spread IS NOT NULL) AS cons,
                  (SELECT AVG(spread) FROM lines l WHERE l.game_id=g.id
                     AND l.spread IS NOT NULL) AS avgs
             FROM games g
            WHERE g.home_class='fbs' AND g.away_class='fbs'
              AND g.home_points IS NOT NULL AND g.away_points IS NOT NULL
              AND g.season BETWEEN ? AND ?
            ORDER BY g.season, g.week""", (start, end)).fetchall()
    conn.close()
    games = []
    for gid, s, w, h, a, hp, ap, neu, cons, avgs in rows:
        spread = cons if cons is not None else avgs
        if spread is None:
            continue
        games.append({
            "season": s, "week": w or 0, "home": h, "away": a,
            "margin": hp - ap, "neutral": 1 if neu else 0, "spread": float(spread),
        })
    return games


def backtest(games, lam, cap, from_week, decay):
    """Walk-forward. For each test game, edge = pred_margin + spread (home basis);
    bet home if edge>0 else away; win iff sign(edge)==sign(actual_margin+spread)."""
    seasons = sorted({g["season"] for g in games})
    # per-threshold tallies: wins, losses, pushes
    tally = {t: [0, 0, 0] for t in THRESHOLDS}
    prior = {}
    for s in seasons:
        sg = [g for g in games if g["season"] == s]
        weeks = sorted({g["week"] for g in sg if g["week"] >= from_week})
        for w in weeks:
            train = [g for g in sg if g["week"] < w]
            test = [g for g in sg if g["week"] == w]
            if len(train) < 50:
                continue
            ratings, hfa = fit_ratings(train, lam, cap, prior)
            for g in test:
                if g["home"] not in ratings or g["away"] not in ratings:
                    continue
                home_adj = 0.0 if g["neutral"] else 1.0
                pred = ratings[g["home"]] - ratings[g["away"]] + hfa * home_adj
                edge = pred + g["spread"]            # model vs market, home basis
                cover = g["margin"] + g["spread"]    # >0 home covers, ==0 push
                for t in THRESHOLDS:
                    if abs(edge) < t:
                        continue
                    if cover == 0:
                        tally[t][2] += 1
                    elif np.sign(edge) == np.sign(cover):
                        tally[t][0] += 1
                    else:
                        tally[t][1] += 1
        final, _ = fit_ratings(sg, lam, cap, prior)
        prior = {t: decay * r for t, r in final.items()}
    return tally


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="data/cfb.db")
    ap.add_argument("--start", type=int, default=2020)
    ap.add_argument("--end", type=int, default=2024)
    ap.add_argument("--cap", type=int, default=28)
    ap.add_argument("--lam", type=float, default=5.0)
    ap.add_argument("--from-week", type=int, default=6)
    ap.add_argument("--decay", type=float, default=0.6)
    args = ap.parse_args(argv)

    games = load(args.db, args.start, args.end)
    if not games:
        print("No lined games -- run cfb_backfill.py then cfb_lines.py first.", file=sys.stderr)
        return 1
    print(f"{len(games)} lined FBS-vs-FBS games, {args.start}-{args.end}. "
          f"lambda={args.lam:g}, cap={args.cap}, decay={args.decay:g}, "
          f"from week {args.from_week}. Break-even (-110) = {BREAKEVEN:.2f}%.\n")

    tally = backtest(games, args.lam, args.cap, args.from_week, args.decay)
    print(f"{'edge >=':>8} | {'bets':>5} {'W':>5} {'L':>4} {'P':>3} | "
          f"{'ATS%':>6} | {'ROI@-110':>8} | {'vs break-even':>13}")
    print("-" * 74)
    for t in THRESHOLDS:
        w, l, p = tally[t]
        dec = w + l
        if dec == 0:
            print(f"{t:8.1f} | {'0':>5}")
            continue
        ats = 100.0 * w / dec
        roi = 100.0 * (w * (100.0 / 110.0) - l) / dec
        edge = ats - BREAKEVEN
        mark = "  <-- profitable" if ats > BREAKEVEN else ""
        print(f"{t:8.1f} | {w + l + p:5d} {w:5d} {l:4d} {p:3d} | {ats:6.2f} | "
              f"{roi:+7.2f}% | {edge:+6.2f} pts{mark}")
    print("\nReading: ATS% must clear 52.38% for enough bets to matter. A couple of "
          "points over on a thin slice is likely noise; a durable, sizeable edge would "
          "be the finding. Expect the market to be hard to beat -- that is itself the result.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
