"""Is CUR_K = 1.0 right EARLY in the season, or only right on average?

Derek, on tonight's receiving board: "All of the main receivers are all unders and the bottom half
players are all overs. That is not correct. Some of those star receivers will go over tonight."

He is right, and the skew answer I gave first does not explain it. Comparing each projection to the
player's OWN production, with no market line anywhere:

    player           ours    2026 mean (2 gm)   2025 mean
    Kyle Pitts       27.3          7.5             54.6
    Drake London     48.8         40.0             76.6
    Tucker Kraft     34.3         40.0             61.1
    Skyy Moore       12.4          3.0              5.1

Two games into a season, `CUR_K = 1.0` gives this season a weight of n/(n+K) = 2/3. So two quiet
games outweigh a full prior season two to one, and a star who has been shut down twice gets marked
most of the way down to it. Receiving yards have enormous game-to-game variance; two games is
nearly no information, and we are treating it as most of the information.

CUR_K was measured — but POOLED over every value of n. A single constant can be optimal on average
and wrong at the start of a season, which is exactly when the whole board is at small n. This
sweeps K separately at each n.

    train 2021-2024    hold 2025-2026
    python analysis/curk_by_n.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN, HOLD = {2021, 2022, 2023, 2024}, {2025, 2026}
HALF_LIFE = 2.5
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
    return d[["player_id", "position", "week", "vol"]]


def build():
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
            prior = {str(k): float(r.v / r.n) for k, r in g.iterrows() if r.n}
        hist = {}
        for wk in sorted(int(w) for w in d.week.dropna().unique()):
            cur = d[d.week == wk]
            for _, r in cur.iterrows():
                pid = str(r.player_id)
                past = hist.get(pid, [])
                if not past or pid not in prior:
                    continue          # only rows where BOTH sources exist — the blend's own domain
                lam = 0.5 ** (1.0 / HALF_LIFE)
                w = np.array([lam ** i for i in range(len(past) - 1, -1, -1)])
                rows.append({"season": s, "pos": str(r.position), "n": len(past),
                             "own": float(np.dot(w, past) / w.sum()),
                             "prior": prior[pid], "actual": float(r.vol)})
            for _, r in cur.iterrows():
                hist.setdefault(str(r.player_id), []).append(float(r.vol))
    return pd.DataFrame(rows)


def mae(df, k):
    pred = (df.n.values * df.own.values + k * df.prior.values) / (df.n.values + k)
    return float(np.abs(pred - df.actual.values).mean())


def main():
    df = build()
    tr, ho = df[df.season.isin(TRAIN)], df[df.season.isin(HOLD)]
    print(f"train {len(tr):,}   held-out {len(ho):,}\n")

    ks = [0.5, 1.0, 2.0, 3.0, 4.0, 6.0, 8.0]
    print("TRAIN — MAE by games played this season x CUR_K   (1.0 is what ships)")
    print(f"  {'n games':>8s} {'rows':>7s} " + " ".join(f"{('K=' + str(k)):>8s}" for k in ks) + "   best")
    best_by_n = {}
    for lo, hi, lab in ((1, 1, "1"), (2, 2, "2"), (3, 3, "3"), (4, 5, "4-5"),
                        (6, 8, "6-8"), (9, 99, "9+")):
        sub = tr[(tr.n >= lo) & (tr.n <= hi)]
        if len(sub) < 200:
            continue
        vals = [mae(sub, k) for k in ks]
        b = ks[int(np.argmin(vals))]
        best_by_n[(lo, hi)] = b
        print(f"  {lab:>8s} {len(sub):7,d} " + " ".join(f"{v:8.4f}" for v in vals) + f"   K={b}")

    print("\n  Same, WR/TE only — the positions Derek is looking at")
    for lo, hi, lab in ((1, 1, "1"), (2, 2, "2"), (3, 3, "3"), (4, 5, "4-5"), (6, 99, "6+")):
        sub = tr[(tr.n >= lo) & (tr.n <= hi) & tr.pos.isin(["WR", "TE"])]
        if len(sub) < 200:
            continue
        vals = [mae(sub, k) for k in ks]
        print(f"  {lab:>8s} {len(sub):7,d} " + " ".join(f"{v:8.4f}" for v in vals)
              + f"   K={ks[int(np.argmin(vals))]}")

    print("\nHELD-OUT 2025-2026 — flat K=1.0 against a schedule chosen on TRAIN")
    def sched(n):
        for (lo, hi), k in best_by_n.items():
            if lo <= n <= hi:
                return k
        return 1.0
    for lab, sub in (("all rows", ho), ("n <= 3 (early season)", ho[ho.n <= 3]),
                     ("WR/TE, n <= 3", ho[(ho.n <= 3) & ho.pos.isin(["WR", "TE"])])):
        if len(sub) < 100:
            continue
        flat = mae(sub, 1.0)
        pred = np.array([(r.n * r.own + sched(r.n) * r.prior) / (r.n + sched(r.n))
                         for r in sub.itertuples()])
        sc = float(np.abs(pred - sub.actual.values).mean())
        print(f"  {lab:22s} n={len(sub):6,d}  flat {flat:7.4f} -> scheduled {sc:7.4f}  "
              f"{(flat - sc) / flat * 100:+6.2f}%")
    print(f"\n  schedule chosen on train: {[(f'{lo}-{hi}', k) for (lo, hi), k in best_by_n.items()]}")


if __name__ == "__main__":
    main()
