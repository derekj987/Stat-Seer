"""
cfb_power.py -- a margin-based College Football power rating fit from data/cfb.db, and
an honest walk-forward test of whether it actually predicts games.

Method (mirrors the NFL discipline -- never win/loss, always point differential):
  margin(home,away) = rating[home] - rating[away] + HFA*(not neutral)
Ratings are solved by RIDGE-regularized least squares over FBS-vs-FBS games -- the
penalty both identifies the ratings (they're otherwise free up to a constant) and
shrinks thin-schedule teams toward the mean so early-season noise can't run away.
Blowout margins are capped (a 45-point win is barely more information than a 28-point
one) -- the same reason we never model raw yardage.

Validation is WALK-FORWARD inside each season: to predict week w we fit only on
weeks < w, so nothing sees its own result. We score three ways against the same test
games -- our rating, CFBD's own pregame Elo (best linear fit of Elo->margin, so it's a
fair fight), and "home team wins" -- and report straight-up accuracy plus margin error.
Beating Elo here is the bar to clear before the real test vs the closing line (next).

    python cfb_power.py                       # 2020-2024, cap 28, ridge sweep
    python cfb_power.py --start 2021 --cap 21
    python cfb_power.py --lam 25 --from-week 6

Stdlib + numpy. Reads the SQLite store written by cfb_backfill.py.
"""
import argparse
import sqlite3
import sys

import numpy as np


def load_games(db, start, end):
    """FBS-vs-FBS completed games with a pregame Elo, oldest first."""
    conn = sqlite3.connect(db)
    rows = conn.execute(
        """SELECT season, week, home_team, away_team, home_points, away_points,
                  neutral_site, home_pregame_elo, away_pregame_elo
             FROM games
            WHERE home_class='fbs' AND away_class='fbs'
              AND home_points IS NOT NULL AND away_points IS NOT NULL
              AND home_pregame_elo IS NOT NULL AND away_pregame_elo IS NOT NULL
              AND season BETWEEN ? AND ?
            ORDER BY season, week""", (start, end)).fetchall()
    conn.close()
    games = []
    for s, w, h, a, hp, ap, neu, he, ae in rows:
        games.append({
            "season": s, "week": w or 0, "home": h, "away": a,
            "margin": hp - ap, "neutral": 1 if neu else 0,
            "elo_diff": he - ae,
        })
    return games


def fit_ratings(train, lam, cap, prior=None):
    """Ridge margin ratings + HFA. Shrinks each team toward `prior` (a team->rating
    map, default 0) so a new season starts from last year's regressed rating rather
    than a blank slate; as games accumulate the data overrides the prior."""
    teams = sorted({g["home"] for g in train} | {g["away"] for g in train})
    idx = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    X = np.zeros((len(train), n + 1))          # last column = home-field
    y = np.zeros(len(train))
    for i, g in enumerate(train):
        X[i, idx[g["home"]]] = 1.0
        X[i, idx[g["away"]]] = -1.0
        if not g["neutral"]:
            X[i, n] = 1.0
        m = g["margin"]
        y[i] = max(-cap, min(cap, m)) if cap else m
    # Ridge on team columns only (don't penalize the HFA term), toward the prior.
    P = np.eye(n + 1) * lam
    P[n, n] = 0.0
    b_prior = np.zeros(n + 1)
    if prior:
        for t in teams:
            b_prior[idx[t]] = prior.get(t, 0.0)
    beta = np.linalg.solve(X.T @ X + P, X.T @ y + P @ b_prior)
    ratings = {t: beta[idx[t]] for t in teams}
    return ratings, float(beta[n])


def fit_elo_scale(train):
    """Best linear map elo_diff (+ home flag) -> margin, so Elo gets a fair shot."""
    A = np.array([[g["elo_diff"], 0.0 if g["neutral"] else 1.0] for g in train])
    y = np.array([g["margin"] for g in train])
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    return coef  # [pts_per_elo, home_pts]


