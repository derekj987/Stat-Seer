"""Pick the recency half-life on TRAIN seasons, confirm it on HELD-OUT ones.

volume_backtest.py established the shape: a recency-weighted season-to-date mean beats the simple
mean everywhere, and on players whose role just moved it is worth ~7% of MAE while cutting a
-2.2-carry bias to -0.75. This picks the constants without letting the confirmation seasons vote.

    train   2021-2024      choose HALF_LIFE and CUR_K here
    hold    2025-2026      report only

Also answers the second question the trace raised: `apply_role` weights a player's own volume by
`games`, which `blend_current` sets to prior-season games + current games. For a player whose role
just changed that count is mostly evidence about the role he no longer has. This sweeps what that
weight should actually be.

    python analysis/volume_sweep.py
"""
from __future__ import annotations

import itertools
import os

import numpy as np
import pandas as pd

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN = {2021, 2022, 2023, 2024}
HOLD = {2025, 2026}
VOL = {"RB": "carries", "FB": "carries", "WR": "targets", "TE": "targets", "QB": "attempts"}


def load(season):
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return None
    d = pd.read_csv(path, low_memory=False)
    d = d[(d.season_type == "REG") & d.position.isin(VOL)].copy()
    for c in ("carries", "targets", "attempts"):
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0.0)
    d["vol"] = [r[VOL[p]] for r, p in zip(d.to_dict("records"), d.position)]
    d["week"] = pd.to_numeric(d.week, errors="coerce")
    return d[["player_id", "position", "team", "week", "vol"]]


def build():
    """One row per (player, week) with his season-to-date volumes and his prior-season mean."""
    data = {s: load(s) for s in SEASONS}
    rows = []
    for s in SEASONS:
        d = data.get(s)
        if d is None or d.empty:
            continue
        p = data.get(s - 1)
        prior = {}
        if p is not None:
            g = p.groupby("player_id").agg(v=("vol", "sum"), n=("week", "nunique"))
            prior = {str(k): (float(r.v / r.n), int(r.n)) for k, r in g.iterrows() if r.n}
        hist = {}
        for wk in sorted(d.week.dropna().unique()):
            cur = d[d.week == int(wk)]
            for _, r in cur.iterrows():
                pid = str(r.player_id)
                past = hist.get(pid, [])
                if past:
                    pm, pn = prior.get(pid, (None, 0))
                    rows.append({"season": s, "pos": str(r.position), "actual": float(r.vol),
                                 "past": tuple(past), "prior": pm, "prior_n": pn})
            for _, r in cur.iterrows():
                hist.setdefault(str(r.player_id), []).append(float(r.vol))
    return pd.DataFrame(rows)


def est(past, prior, half_life, cur_k):
    # `prior` arrives from a DataFrame column, so a missing prior season is NaN, not None -- and
    # `NaN is None` is False, so a plain identity check silently blends NaN into every estimate and
    # the whole sweep returns NaN. Check for both.
    if prior is not None and prior != prior:
        prior = None
    n = len(past)
    if half_life is None:
        v = float(np.mean(past))
    else:
        lam = 0.5 ** (1.0 / half_life)
        w = np.array([lam ** i for i in range(n - 1, -1, -1)])
        v = float(np.dot(w, past) / w.sum())
    return v if prior is None else (n * v + cur_k * prior) / (n + cur_k)


def mae(df, half_life, cur_k):
    pred = np.array([est(p, pr, half_life, cur_k) for p, pr in zip(df.past, df.prior)])
    return float(np.abs(pred - df.actual.values).mean())


def main():
    df = build()
    tr, ho = df[df.season.isin(TRAIN)], df[df.season.isin(HOLD)]
    print(f"train {len(tr):,} player-games   held-out {len(ho):,}\n")

    print("TRAIN — MAE by half-life x CUR_K   (None = simple mean, what ships today)")
    hls = [None, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 6.0]
    cks = [0.5, 1.0, 1.5, 2.0, 3.0]
    print(f"  {'half-life':>10s} " + " ".join(f"{'K=' + str(k):>8s}" for k in cks))
    best = None
    for hl in hls:
        cells = []
        for ck in cks:
            m = mae(tr, hl, ck)
            cells.append(m)
            if best is None or m < best[0]:
                best = (m, hl, ck)
        print(f"  {str(hl):>10s} " + " ".join(f"{c:8.4f}" for c in cells))
    print(f"\n  best on train: half_life={best[1]}, CUR_K={best[2]}  (MAE {best[0]:.4f})")

    ship = (None, 1.5)
    print("\nHELD-OUT 2025-2026 — confirmation only")
    for lab, (hl, ck) in (("ships today", ship), ("chosen", (best[1], best[2])),
                          ("half_life=2, K=1.5", (2.0, 1.5)), ("half_life=3, K=1.5", (3.0, 1.5))):
        m = mae(ho, hl, ck)
        d = (mae(ho, *ship) - m) / mae(ho, *ship) * 100
        print(f"  {lab:20s} half_life={str(hl):>5s} K={ck:<4} MAE {m:.4f}  {d:+5.2f}%")

    print("\nHELD-OUT by position")
    for pos in ("RB", "WR", "TE", "QB"):
        sub = ho[ho.pos == pos]
        if len(sub) < 200:
            continue
        b = mae(sub, *ship)
        c = mae(sub, best[1], best[2])
        print(f"  {pos:3s} n={len(sub):6,d}  ships {b:7.4f} -> chosen {c:7.4f}  {(b - c) / b * 100:+5.2f}%")

    print("\nHELD-OUT, role stepped UP (last game >= 2x the simple mean, >= 3 volume)")
    m = ho[[len(p) >= 1 and p[-1] >= 3 and p[-1] >= 2 * max(np.mean(p), 0.5) for p in ho.past]]
    b, c = mae(m, *ship), mae(m, best[1], best[2])
    pb = np.array([est(p, pr, *ship) for p, pr in zip(m.past, m.prior)]) - m.actual.values
    pc = np.array([est(p, pr, best[1], best[2]) for p, pr in zip(m.past, m.prior)]) - m.actual.values
    print(f"  n={len(m):,}  MAE {b:.3f} -> {c:.3f}  {(b - c) / b * 100:+5.2f}%"
          f"   bias {pb.mean():+.3f} -> {pc.mean():+.3f}")


if __name__ == "__main__":
    main()
