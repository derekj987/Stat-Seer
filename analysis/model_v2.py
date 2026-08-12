"""
v2: model the CHANGE, not the level.

v1 diagnosis: the level model degraded stable weeks by 18% because it re-derived
a number persistence already had right. Reframing the target as
(share_this_week - share_last_week) means the model predicts ~0 when no change
signal is present, and only moves off persistence when a feature says to.

Also adds:
  - split-conformal calibration of predictive intervals
  - PROPORTIONAL error, which is what matters for props: a 0.05 snap-share miss
    on a 20%-share player is a 25% volume error; on an 80%-share player it is 6%.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from model import prep, FEATS, CATS, mae, TEST_SEASONS


def fit_predict_resid(tr, te):
    m = HistGradientBoostingRegressor(
        loss="squared_error", max_iter=300, learning_rate=0.05,
        max_leaf_nodes=31, min_samples_leaf=40, l2_regularization=1.0,
        categorical_features=CATS, random_state=0)
    m.fit(tr[FEATS], tr.y - tr.ewm1)
    delta = m.predict(te[FEATS])
    return np.clip(te.ewm1.values + delta, 0.0, 1.0), m


def walk_forward_resid(d):
    rows = []
    weeks = sorted(d.loc[d.season.isin(TEST_SEASONS), "t"].unique())
    for t in weeks:
        tr, te = d[d.t < t], d[d.t == t]
        if len(tr) < 5000 or len(te) < 20:
            continue
        pred, _ = fit_predict_resid(tr, te)
        out = te[["season", "week", "player", "team", "pos_grp", "y", "ewm1",
                  "ewm3", "vacated_out", "returning", "depth_rank"]].copy()
        out["pred_v2"] = pred
        rows.append(out)
    return pd.concat(rows, ignore_index=True)


def compare(v1, v2):
    r = v1.merge(v2[["season", "week", "player", "team", "pred_v2"]],
                 on=["season", "week", "player", "team"], how="inner")
    r["delta"] = (r.y - r.ewm1).abs()
    print("=" * 74)
    print(f"v1 (level) vs v2 (residual)     n={len(r):,}")
    print("=" * 74)
    print(f"  {'stratum':<34}{'persist':>9}{'v1':>9}{'v2':>9}{'v2 gain':>10}")
    strata = [
        ("ALL", r),
        ("stable  |chg| < .10", r[r.delta < 0.10]),
        ("moderate  .10-.25", r[(r.delta >= 0.10) & (r.delta < 0.25)]),
        ("large  >= .25", r[r.delta >= 0.25]),
        ("teammate declared Out", r[r.vacated_out > 0]),
        ("returning from Out", r[r.returning == 1]),
    ]
    for name, s in strata:
        if len(s) < 30:
            continue
        p, a, b = mae(s.y, s.ewm1), mae(s.y, s.pred), mae(s.y, s.pred_v2)
        print(f"  {name:<34}{p:>9.4f}{a:>9.4f}{b:>9.4f}{100*(p-b)/p:>9.1f}%")
    return r


def proportional(r):
    """Error relative to the player's own volume - the props-relevant view."""
    print("\n" + "=" * 74)
    print("PROPORTIONAL ERROR  (MAE / mean actual share within bucket)")
    print("=" * 74)
    r = r.copy()
    r["bucket"] = pd.cut(r.ewm1, [0, .15, .35, .60, 1.01],
                         labels=["<15% (deep reserve)", "15-35% (rotational)",
                                 "35-60% (co-starter)", ">60% (starter)"])
    print(f"  {'prior-share bucket':<24}{'n':>7}{'persist':>10}{'v2':>10}{'gain':>9}")
    for b, s in r.groupby("bucket", observed=True):
        mu = s.y.mean()
        p, v = mae(s.y, s.ewm1) / mu, mae(s.y, s.pred_v2) / mu
        print(f"  {str(b):<24}{len(s):>7}{p:>9.1%}{v:>10.1%}{100*(p-v)/p:>8.1f}%")


def conformal(d):
    """Split-conformal intervals: calibrate width on the most recent held-out weeks."""
    print("\n" + "=" * 74)
    print("CONFORMAL PREDICTIVE INTERVALS")
    print("=" * 74)
    rows = []
    for s in TEST_SEASONS:
        tr_all = d[d.season < s]
        cal_t = sorted(tr_all.t.unique())[-60:]           # recent weeks as calib set
        tr = tr_all[~tr_all.t.isin(cal_t)]
        cal = tr_all[tr_all.t.isin(cal_t)]
        te = d[d.season == s]
        pc, m = fit_predict_resid(tr, cal)
        resid = np.abs(cal.y.values - pc)
        pt = np.clip(te.ewm1.values + m.predict(te[FEATS]), 0, 1)
        out = te[["y"]].copy()
        out["pred"] = pt
        for lvl in (0.50, 0.80, 0.90):
            q = np.quantile(resid, lvl)
            out[f"lo{int(lvl*100)}"] = np.clip(pt - q, 0, 1)
            out[f"hi{int(lvl*100)}"] = np.clip(pt + q, 0, 1)
        rows.append(out)
    r = pd.concat(rows, ignore_index=True)
    for lvl in (50, 80, 90):
        cov = ((r.y >= r[f"lo{lvl}"]) & (r.y <= r[f"hi{lvl}"])).mean()
        w = (r[f"hi{lvl}"] - r[f"lo{lvl}"]).mean()
        flag = "OK" if abs(cov - lvl / 100) < 0.03 else "off"
        print(f"  {lvl}% interval: coverage={cov:.3f}  mean width={w:.3f}  {flag}")
    return r


def importances(d):
    print("\n" + "=" * 74)
    print("PERMUTATION IMPORTANCE  (2024 holdout, residual model)")
    print("=" * 74)
    tr, te = d[d.season < 2024], d[d.season == 2024]
    _, m = fit_predict_resid(tr, te)
    pi = permutation_importance(m, te[FEATS], te.y - te.ewm1,
                                n_repeats=5, random_state=0,
                                scoring="neg_mean_absolute_error")
    imp = (pd.Series(pi.importances_mean, index=FEATS)
           .sort_values(ascending=False))
    for k, v in imp.head(12).items():
        print(f"  {k:<24}{v:>9.5f}")


if __name__ == "__main__":
    d = prep()
    v1 = pd.read_csv("../walkforward_preds.csv")
    v2 = walk_forward_resid(d)
    v2.to_csv("../walkforward_v2.csv", index=False)
    r = compare(v1, v2)
    proportional(r)
    conformal(d)
    importances(d)
