"""The receiver efficiency test, run for every position — and re-run for receivers without a cap.

Derek: "It looks like nothing has changed for tonight's receivers. Fix this. Also run this same
check against the running backs and quarterbacks."

The first pass chose REC_YPT_K on TRAIN by minimising MAE, which picked K = 500 for WR — a 17%
weight on the player's own rate for a receiver with 100 prior targets. That barely moves a number,
which is why the board looks unchanged. But MAE is the wrong thing to minimise here: it is almost
flat in K (the whole range spans 0.3%), so it cannot distinguish, while the BIAS on efficient vs
inefficient receivers — the thing Derek can actually see — varies strongly with K.

So this sweeps K against two objectives, states both, and picks on the one that matters:

    MAE            how accurate the number is on average
    BIAS SPREAD    (bias on the efficient third) - (bias on the inefficient third).
                   Zero means the board treats good and bad receivers even-handedly, which is
                   exactly what "all the big receivers are under" is complaining about.

Same test for the other markets:

    rush_yds  RB  yards per carry     — the founding finding says this does NOT persist (r=0.058)
    pass_yds  QB  yards per attempt   — already regressed at PASS_K=300; is that the right value?

    train 2021-2024   hold 2025-2026
    python analysis/efficiency_persist_all.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

SEASONS = [2020, 2021, 2022, 2023, 2024, 2025, 2026]
TRAIN, HOLD = {2021, 2022, 2023, 2024}, {2025, 2026}

# market -> (positions, volume column, production column, min prior volume to call it a sample)
MARKETS = {
    "rec_yds":  (["WR", "TE"], "targets", "receiving_yards", 25),
    "rush_yds": (["RB"], "carries", "rushing_yards", 40),
    "pass_yds": (["QB"], "attempts", "passing_yards", 150),
}


def load(season):
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return None
    d = pd.read_csv(path, low_memory=False)
    d = d[d.season_type == "REG"].copy()
    for c in ("targets", "carries", "attempts", "receiving_yards", "rushing_yards", "passing_yards"):
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0.0)
    return d


def main():
    data = {s: load(s) for s in SEASONS}

    for market, (positions, volc, prodc, minv) in MARKETS.items():
        print(f"\n{'=' * 78}\n{market}   ({'/'.join(positions)}, {prodc} per {volc[:-1]})\n{'=' * 78}")

        # --- persistence
        eff = {}
        for s in SEASONS:
            d = data.get(s)
            if d is None:
                continue
            dp = d[d.position.isin(positions)]
            g = dp.groupby("player_id").agg(v=(volc, "sum"), y=(prodc, "sum"))
            eff[s] = {str(i): (float(r.v), float(r.y)) for i, r in g.iterrows()}
        xs, ys = [], []
        for s in SEASONS[1:]:
            a, b = eff.get(s - 1, {}), eff.get(s, {})
            for k, (v1, y1) in a.items():
                if v1 >= minv and k in b and b[k][0] >= minv:
                    xs.append(y1 / v1)
                    ys.append(b[k][1] / b[k][0])
        r = np.corrcoef(xs, ys)[0, 1] if len(xs) > 40 else float("nan")
        print(f"  season-over-season persistence: r = {r:.3f}  (n={len(xs)}) "
              f" [rushing YPC was the 0.058 the founding rule is built on]")

        # --- per-game rows, volume held at ACTUAL so only the efficiency term varies
        rows = []
        for s in SEASONS:
            d = data.get(s)
            if d is None:
                continue
            prev = eff.get(s - 1, {})
            dp = d[d.position.isin(positions)]
            for _, x in dp.iterrows():
                if x[volc] <= 0:
                    continue
                pv, py = prev.get(str(x.player_id), (0.0, 0.0))
                rows.append({"season": s, "vol": float(x[volc]), "act": float(x[prodc]),
                             "prev_v": pv, "prev_y": py})
        df = pd.DataFrame(rows)
        tr, ho = df[df.season.isin(TRAIN)], df[df.season.isin(HOLD)]
        lg = tr["act"].sum() / tr["vol"].sum()
        print(f"  league rate from train: {lg:.3f} {prodc} per {volc[:-1]}\n")

        KS = [None, 2000, 1500, 1000, 700, 500, 300, 200, 120, 80, 50]

        def pred(sub, K):
            if K is None:
                return sub.vol.values * lg
            e = (sub.prev_y.values + lg * K) / (sub.prev_v.values + K)
            return sub.vol.values * e

        # bias spread, measured on players with a real prior sample
        def spread(sub, K):
            s2 = sub[sub.prev_v >= minv].copy()
            if len(s2) < 200:
                return float("nan")
            s2["own"] = s2.prev_y / s2.prev_v
            hi = s2[s2.own >= s2.own.quantile(2 / 3)]
            lo = s2[s2.own <= s2.own.quantile(1 / 3)]
            return float((pred(hi, K) - hi["act"].values).mean() - (pred(lo, K) - lo["act"].values).mean())

        print(f"  {'K':>8s} {'train MAE':>10s} {'train bias spread':>18s} "
              f"{'hold MAE':>9s} {'hold bias spread':>17s}")
        best_bias, best_k = None, None
        for K in KS:
            tm = float(np.abs(pred(tr, K) - tr["act"].values).mean())
            ts = spread(tr, K)
            hm = float(np.abs(pred(ho, K) - ho["act"].values).mean())
            hs = spread(ho, K)
            lab = "league" if K is None else str(K)
            flag = ""
            if not np.isnan(ts) and (best_bias is None or abs(ts) < best_bias):
                best_bias, best_k = abs(ts), K
            print(f"  {lab:>8s} {tm:10.3f} {ts:18.2f} {hm:9.3f} {hs:17.2f}{flag}")
        print(f"\n  K closest to an even-handed board on TRAIN: {best_k}")
        if best_k is not None:
            hm0 = float(np.abs(pred(ho, None) - ho["act"].values).mean())
            hmb = float(np.abs(pred(ho, best_k) - ho["act"].values).mean())
            print(f"  held-out MAE at that K: {hm0:.3f} (league) -> {hmb:.3f} "
                  f"({(hm0 - hmb) / hm0 * 100:+.2f}%), bias spread {spread(ho, None):.2f} -> "
                  f"{spread(ho, best_k):.2f}")


if __name__ == "__main__":
    main()
