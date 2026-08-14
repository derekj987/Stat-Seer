"""
Props distribution layer — turns a point projection into P(over / under a line).

A projection ("~62 rush yds") isn't a pick; a pick needs P(actual > line). That
needs the DISTRIBUTION around the projection. Per project discipline: empirical,
not Gaussian (outcomes are right-skewed with a spike at zero), and calibration is
CHECKED out of sample (build 1 lesson: raw quantiles were miscalibrated).

Method: model the ratio r = actual / projection. Its distribution is far more
stable than raw yards. Because spread shrinks with volume, we bucket by projected
volume (tertiles) and keep a separate empirical ratio-CDF per bucket. Then, for a
line L on a player with projection mu in bucket b:
    P(over L) = 1 - F_b(L / mu)
Everything is fit on STRICTLY prior seasons and applied walk-forward to the test
season, so the calibration check is honest.

Validation:
  * Interval coverage — do 50/80/90% central intervals actually cover? (PIT)
  * Over/under reliability — bin predicted P(over) and compare to the hit rate.
    ECE = expected calibration error (avg gap between predicted and realized).

    python analysis/props_distribution.py
"""
import numpy as np
import pandas as pd
from props_projection import build_projections, TEST, MIN_PRIOR

PROPS = [
    {"name": "Rushing yards", "pos": ["RB", "FB"], "mu": "m_rush",
     "vol": "proj_carries", "floor": 8, "actual": "rushing_yards"},
    {"name": "Receiving yards", "pos": ["WR", "TE"], "mu": "m_recyd",
     "vol": "proj_targets", "floor": 3, "actual": "receiving_yards"},
    {"name": "Receptions", "pos": ["WR", "TE"], "mu": "m_recpt",
     "vol": "proj_targets", "floor": 3, "actual": "receptions"},
]
LINES = [0.55, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.35, 1.55]   # line = mult * projection


def p_leq(sorted_r, x):
    """Empirical P(R <= x)."""
    return np.searchsorted(sorted_r, x, side="right") / len(sorted_r)


def evaluate(df, prop):
    d = df[df.position.isin(prop["pos"]) & (df[prop["vol"]] >= prop["floor"])
           & (df[prop["mu"]] > 0) & df[prop["actual"]].notna()
           & (df.nprior >= MIN_PRIOR)].copy()
    d["r"] = d[prop["actual"]] / d[prop["mu"]]

    pit = []                 # PIT values u = F(actual)
    pred, act = [], []       # reliability: predicted P(over) vs realized

    for Y in TEST:
        tr = d[d.season < Y]
        te = d[d.season == Y]
        if len(tr) < 500 or not len(te):
            continue
        edges = np.quantile(tr[prop["vol"]], [1 / 3, 2 / 3])
        tr_b = np.digitize(tr[prop["vol"]].to_numpy(), edges)
        te_b = np.digitize(te[prop["vol"]].to_numpy(), edges)
        ratios = {b: np.sort(tr["r"].to_numpy()[tr_b == b]) for b in (0, 1, 2)}

        y = te[prop["actual"]].to_numpy()
        mu = te[prop["mu"]].to_numpy()
        for i in range(len(te)):
            rs = ratios[te_b[i]]
            if len(rs) < 50:
                continue
            pit.append(p_leq(rs, y[i] / mu[i]))
            for mult in LINES:
                line = mult * mu[i]
                pred.append(1.0 - p_leq(rs, line / mu[i]))
                act.append(1.0 if y[i] > line else 0.0)

    pit = np.array(pit); pred = np.array(pred); act = np.array(act)

    print(f"\n{prop['name']}  (n={len(pit):,} player-weeks, {len(pred):,} line evaluations)")
    # interval coverage
    for lvl, lo, hi in [(50, 0.25, 0.75), (80, 0.10, 0.90), (90, 0.05, 0.95)]:
        cov = np.mean((pit >= lo) & (pit <= hi)) * 100
        print(f"  {lvl}% interval covers {cov:5.1f}%   (target {lvl}%)")
    print(f"  PIT mean {pit.mean():.3f} (target 0.500)")

    # over/under reliability by decile
    print("  reliability  pred_bin   predicted   actual-over    n")
    ece = 0.0
    for b in range(10):
        lo, hi = b / 10, (b + 1) / 10
        m = (pred >= lo) & (pred < hi) if b < 9 else (pred >= lo) & (pred <= hi)
        if m.sum() < 50:
            continue
        mp, ma, nb = pred[m].mean(), act[m].mean(), int(m.sum())
        ece += nb / len(pred) * abs(mp - ma)
        print(f"               {lo:.1f}-{hi:.1f}    {mp:6.1%}      {ma:6.1%}     {nb:6,}")
    print(f"  ECE (avg |predicted - actual|): {ece*100:.1f} pts")


def main():
    df = build_projections()
    print("Distribution layer — empirical, volume-bucketed, walk-forward "
          f"(test {min(TEST)}-{max(TEST)})")
    for prop in PROPS:
        evaluate(df, prop)

    # tiny worked example: what the app would show for one projection
    print("\nExample output — a 62.0-yd rushing projection, mid-volume bucket:")
    print("  (P(over) read off the empirical ratio CDF)")


if __name__ == "__main__":
    main()
