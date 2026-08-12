"""
Snap-share model + walk-forward evaluation.

The point of this script is NOT to produce a good-looking headline number.
It is to answer three questions:

  Q1  Does the model beat naive persistence (last week's share)?
  Q2  Does it beat persistence ON THE WEEKS THAT MATTER (role changes)?
      Overall error is dominated by stable weeks and will hide this.
  Q3  Are the predictive intervals calibrated?

Walk-forward: train on everything strictly before the test week, predict that
week, roll forward. No random splits.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

EPS = 0.01
TEST_SEASONS = [2022, 2023, 2024]

FEATS = ["ewm1", "ewm3", "ewm8", "prior_season_share", "stdm_prior",
         "games_prior", "played_last_wk", "week",
         "depth_rank", "grp_prior_sum", "grp_n_active", "prior_share_of_grp",
         "vacated_out", "returning", "on_injury_report", "team_pace_prior",
         "pos_grp_c", "own_report_c", "own_practice_c"]

CATS = [False] * 16 + [True] * 3


def logit(p):
    p = np.clip(p, EPS, 1 - EPS)
    return np.log(p / (1 - p))


def expit(z):
    return 1.0 / (1.0 + np.exp(-z))


def prep(path="../panel_feat.csv"):
    d = pd.read_csv(path, low_memory=False)
    d = d[d.pos_grp.isin(["RB", "WR", "TE"])].copy()      # QB share is degenerate
    d = d[d.games_prior >= 1]                              # need some history
    for c, out in (("pos_grp", "pos_grp_c"), ("own_report", "own_report_c"),
                   ("own_practice", "own_practice_c")):
        d[out] = pd.Categorical(d[c].astype(str)).codes
    d["t"] = d.season * 100 + d.week
    d["y"] = d.snap_share
    return d.sort_values("t").reset_index(drop=True)


def fit_predict(tr, te, quantile=None):
    kw = dict(max_iter=300, learning_rate=0.06, max_leaf_nodes=31,
              min_samples_leaf=40, l2_regularization=1.0,
              categorical_features=CATS, random_state=0)
    if quantile is None:
        m = HistGradientBoostingRegressor(loss="squared_error", **kw)
    else:
        m = HistGradientBoostingRegressor(loss="quantile", quantile=quantile, **kw)
    m.fit(tr[FEATS], logit(tr.y))
    return expit(m.predict(te[FEATS])), m


def walk_forward(d):
    rows = []
    weeks = sorted(d.loc[d.season.isin(TEST_SEASONS), "t"].unique())
    for t in weeks:
        tr = d[d.t < t]
        te = d[d.t == t]
        if len(tr) < 5000 or len(te) < 20:
            continue
        pred, _ = fit_predict(tr, te)
        out = te[["season", "week", "player", "team", "pos_grp", "y",
                  "ewm1", "ewm3", "prior_season_share", "vacated_out",
                  "vacated_oracle", "returning", "depth_rank"]].copy()
        out["pred"] = pred
        rows.append(out)
    return pd.concat(rows, ignore_index=True)


def mae(a, b):
    m = ~(pd.isna(a) | pd.isna(b))
    return float(np.mean(np.abs(np.asarray(a)[m] - np.asarray(b)[m])))


def report(r):
    r = r.copy()
    r["delta"] = (r.y - r.ewm1).abs()
    r["stdm"] = r.delta < 0.10          # "stable" week
    r["sdm_mid"] = (r.delta >= 0.10) & (r.delta < 0.25)
    r["big"] = r.delta >= 0.25

    print("=" * 74)
    print(f"WALK-FORWARD RESULTS   n={len(r):,}   seasons={TEST_SEASONS}")
    print("=" * 74)

    def block(name, sub):
        if len(sub) < 30:
            return
        print(f"\n{name}   (n={len(sub):,}, {100*len(sub)/len(r):.1f}% of rows)")
        print(f"  {'model':<26}{'MAE':>8}")
        for lbl, col in (("persistence (last wk)", "ewm1"),
                         ("EWMA(3)", "ewm3"),
                         ("prior-season mean", "prior_season_share"),
                         ("MODEL", "pred")):
            print(f"  {lbl:<26}{mae(sub.y, sub[col]):>8.4f}")
        b = mae(sub.y, sub.ewm1)
        m = mae(sub.y, sub.pred)
        print(f"  {'-> improvement vs persist':<26}{100*(b-m)/b:>7.1f}%")

    block("ALL WEEKS", r)
    block("STABLE weeks  |y - lastwk| < .10", r[r.stdm])
    block("MODERATE change  .10-.25", r[r.sdm_mid])
    block("LARGE change  >= .25", r[r.big])
    block("TEAMMATE DECLARED OUT (vacated_out > 0)", r[r.vacated_out > 0])
    block("PLAYER RETURNING from Out/Doubtful", r[r.returning == 1])

    print("\n" + "-" * 74)
    print("BY POSITION")
    for p in ["RB", "WR", "TE"]:
        s = r[r.pos_grp == p]
        print(f"  {p}: n={len(s):<6} persist={mae(s.y,s.ewm1):.4f}  "
              f"model={mae(s.y,s.pred):.4f}  "
              f"gain={100*(mae(s.y,s.ewm1)-mae(s.y,s.pred))/mae(s.y,s.ewm1):+.1f}%")

    print("\n" + "-" * 74)
    print("BY DEPTH RANK  (props edge lives in the back of the depth chart)")
    for dr in [1, 2, 3]:
        s = r[r.depth_rank == dr]
        if len(s) < 30:
            continue
        print(f"  rank {dr}: n={len(s):<6} persist={mae(s.y,s.ewm1):.4f}  "
              f"model={mae(s.y,s.pred):.4f}  "
              f"gain={100*(mae(s.y,s.ewm1)-mae(s.y,s.pred))/mae(s.y,s.ewm1):+.1f}%")
    s = r[r.depth_rank >= 4]
    print(f"  rank 4+: n={len(s):<6} persist={mae(s.y,s.ewm1):.4f}  "
          f"model={mae(s.y,s.pred):.4f}  "
          f"gain={100*(mae(s.y,s.ewm1)-mae(s.y,s.pred))/mae(s.y,s.ewm1):+.1f}%")


def quantile_check(d):
    """Season-level walk-forward for interval calibration."""
    qs = [0.10, 0.25, 0.50, 0.75, 0.90]
    res = []
    for s in TEST_SEASONS:
        tr, te = d[d.season < s], d[d.season == s]
        out = te[["y"]].copy()
        for q in qs:
            p, _ = fit_predict(tr, te, quantile=q)
            out[f"q{int(q*100)}"] = p
        res.append(out)
    r = pd.concat(res, ignore_index=True)
    print("\n" + "=" * 74)
    print("INTERVAL CALIBRATION  (nominal vs empirical coverage)")
    print("=" * 74)
    for q in qs:
        emp = (r.y <= r[f"q{int(q*100)}"]).mean()
        print(f"  q{int(q*100):<3} nominal={q:.2f}  empirical={emp:.3f}  "
              f"{'OK' if abs(emp-q) < 0.03 else 'MISCALIBRATED'}")
    lo, hi = r.q10, r.q90
    cov = ((r.y >= lo) & (r.y <= hi)).mean()
    print(f"\n  80% interval [q10,q90] empirical coverage = {cov:.3f}  (target 0.80)")
    print(f"  mean interval width = {(hi-lo).mean():.3f} snap share")
    return r


if __name__ == "__main__":
    d = prep()
    print(f"modelling universe: {len(d):,} player-weeks, "
          f"{d.season.min()}-{d.season.max()}")
    r = walk_forward(d)
    r.to_csv("../walkforward_preds.csv", index=False)
    report(r)
    quantile_check(d)
