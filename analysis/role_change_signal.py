"""Is there in-week ROLE-CHANGE information we already hold and throw away?

Derek: "Let's find a source for in-week role changes." Before buying or scraping anything, the
honest first question is whether the feeds already in the pipeline carry the signal. Two do, and
both are fully historical, so unlike a news wire they can be tested TODAY rather than captured for
six weeks and tested later:

  1. DEPTH-CHART MOVEMENT. nflverse publishes dated depth-chart snapshots (2021-24 one per week,
     2025+ timestamped). We only ever read the newest one and ask "what rank is he". We never ask
     "did his rank just CHANGE", which is the actual event.
  2. THE PRACTICE REPORT ON THE MAN AHEAD OF HIM. We store Out/Doubtful/Questionable per player in
     `practice_reports`, and use it to suppress the injured player's own projection. We never push
     his vacated volume DOWN the depth chart to the back-ups who inherit it.

The test is the same for both: our projection already recency-weights a player's own recent games
(HALF_LIFE = 2.5), which absorbs a role change one week late. So the question is not "does a
promotion predict volume" -- obviously it does -- but whether it predicts the part our estimator
gets WRONG:

    residual = actual_volume - our_estimate

If promoted players have a systematically positive residual, the signal is real and additive. If
the residual is flat, the recency weighting already has it and a news feed would buy us only the
one week of lead time.

Line-blind: depth charts, practice reports and box scores. No prices.

    python analysis/role_change_signal.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from role_weight_backtest import load_stats, ranks_by_week, ewma  # noqa: E402

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
CUR_K = 1.0
VOL = {"RB": "carries", "FB": "carries", "WR": "targets", "TE": "targets", "QB": "attempts"}


def build() -> pd.DataFrame:
    rows = []
    for s in SEASONS:
        d = load_stats(s)
        if d is None or d.empty:
            continue
        charts = ranks_by_week(s)
        if not charts:
            continue
        p = load_stats(s - 1)
        prior = {}
        if p is not None:
            g = p.groupby("player_id").agg(v=("vol", "sum"), n=("week", "nunique"))
            prior = {str(k): float(r.v / r.n) for k, r in g.iterrows() if r.n}
        hist: dict[str, list[float]] = {}
        wks = sorted(int(w) for w in d.week.dropna().unique())
        for wk in wks:
            def chart_for(w):
                if w in charts:
                    return charts[w]
                earlier = [k for k in charts if k <= w]
                return charts[max(earlier)] if earlier else {}

            now, was = chart_for(wk), chart_for(wk - 1)
            cur = d[d.week == wk]
            for _, r in cur.iterrows():
                pid, pos = str(r.player_id), str(r.position)
                past = hist.get(pid, [])
                if not past:
                    continue
                own = ewma(past)
                pm = prior.get(pid)
                if pm is not None:
                    own = (len(past) * own + CUR_K * pm) / (len(past) + CUR_K)
                a, b = now.get(pid), was.get(pid)
                if a is None or b is None:
                    continue
                rows.append({"season": s, "week": wk, "pos": pos, "pid": pid, "team": str(r.team),
                             "rank_now": a[1], "rank_prev": b[1], "move": b[1] - a[1],
                             "est": own, "actual": float(r.vol), "n": len(past)})
            for _, r in cur.iterrows():
                hist.setdefault(str(r.player_id), []).append(float(r.vol))
    return pd.DataFrame(rows)


def main():
    df = build()
    if df.empty:
        print("no rows"); return
    df["resid"] = df.actual - df.est
    print(f"{len(df):,} player-games with a depth-chart rank in both this week and last\n")

    print("DEPTH-CHART MOVEMENT vs the part our estimator gets WRONG")
    print("  move > 0 means he climbed the chart since last week\n")
    print(f"  {'move':>12s} {'rows':>7s} {'mean resid':>11s} {'median':>8s} {'actual':>8s} {'est':>8s}")
    for lo, hi, lab in ((-9, -2, "fell 2+"), (-1, -1, "fell 1"), (0, 0, "no change"),
                        (1, 1, "climbed 1"), (2, 9, "climbed 2+")):
        sub = df[(df.move >= lo) & (df.move <= hi)]
        if sub.empty:
            continue
        print(f"  {lab:>12s} {len(sub):7,d} {sub.resid.mean():+11.3f} {sub.resid.median():+8.3f}"
              f" {sub.actual.mean():8.2f} {sub.est.mean():8.2f}")

    print("\n  Same, RB only")
    rb = df[df.pos == "RB"]
    for lo, hi, lab in ((-9, -1, "fell"), (0, 0, "no change"), (1, 9, "climbed")):
        sub = rb[(rb.move >= lo) & (rb.move <= hi)]
        if len(sub) < 30:
            continue
        print(f"  {lab:>12s} {len(sub):7,d} {sub.resid.mean():+11.3f} {sub.resid.median():+8.3f}"
              f" {sub.actual.mean():8.2f} {sub.est.mean():8.2f}")

    print("\n  Climbed INTO the starting slot (rank_now == 1, was worse)")
    sub = df[(df.rank_now == 1) & (df.rank_prev > 1)]
    print(f"  n={len(sub):,}  mean resid {sub.resid.mean():+.3f}  actual {sub.actual.mean():.2f}"
          f"  est {sub.est.mean():.2f}")
    for pos in ("RB", "WR", "TE", "QB"):
        s2 = sub[sub.pos == pos]
        if len(s2) >= 25:
            print(f"     {pos:3s} n={len(s2):4,d}  resid {s2.resid.mean():+7.3f}"
                  f"  actual {s2.actual.mean():6.2f} vs est {s2.est.mean():6.2f}")

    print("\n  How OFTEN does the chart move at all? (the ceiling on this signal)")
    for pos in ("RB", "WR", "TE", "QB"):
        s2 = df[df.pos == pos]
        if s2.empty:
            continue
        moved = (s2.move != 0).mean() * 100
        up1 = (s2.rank_now == 1) & (s2.rank_prev > 1)
        print(f"     {pos:3s} n={len(s2):6,d}  chart moved {moved:5.1f}% of player-weeks,"
              f"  promoted to starter {up1.sum():4d} ({up1.mean() * 100:4.2f}%)")

    df.to_csv("data/_role_change_signal.csv", index=False)
    print(f"\nwrote data/_role_change_signal.csv ({len(df):,} rows)")


if __name__ == "__main__":
    main()
