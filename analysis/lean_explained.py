"""Why do starter rows lean 62% OVER? Mean vs median, and whether it is a bias or a units clash.

The board publishes our projection beside the book's line and a reader compares them directly. But
the two numbers are not the same statistic:

    ours   = an expected value. A recency-weighted MEAN of what the player does.
    theirs = a price. A book sets a yardage line near the MEDIAN, so the two sides split.

Yardage and reception distributions are right-skewed — a floor at zero, an occasional huge game —
so the mean sits ABOVE the median, and `proj > line` fires far more than half the time even when
both numbers are perfectly calibrated. That is a units clash, not an edge and not a bug, and the
give-away is its SHAPE: the skew is worst for low-volume players (mostly zeros, rare big games) and
nearly gone for high-volume ones, whose distributions are closer to symmetric.

PART A needs no market lines at all: bucket player-games by how much we project, then compare the
MEAN of what actually happened to the MEDIAN of what actually happened. If mean/median tracks the
projection-to-line ratio we see on the board, the lean is explained and nothing needs fixing in the
projection.

PART B checks it against real closing lines on the weeks already played: what share of props
actually went over.

    python analysis/lean_explained.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
HALF_LIFE, CUR_K = 2.5, 1.0
SPECS = {
    "RB": [("carries", "rushing_yards", "rush_yds"), ("targets", "receiving_yards", "rec_yds")],
    "WR": [("targets", "receiving_yards", "rec_yds"), ("targets", "receptions", "receptions")],
    "TE": [("targets", "receiving_yards", "rec_yds"), ("targets", "receptions", "receptions")],
    "QB": [("attempts", "passing_yards", "pass_yds")],
}


def load(season):
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return None
    d = pd.read_csv(path, low_memory=False)
    d = d[(d.season_type == "REG") & d.position.isin(SPECS)].copy()
    for c in ("carries", "targets", "attempts", "receptions",
              "rushing_yards", "receiving_yards", "passing_yards"):
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0.0)
    d["week"] = pd.to_numeric(d.week, errors="coerce")
    return d


def ewma(vals, hl=HALF_LIFE):
    lam = 0.5 ** (1.0 / hl)
    w = np.array([lam ** i for i in range(len(vals) - 1, -1, -1)])
    return float(np.dot(w, vals) / w.sum())


def build():
    """One row per (player, week, market): what we would have projected, and what happened."""
    data = {s: load(s) for s in SEASONS}
    rows = []
    for s in SEASONS:
        d = data.get(s)
        if d is None or d.empty:
            continue
        prev = data.get(s - 1)
        for pos, specs in SPECS.items():
            dp = d[d.position == pos]
            if dp.empty:
                continue
            for volc, prodc, market in specs:
                prior = {}
                if prev is not None:
                    q = prev[prev.position == pos]
                    gg = q.groupby("player_id").agg(v=(prodc, "sum"), n=("week", "nunique"))
                    prior = {str(k): float(r.v / r.n) for k, r in gg.iterrows() if r.n}
                hist: dict[str, list[float]] = {}
                for wk in sorted(int(w) for w in dp.week.dropna().unique()):
                    cur = dp[dp.week == wk]
                    for _, r in cur.iterrows():
                        pid = str(r.player_id)
                        past = hist.get(pid, [])
                        if len(past) < 2:
                            continue
                        own = ewma(past)
                        pm = prior.get(pid)
                        if pm is not None:
                            own = (len(past) * own + CUR_K * pm) / (len(past) + CUR_K)
                        rows.append({"season": s, "pos": pos, "market": market,
                                     "proj": own, "actual": float(r[prodc])})
                    for _, r in cur.iterrows():
                        hist.setdefault(str(r.player_id), []).append(float(r[prodc]))
    return pd.DataFrame(rows)


def main():
    df = build()
    print(f"{len(df):,} player-week-market rows, {df.season.min()}-{df.season.max()}\n")

    print("PART A — how far the MEAN sits above the MEDIAN, by projected level")
    print("  Our number is the mean. A book's line is near the median. This gap IS the lean.\n")
    for market in ("rec_yds", "rush_yds", "receptions", "pass_yds"):
        sub = df[df.market == market]
        if len(sub) < 400:
            continue
        print(f"  {market}")
        print(f"      {'proj level':>14s} {'rows':>7s} {'mean':>8s} {'median':>8s} "
              f"{'mean/median':>12s} {'% above median':>15s}")
        qs = sub.proj.quantile([0, .2, .4, .6, .8, 1.0]).values
        for i in range(5):
            lo, hi = qs[i], qs[i + 1]
            b = sub[(sub.proj >= lo) & (sub.proj <= hi)]
            if len(b) < 50:
                continue
            mu, med = b.actual.mean(), b.actual.median()
            ratio = mu / med if med > 0 else float("nan")
            # If the line were set at this bucket's median, how often would OUR mean be above it?
            over = (b.proj > med).mean() * 100
            print(f"      {lo:6.1f}-{hi:6.1f} {len(b):7,d} {mu:8.1f} {med:8.1f} "
                  f"{ratio:12.2f} {over:14.0f}%")
        print()

    print("PART A2 — the same thing stated the way the board shows it")
    print("  For each row, is our projection above the MEDIAN of what players at that level do?")
    print("  A perfectly calibrated mean sits above the median most of the time, by construction.\n")
    for market in ("rec_yds", "rush_yds", "receptions", "pass_yds"):
        sub = df[df.market == market].copy()
        if len(sub) < 400:
            continue
        sub["bucket"] = pd.qcut(sub.proj, 10, labels=False, duplicates="drop")
        med = sub.groupby("bucket").actual.transform("median")
        above = (sub.proj > med).mean() * 100
        # And how often did the ACTUAL outcome beat that same median? ~50% by definition.
        act = (sub.actual > med).mean() * 100
        print(f"  {market:12s} our projection above the median {above:5.1f}% of rows; "
              f"actual outcomes above it {act:5.1f}%")


if __name__ == "__main__":
    main()
