"""
totals_inseason.py -- does the NFL totals model get better if it reads THIS season?

    python analysis/totals_inseason.py                 # sweep on train, score held-out
    python analysis/totals_inseason.py --final 0.8 1.0 # score one setting on held-out only

WHY THIS EXISTS. The published totals model (analysis/gen_model_totals.py) is a fixed function of
the PRIOR season: `pred = Lt + K * (mean(tend[home], tend[away]) - Lt)` with K = 0.50, computed once
for the whole schedule. Graded over 2026 weeks 1-5 it went 29-50 against the closing line, losing in
every week, and the decomposition says why:

    our total   mean 46.06   bias vs actual -0.57   MAE 11.73   sd 1.62
    market      mean 44.92   bias vs actual -1.72   MAE 10.69   sd 4.05
    actual      mean 46.63                                      sd 14.60

OUR LEVEL IS THE GOOD HALF -- three times closer to real scoring than the market's. What fails is
the SHAPE: an sd of 1.6 is a near-constant, so "ours vs the market" is really "the market's own line,
inverted", and the market's line is informative (corr 0.48 with the outcome against our 0.25). Hence
corr(ours - market, actual - market) = -0.222: a reliable contrarian machine.

Two candidate causes, and the sweep below separates them:

  1. THE MODEL IGNORES THE CURRENT SEASON. The margin model was given an in-season blend months ago
     (PRIOR_K / REGRESS in game_model.py); the totals model never was. A team that has started
     scoring 31 a game is still priced off last year.
  2. K = 0.50 WAS CHOSEN TO MINIMISE MAE, and that is exactly the setting that produces a constant.
     When a predictor carries little signal, shrinking it toward the mean is the MAE-optimal thing
     to do -- which is correct as an estimator and useless as a per-game call. So MAE alone cannot
     choose this knob; the O/U record is reported beside it and never optimised on.

TRAIN / HELD-OUT, because pooling manufactures signal (the depth-chart-movement lesson). Settings
are chosen on TRAIN only and reported once on HELD-OUT.
"""
from __future__ import annotations

import argparse
import os
import statistics as st

import numpy as np
import pandas as pd

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMES = os.path.join(_ROOT, "data", "games.csv")

TRAIN = [2018, 2019, 2020, 2021, 2022]
HOLD = [2023, 2024, 2025]
MIN_PRIOR_GAMES = 4          # a team with fewer prior-season games falls back to the league rate


def load():
    g = pd.read_csv(GAMES, low_memory=False)
    g = g[(g.game_type == "REG") & g.home_score.notna()].copy()
    g["tot"] = g.home_score + g.away_score
    return g


def season_tendencies(g, season):
    """{team: mean game total} and the league mean, over one completed season."""
    s = g[g.season == season]
    t, c = {}, {}
    for _, r in s.iterrows():
        for team in (r.home_team, r.away_team):
            t[team] = t.get(team, 0.0) + r.tot
            c[team] = c.get(team, 0) + 1
    return {k: t[k] / c[k] for k in t if c[k] >= MIN_PRIOR_GAMES}, (s.tot.mean() if len(s) else np.nan)


def predict_season(g, season, k, cur_w):
    """Walk forward through one season, predicting each week from what was known BEFORE it.

    `cur_w` weights this season's games-so-far against the prior season's full year. 0 reproduces
    what ships today. The league anchor walks forward the same way, so a season that is scoring more
    than last year moves the baseline too -- which is the half of the fix that needs no team signal
    at all.
    """
    prior, prior_lg = season_tendencies(g, season - 1)
    if not prior or not np.isfinite(prior_lg):
        return []
    s = g[g.season == season].sort_values(["week"])
    run_tot, run_n = {}, {}          # this season so far, per team
    lg_tot, lg_n = 0.0, 0
    out = []
    for wk in sorted(s.week.unique()):
        games = s[s.week == wk]
        # Predict with the state as it stood BEFORE this week -- no look-ahead.
        lg_now = (lg_tot / lg_n) if lg_n >= 16 else prior_lg
        for _, r in games.iterrows():
            h, a = r.home_team, r.away_team
            if h not in prior or a not in prior:
                continue

            def tend(team):
                pr = prior[team]
                n = run_n.get(team, 0)
                if not n or cur_w <= 0:
                    return pr
                cur = run_tot[team] / n
                # Weight by games played, capped by cur_w: at cur_w=1 a team with a full prior
                # season and n games this year weights this year n/(n+16).
                w = cur_w * n / (n + 16.0)
                return (1 - w) * pr + w * cur
            pred = lg_now + k * ((tend(h) + tend(a)) / 2.0 - lg_now)
            out.append({"season": season, "week": int(r.week), "pred": pred,
                        "actual": float(r.tot),
                        "line": float(r.total_line) if pd.notna(r.total_line) else None})
        # Then fold this week's results in.
        for _, r in games.iterrows():
            for team in (r.home_team, r.away_team):
                run_tot[team] = run_tot.get(team, 0.0) + r.tot
                run_n[team] = run_n.get(team, 0) + 1
            lg_tot += r.tot
            lg_n += 1
    return out


