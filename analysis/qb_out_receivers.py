"""Do a team's receivers lose volume when the DEPTH-CHART QB1 is out? (Redo — the first test lied.)

Derek: "what about London with his main QB1 coming back in Michael Penix Jr? Does it take that into
consideration?"

I told him no, and that it did not matter, on the strength of a test that said a receiver loses
0.06 targets a game when his QB1 is out. That test was circular and its answer is worthless.

It defined QB1 as the team's SEASON-LEADING PASSER. Atlanta's leading passer in 2026 is Cooper Rush,
with 39 attempts, because Penix has not played — so Penix being ruled Out in weeks 1 and 2 was never
counted as "QB1 out" at all. The test systematically excluded exactly the severe cases it existed to
measure: a starter missing most of a season can never be that season's leading passer. Same shape as
the `injury_adj._shares` bug found the same day — a player's importance computed from a season he
was absent for.

This redoes it against the nflverse DEPTH CHART, which names a QB1 going into each week regardless
of who has thrown the most, and is knowable before kickoff.

    python analysis/qb_out_receivers.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from role_weight_backtest import ranks_by_week  # noqa: E402
import injury_adj as IA  # noqa: E402

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
OUT_LIKE = {"out", "doubtful"}


def main():
    rows = []
    for season in SEASONS:
        path = f"data/stats_{season}.csv"
        if not os.path.exists(path):
            continue
        st = pd.read_csv(path, low_memory=False)
        st = st[st.season_type == "REG"].copy()
        for c in ("targets", "attempts"):
            st[c] = pd.to_numeric(st.get(c), errors="coerce").fillna(0.0)
        st["week"] = pd.to_numeric(st.week, errors="coerce")
        charts = ranks_by_week(season)
        inj = IA._inj_for(season)
        if not charts or inj is None or not len(inj):
            continue
        # {(week, team): set of gsis ruled out/doubtful}
        outs = {}
        for _, r in inj.iterrows():
            if str(r.get("report_status") or "").strip().lower() not in OUT_LIKE:
                continue
            try:
                outs.setdefault((int(r.week), str(r.team)), set()).add(str(r.gsis_id))
            except Exception:  # noqa: BLE001
                continue
        wr = st[st.position.isin(["WR", "TE"])]
        for _, r in wr.iterrows():
            wk, team = int(r.week), str(r.team)
            chart = charts.get(wk) or charts.get(max((k for k in charts if k < wk), default=-1)) or {}
            qb1 = [pid for pid, (pos, rank) in chart.items() if pos == "QB" and rank == 1]
            # Only team-weeks where we can actually name a QB1 from the chart.
            if not qb1:
                continue
            sick = outs.get((wk, team), set())
            rows.append({"season": season, "pid": str(r.player_id), "team": team, "week": wk,
                         "tgt": float(r.targets),
                         "qb_out": 1 if any(q in sick for q in qb1) else 0})
    d = pd.DataFrame(rows)
    if d.empty:
        print("no rows"); return
    print(f"{len(d):,} receiver-weeks, {d.qb_out.sum():,} of them with the depth-chart QB1 out\n")

    g = d.groupby("pid").qb_out.agg(["min", "max", "count"])
    both = set(g[(g["min"] == 0) & (g["max"] == 1) & (g["count"] >= 8)].index)
    sub = d[d.pid.isin(both)]
    pv = sub.groupby(["pid", "qb_out"]).tgt.mean().unstack().dropna()
    print("WITHIN-PLAYER: same receiver, games with his QB1 vs without")
    print(f"  receivers seen in both states: {len(pv):,}")
    print(f"  targets/game with QB1 : {pv[0].mean():.2f}")
    print(f"  targets/game QB1 OUT  : {pv[1].mean():.2f}")
    print(f"  delta                 : {(pv[1] - pv[0]).mean():+.2f}  "
          f"(median {(pv[1] - pv[0]).median():+.2f})")

    print("\n  by how big a role he has (targets/game with his QB1):")
    print(f"  {'role':>18s} {'n':>5s} {'with QB1':>9s} {'QB1 out':>8s} {'delta':>7s} {'as %':>7s}")
    for lo, hi, lab in ((0, 3, "fringe (<3)"), (3, 5, "rotation (3-5)"),
                        (5, 7, "starter (5-7)"), (7, 99, "primary (7+)")):
        s2 = pv[(pv[0] >= lo) & (pv[0] < hi)]
        if len(s2) < 15:
            continue
        d0, d1 = s2[0].mean(), s2[1].mean()
        print(f"  {lab:>18s} {len(s2):5,d} {d0:9.2f} {d1:8.2f} {d1 - d0:+7.2f} "
              f"{(d1 / d0 - 1) * 100:+6.1f}%")


if __name__ == "__main__":
    main()