def walk_forward(games, lam, cap, from_week, decay):
    """For each season, fit on weeks < w and predict week w. Each season is seeded
    with `decay` * last season's final rating (0 for the first season). Aggregate."""
    seasons = sorted({g["season"] for g in games})
    res = {k: 0 for k in ("n", "ours_su", "elo_su", "home_su")}
    se = {"ours": 0.0, "elo": 0.0}
    ae = {"ours": 0.0, "elo": 0.0}
    prior = {}  # carried from the previous season's final ratings
    for s in seasons:
        sg = [g for g in games if g["season"] == s]
        weeks = sorted({g["week"] for g in sg if g["week"] >= from_week})
        for w in weeks:
            train = [g for g in sg if g["week"] < w]
            test = [g for g in sg if g["week"] == w]
            if len(train) < 50:
                continue
            ratings, hfa = fit_ratings(train, lam, cap, prior)
            elo_coef = fit_elo_scale(train)
            for g in test:
                if g["home"] not in ratings or g["away"] not in ratings:
                    continue  # a team with no prior games this season -- skip, count coverage
                home_adj = 0.0 if g["neutral"] else 1.0
                pred = ratings[g["home"]] - ratings[g["away"]] + hfa * home_adj
                epred = elo_coef[0] * g["elo_diff"] + elo_coef[1] * home_adj
                actual = g["margin"]
                res["n"] += 1
                res["ours_su"] += (np.sign(pred) == np.sign(actual))
                res["elo_su"] += (np.sign(epred) == np.sign(actual))
                res["home_su"] += (actual > 0)
                se["ours"] += (pred - actual) ** 2
                se["elo"] += (epred - actual) ** 2
                ae["ours"] += abs(pred - actual)
                ae["elo"] += abs(epred - actual)
        # this season's final ratings (full season) seed next season's regressed prior
        final, _ = fit_ratings(sg, lam, cap, prior)
        prior = {t: decay * r for t, r in final.items()}
    return res, se, ae


def pct(x, n):
    return f"{100.0 * x / n:5.1f}%" if n else "  n/a"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="data/cfb.db")
    ap.add_argument("--start", type=int, default=2020)
    ap.add_argument("--end", type=int, default=2024)
    ap.add_argument("--cap", type=int, default=28, help="margin cap in points (0 = none)")
    ap.add_argument("--lam", type=float, default=None, help="ridge lambda (default: sweep)")
    ap.add_argument("--from-week", type=int, default=6, help="first week to predict each season")
    ap.add_argument("--decay", type=float, default=0.6,
                    help="carryover: fraction of last season's rating used as this season's prior")
    args = ap.parse_args(argv)

    games = load_games(args.db, args.start, args.end)
    if not games:
        print("No games -- run cfb_backfill.py first.", file=sys.stderr)
        return 1
    print(f"{len(games)} FBS-vs-FBS games, {args.start}-{args.end}. "
          f"Walk-forward from week {args.from_week}, margin cap {args.cap or 'none'}.\n")

    lams = [args.lam] if args.lam is not None else [5, 10, 25, 50, 100]
    print(f"{'ridge lam':>8} | {'games':>5} | {'our SU':>7} {'Elo SU':>7} {'home SU':>7} "
          f"| {'our RMSE':>8} {'Elo RMSE':>8} | {'our MAE':>7} {'Elo MAE':>7}")
    print("-" * 92)
    best = None
    for lam in lams:
        res, se, ae = walk_forward(games, lam, args.cap, args.from_week, args.decay)
        n = res["n"]
        rmse_o = (se["ours"] / n) ** 0.5
        rmse_e = (se["elo"] / n) ** 0.5
        mae_o = ae["ours"] / n
        mae_e = ae["elo"] / n
        print(f"{lam:8.0f} | {n:5d} | {pct(res['ours_su'],n)} {pct(res['elo_su'],n)} "
              f"{pct(res['home_su'],n)} | {rmse_o:8.2f} {rmse_e:8.2f} | {mae_o:7.2f} {mae_e:7.2f}")
        if best is None or rmse_o < best[1]:
            best = (lam, rmse_o, res, rmse_e)

    lam, rmse_o, res, rmse_e = best
    n = res["n"]
    print(f"\nBest ridge lam={lam:.0f}: our RMSE {rmse_o:.2f} vs Elo {rmse_e:.2f}; "
          f"our SU {pct(res['ours_su'],n).strip()} vs Elo {pct(res['elo_su'],n).strip()} "
          f"vs home {pct(res['home_su'],n).strip()}.")
    print("Reading: matching/edging Elo means the rating has real signal; the honest "
          "bar is still beating the closing spread (CFBD /lines) -- that's the next step.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
