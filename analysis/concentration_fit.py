"""Our within-team volume split is too FLAT. Fit the sharpening that fixes it.

Derek, three times: "the top half players are all still unders and the bottom half are all overs."
Two efficiency bugs were found and fixed on the way here and neither changed the pattern, because
neither was the cause. This is:

    a team's receiving yards, ours vs the market      ATL 181.6 / 177.0      GB 216.1 / 205.5
                                                      BAL  59.2 /  72.5     PIT 105.3 /  89.0

The LEVEL agrees with the market almost exactly, team by team. What disagrees is how that total is
split up. Measured against what actually happens, over 2,393 team-weeks and with no market data
anywhere:

    share of a team's targets going to    our projection    reality     gap
      its top receiver                        27.2%          30.7%     -3.5
      its top two                             47.4%          52.3%     -4.9
      its top three                           62.8%          68.2%     -5.4

We hand the stars too little and the depth too much. That is the board Derek keeps pointing at, and
it comes from three separate shrinkages stacking: the prior-season blend, the depth-chart role
prior, and the recency weighting all pull every player toward the middle of his room, and nothing
ever pulls back.

THE FIX is a power transform on each player's share of his room, which sharpens the distribution
while preserving the team total we already know is right:

    share' = share^GAMMA / sum(share^GAMMA)

GAMMA = 1 is today. Above 1 concentrates. It is fitted on train against per-player volume error,
not against the concentration gap directly — closing a gap is easy and worthless if the number gets
less accurate, so accuracy is the objective and the gap is the diagnostic.

    train 2021-2024   hold 2025-2026
    python analysis/concentration_fit.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN, HOLD = {2021, 2022, 2023, 2024}, {2025, 2026}
HALF_LIFE, CUR_K = 2.5, 1.0
ROOMS = {"targets": ["WR", "TE", "RB"], "carries": ["RB", "QB", "WR"]}


def load(season):
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return None
    d = pd.read_csv(path, low_memory=False)
    d = d[d.season_type == "REG"].copy()
    for c in ("targets", "carries"):
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0.0)
    d["week"] = pd.to_numeric(d.week, errors="coerce")
    return d


def ewma(vals, hl=HALF_LIFE):
    lam = 0.5 ** (1.0 / hl)
    w = np.array([lam ** i for i in range(len(vals) - 1, -1, -1)])
    return float(np.dot(w, vals) / w.sum())


def build(volc):
    positions = ROOMS[volc]
    data = {s: load(s) for s in SEASONS}
    out = []
    for s in SEASONS:
        d = data.get(s)
        if d is None or d.empty:
            continue
        d = d[d.position.isin(positions)]
        prev = data.get(s - 1)
        prior = {}
        if prev is not None:
            q = prev[prev.position.isin(positions)]
            g = q.groupby("player_id").agg(v=(volc, "sum"), n=("week", "nunique"))
            prior = {str(k): float(r.v / r.n) for k, r in g.iterrows() if r.n}
        hist = {}
        for wk in sorted(int(w) for w in d.week.dropna().unique()):
            cur = d[d.week == wk]
            for tm, grp in cur.groupby("team"):
                proj, act = [], []
                for _, r in grp.iterrows():
                    pid = str(r.player_id)
                    past = hist.get(pid, [])
                    if len(past) < 2:
                        continue
                    mu = ewma(past)
                    pm = prior.get(pid)
                    if pm is not None:
                        mu = (len(past) * mu + CUR_K * pm) / (len(past) + CUR_K)
                    proj.append(mu)
                    act.append(float(r[volc]))
                if len(proj) >= 4 and sum(proj) > 0:
                    out.append({"season": s, "team": str(tm), "week": wk,
                                "proj": np.array(proj), "act": np.array(act)})
            # This week's games become history for the next one. Omitting it produced zero rooms
            # rather than wrong ones, which is the good kind of failure.
            for _, r in cur.iterrows():
                hist.setdefault(str(r.player_id), []).append(float(r[volc]))
    return out


def sharpen(p, gamma):
    if gamma == 1.0 or p.sum() <= 0:
        return p
    sh = p / p.sum()
    q = sh ** gamma
    return q / q.sum() * p.sum()


def evaluate(rooms, gamma):
    err, n = 0.0, 0
    top1p, top1a = [], []
    for r in rooms:
        q = sharpen(r["proj"], gamma)
        err += np.abs(q - r["act"]).sum()
        n += len(q)
        if r["act"].sum() > 0:
            top1p.append(np.sort(q)[::-1][0] / q.sum())
            top1a.append(np.sort(r["act"])[::-1][0] / r["act"].sum())
    return err / n, float(np.mean(top1p)), float(np.mean(top1a))


def main():
    for volc in ("targets", "carries"):
        rooms = build(volc)
        tr = [r for r in rooms if r["season"] in TRAIN]
        ho = [r for r in rooms if r["season"] in HOLD]
        print(f"\n{'=' * 70}\n{volc}   train rooms {len(tr):,}   held-out {len(ho):,}\n{'=' * 70}")
        gammas = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0]
        print(f"  {'gamma':>6s} {'train MAE':>10s} {'top-1 proj':>11s} {'top-1 actual':>13s}")
        best, bg = None, 1.0
        for g in gammas:
            m, p1, a1 = evaluate(tr, g)
            if best is None or m < best:
                best, bg = m, g
            print(f"  {g:6.2f} {m:10.4f} {p1 * 100:10.1f}% {a1 * 100:12.1f}%")
        print(f"\n  best on train: gamma = {bg}")
        b0, p0, a0 = evaluate(ho, 1.0)
        b1, p1, a1 = evaluate(ho, bg)
        print(f"  HELD-OUT  MAE {b0:.4f} -> {b1:.4f}  ({(b0 - b1) / b0 * 100:+.2f}%)")
        print(f"            top-1 share {p0 * 100:.1f}% -> {p1 * 100:.1f}%   (actual {a1 * 100:.1f}%)")


if __name__ == "__main__":
    main()
