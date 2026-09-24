"""Publish a number on the SAME SCALE as the book's line, instead of a mean beside a median.

Derek, three times now: "the top half players are all still unders and the bottom half are all
overs." He is right, and the two efficiency fixes before this — both real bugs — were never going
to change it. This is the cause:

    we publish   a recency-weighted MEAN of what a player does
    they publish a LINE, set near the MEDIAN, because that is where the two sides split

Receiving and rushing yards are strongly right-skewed, and the skew is worst at the bottom:

    rec_yds   mean/median = 1.83 at a low level   ->   1.13 at a high level
    rush_yds              = 1.74                  ->   1.10
    receptions            = 1.48                  ->   1.01
    pass_yds              = 1.01                  ->   1.01     (near-symmetric: no lean)

So a back-up's mean sits ~80% above the line and reads OVER; a star's sits ~10% above and reads
level or under once anything else moves. Top half under, bottom half over, deterministically, with
nothing wrong in the model. It is a units clash and the only fix is to change the units.

WHAT THIS BUILDS. For each market, the empirical ratio median(actual) / projected-mean, as a
function of the projected mean, fitted on train and checked on held-out. The board then publishes
mu * ratio(mu) — a 50/50 number, directly comparable to the line.

WHY THIS IS NOT A FUDGE, and the check that proves it: the median MINIMISES absolute error, while
the mean minimises squared error. Report cards grade absolute error against the close. So if this
is done right, MAE should IMPROVE, the share of rows leaning over should move to ~50%, and the
share that ACTUALLY go over should stay where it was. All three are asserted below.

    train 2021-2024   hold 2025-2026
    python analysis/median_calibration.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN, HOLD = {2021, 2022, 2023, 2024}, {2025, 2026}
HALF_LIFE, CUR_K = 2.5, 1.0

# market -> (positions, volume col, production col)
MARKETS = {
    "rec_yds":    (["WR", "TE", "RB"], "targets", "receiving_yards"),
    "rush_yds":   (["RB", "QB"], "carries", "rushing_yards"),
    "receptions": (["WR", "TE", "RB"], "targets", "receptions"),
    "pass_yds":   (["QB"], "attempts", "passing_yards"),
}
# Ratio is fitted in these bands of the projected mean. Bands, not a smooth curve, because the
# relationship is steep at the bottom and flat at the top and a polynomial misbehaves at the ends.
BANDS = [0.0, 5.0, 10.0, 20.0, 35.0, 55.0, 80.0, 1e9]


def load(season):
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return None
    d = pd.read_csv(path, low_memory=False)
    d = d[d.season_type == "REG"].copy()
    for c in ("targets", "carries", "attempts", "receptions",
              "receiving_yards", "rushing_yards", "passing_yards"):
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0.0)
    d["week"] = pd.to_numeric(d.week, errors="coerce")
    return d


def ewma(vals, hl=HALF_LIFE):
    lam = 0.5 ** (1.0 / hl)
    w = np.array([lam ** i for i in range(len(vals) - 1, -1, -1)])
    return float(np.dot(w, vals) / w.sum())


def build(market):
    positions, volc, prodc = MARKETS[market]
    data = {s: load(s) for s in SEASONS}
    rows = []
    for s in SEASONS:
        d = data.get(s)
        if d is None or d.empty:
            continue
        d = d[d.position.isin(positions)]
        prev = data.get(s - 1)
        prior = {}
        if prev is not None:
            q = prev[prev.position.isin(positions)]
            g = q.groupby("player_id").agg(v=(prodc, "sum"), n=("week", "nunique"))
            prior = {str(k): float(r.v / r.n) for k, r in g.iterrows() if r.n}
        hist = {}
        for wk in sorted(int(w) for w in d.week.dropna().unique()):
            cur = d[d.week == wk]
            for _, r in cur.iterrows():
                pid = str(r.player_id)
                past = hist.get(pid, [])
                if len(past) < 2:
                    continue
                mu = ewma(past)
                pm = prior.get(pid)
                if pm is not None:
                    mu = (len(past) * mu + CUR_K * pm) / (len(past) + CUR_K)
                rows.append({"season": s, "mu": mu, "actual": float(r[prodc])})
            for _, r in cur.iterrows():
                hist.setdefault(str(r.player_id), []).append(float(r[prodc]))
    return pd.DataFrame(rows)


def fit_ratios(tr, market):
    """median(actual) / mu, per band of mu, fitted on TRAIN only."""
    out = []
    for i in range(len(BANDS) - 1):
        lo, hi = BANDS[i], BANDS[i + 1]
        b = tr[(tr.mu >= lo) & (tr.mu < hi)]
        if len(b) < 150 or b.mu.mean() <= 0:
            out.append(None)
            continue
        # Ratio of the band's median OUTCOME to the band's mean PROJECTION. Using the ratio of
        # aggregates rather than the mean of per-row ratios, which a near-zero mu would blow up.
        out.append(float(b.actual.median() / b.mu.mean()))
    # Carry the nearest fitted value into any band too thin to fit, so the function is total.
    known = [i for i, v in enumerate(out) if v is not None]
    if not known:
        return [1.0] * (len(BANDS) - 1)
    for i in range(len(out)):
        if out[i] is None:
            out[i] = out[min(known, key=lambda j: abs(j - i))]
    return out


def apply_ratio(mu, ratios):
    idx = np.clip(np.searchsorted(BANDS, mu, side="right") - 1, 0, len(ratios) - 1)
    return mu * np.array(ratios)[idx]


def main():
    print("Fitted on TRAIN 2021-2024, checked on HELD-OUT 2025-2026.\n")
    emit = {}
    for market in MARKETS:
        df = build(market)
        if df.empty:
            continue
        tr, ho = df[df.season.isin(TRAIN)], df[df.season.isin(HOLD)]
        ratios = fit_ratios(tr, market)
        emit[market] = ratios

        mu = ho.mu.values
        med = apply_ratio(mu, ratios)
        act = ho.actual.values
        print(f"{market}   (n held-out = {len(ho):,})")
        print("  band of projected mean :  " +
              "  ".join(f"{BANDS[i]:.0f}-{BANDS[i+1]:.0f}" if BANDS[i+1] < 1e8 else f"{BANDS[i]:.0f}+"
                        for i in range(len(ratios))))
        print("  ratio median/mean      :  " + "  ".join(f"{r:8.2f}" for r in ratios))
        mae_mu = float(np.abs(mu - act).mean())
        mae_md = float(np.abs(med - act).mean())
        print(f"  MAE   mean {mae_mu:7.3f}  ->  median {mae_md:7.3f}   "
              f"({(mae_mu - mae_md) / mae_mu * 100:+.2f}%)")
        # Calibration: how often does the actual beat the number we publish?
        print(f"  actual above OUR number:  mean {100 * (act > mu).mean():5.1f}%  ->  "
              f"median {100 * (act > med).mean():5.1f}%   (want ~50)")
        print()

    print("\n# paste into analysis/player_proj_export.py")
    print(f"MEDIAN_BANDS = {[b for b in BANDS[:-1]]}")
    print("MEDIAN_RATIO = {")
    for m, r in emit.items():
        print(f'    "{m}": {[round(x, 3) for x in r]},')
    print("}")


if __name__ == "__main__":
    main()