def score(rows):
    if not rows:
        return None
    pe = [abs(r["pred"] - r["actual"]) for r in rows]
    bias = [r["pred"] - r["actual"] for r in rows]
    sd = st.pstdev([r["pred"] for r in rows])
    lined = [r for r in rows if r["line"] is not None]
    w = sum(1 for r in lined if (r["pred"] > r["line"] and r["actual"] > r["line"])
            or (r["pred"] < r["line"] and r["actual"] < r["line"]))
    l = sum(1 for r in lined if (r["pred"] > r["line"] and r["actual"] < r["line"])
            or (r["pred"] < r["line"] and r["actual"] > r["line"]))
    mkt = [abs(r["line"] - r["actual"]) for r in lined]
    return {"n": len(rows), "mae": st.mean(pe), "bias": st.mean(bias), "sd": sd,
            "ou": (w, l), "ouPct": (100.0 * w / (w + l)) if w + l else float("nan"),
            "mktMae": st.mean(mkt) if mkt else float("nan")}


def run(g, seasons, k, cur_w):
    rows = []
    for y in seasons:
        rows += predict_season(g, y, k, cur_w)
    return score(rows)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--final", nargs=2, type=float, metavar=("CUR_W", "K"),
                    help="score one (cur_w, k) on the held-out seasons and stop")
    args = ap.parse_args(argv)
    g = load()

    if args.final:
        cur_w, k = args.final
        for lab, seasons in (("TRAIN", TRAIN), ("HELD-OUT", HOLD)):
            s = run(g, seasons, k, cur_w)
            print(f"{lab:9s} cur_w={cur_w} k={k}  n={s['n']}  MAE {s['mae']:.3f} "
                  f"(market {s['mktMae']:.3f})  sd {s['sd']:.2f}  bias {s['bias']:+.2f}  "
                  f"O/U {s['ou'][0]}-{s['ou'][1]} ({s['ouPct']:.1f}%)")
        return 0

    print("TRAIN sweep -- MAE chooses the shrink, which is the trap; the O/U column is REPORTED,")
    print("never optimised on. sd is how much the column varies between games (actual sd ~14.6,")
    print("market ~4.1); a column near zero cannot carry a per-game call whatever its MAE.\n")
    print(f"{'cur_w':>6} {'k':>5} {'MAE':>8} {'vs mkt':>8} {'sd':>6} {'bias':>7} {'O/U':>10} {'O/U%':>6}")
    best = None
    for cur_w in (0.0, 0.5, 1.0, 1.5, 2.0):
        for k in (0.5, 0.75, 1.0, 1.25, 1.5):
            s = run(g, TRAIN, k, cur_w)
            flag = ""
            if best is None or s["mae"] < best[0]:
                best = (s["mae"], cur_w, k)
                flag = "  <- best MAE so far"
            print(f"{cur_w:6.1f} {k:5.2f} {s['mae']:8.3f} {s['mae']-s['mktMae']:+8.3f} "
                  f"{s['sd']:6.2f} {s['bias']:+7.2f} {str(s['ou'][0])+'-'+str(s['ou'][1]):>10} "
                  f"{s['ouPct']:5.1f}%{flag}")
    print(f"\nbest MAE on train: cur_w={best[1]} k={best[2]} ({best[0]:.3f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
