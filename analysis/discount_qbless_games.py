"""Should a receiver's games played WITHOUT his QB1 count less when projecting a game WITH him?

Derek, on the week-3 board: "what about London with his main QB1 coming back in Michael Penix Jr?"
and then, repeatedly, that the big receivers all read under.

The board as a whole is now calibrated — on the shipped numbers, sd(line) 19.4 vs sd(ours) 19.4 and
slope(ours ~ line) 0.904, so at a 65-yard line we publish 61.5, about 5% under. ATL @ GB is nothing
like that:

    Drake London   line 65.5   ours 45.5   -30%
    Kyle Pitts     line 36.5   ours 24.6   -33%
    Tucker Kraft   line 46.5   ours 34.0   -27%

Those are driven by real collapses in target volume — London 4.5 per game this season against 9.3
last, Pitts 2.0 against 6.9. But EVERY game in that sample was played without Atlanta's QB1: Penix
was Out in weeks 1 and 2, Tua was Doubtful, and a journeyman started. Our estimator treats those two
games as ordinary evidence of London's current role, and Penix is back.

The question is not whether a back-up QB costs receivers volume on average — that was measured at
-6.9% for primaries, small. It is whether games played WITHOUT the QB1 are LESS PREDICTIVE of games
played WITH him. If they are, they should carry less weight, and no average effect size is needed.

    target:   a receiver-game where the depth-chart QB1 DID play
    estimate: EWMA of his past games, with QB1-less games down-weighted by W
    W = 1.0 is what ships (no discount); W = 0 ignores them entirely

    train 2021-2024   hold 2025-2026
    python analysis/discount_qbless_games.py
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
TRAIN, HOLD = {2021, 2022, 2023, 2024}, {2025, 2026}
HALF_LIFE = 2.5
WS = [1.0, 0.75, 0.5, 0.35, 0.2, 0.0]


def build():
    rows = []
    for season in SEASONS:
        path = f"data/stats_{season}.csv"
        if not os.path.exists(path):
            continue
        st = pd.read_csv(path, low_memory=False)
        st = st[st.season_type == "REG"].copy()
        st["targets"] = pd.to_numeric(st.get("targets"), errors="coerce").fillna(0.0)
        st["week"] = pd.to_numeric(st.week, errors="coerce")
        charts, inj = ranks_by_week(season), IA._inj_for(season)
        if not charts or inj is None or not len(inj):
            continue
        outs = {}
        for _, r in inj.iterrows():
            if str(r.get("report_status") or "").strip().lower() not in ("out", "doubtful"):
                continue
            try:
                outs.setdefault((int(r.week), str(r.team)), set()).add(str(r.gsis_id))
            except Exception:  # noqa: BLE001
                continue

        def qb1_out(wk, team):
            chart = charts.get(wk) or charts.get(max((k for k in charts if k < wk), default=-1)) or {}
            q = [pid for pid, (pos, rank) in chart.items() if pos == "QB" and rank == 1]
            if not q:
                return None                      # cannot tell — excluded from both sides
            sick = outs.get((wk, str(team)), set())
            return any(x in sick for x in q)

        wr = st[st.position.isin(["WR", "TE"])]
        hist: dict[str, list[tuple[float, bool]]] = {}
        for wk in sorted(int(w) for w in wr.week.dropna().unique()):
            cur = wr[wr.week == wk]
            for _, r in cur.iterrows():
                pid = str(r.player_id)
                past = hist.get(pid, [])
                miss = qb1_out(wk, r.team)
                # Only games the QB1 actually PLAYED are targets: the question is what predicts a
                # healthy-offence game, which is what the board is projecting.
                if miss is False and len(past) >= 3:
                    rows.append({"season": season, "past": tuple(past), "actual": float(r.targets)})
            for _, r in cur.iterrows():
                m = qb1_out(wk, r.team)
                if m is None:
                    continue
                hist.setdefault(str(r.player_id), []).append((float(r.targets), bool(m)))
    return pd.DataFrame(rows)


def est(past, w):
    lam = 0.5 ** (1.0 / HALF_LIFE)
    n = len(past)
    num = den = 0.0
    for i, (v, was_out) in enumerate(past):
        rec = lam ** (n - 1 - i)
        wt = rec * (w if was_out else 1.0)
        num += wt * v
        den += wt
    return num / den if den > 0 else float(np.mean([v for v, _ in past]))


def main():
    df = build()
    if df.empty:
        print("no rows"); return
    tr, ho = df[df.season.isin(TRAIN)], df[df.season.isin(HOLD)]
    print(f"target games (QB1 played, 3+ prior games): train {len(tr):,}  held-out {len(ho):,}\n")

    # Only rows that actually CONTAIN a QB1-less game can move; report both so the dilution is clear.
    def has_missing(p):
        return any(m for _, m in p)
    trm = tr[[has_missing(p) for p in tr.past]]
    hom = ho[[has_missing(p) for p in ho.past]]
    print(f"of those, rows whose history includes a QB1-less game: "
          f"train {len(trm):,}  held-out {len(hom):,}\n")

    print(f"  {'discount W':>11s} {'train MAE':>10s} {'train (affected)':>17s} "
          f"{'hold MAE':>9s} {'hold (affected)':>16s}")
    best, bw = None, 1.0
    for w in WS:
        a = float(np.abs([est(p, w) for p in tr.past] - tr.actual.values).mean())
        b = float(np.abs([est(p, w) for p in trm.past] - trm.actual.values).mean()) if len(trm) else float("nan")
        c = float(np.abs([est(p, w) for p in ho.past] - ho.actual.values).mean())
        d = float(np.abs([est(p, w) for p in hom.past] - hom.actual.values).mean()) if len(hom) else float("nan")
        if best is None or b < best:
            best, bw = b, w
        print(f"  {w:11.2f} {a:10.4f} {b:17.4f} {c:9.4f} {d:16.4f}")
    print(f"\n  best on the affected TRAIN rows: W = {bw}")
    if len(hom):
        base = float(np.abs([est(p, 1.0) for p in hom.past] - hom.actual.values).mean())
        new = float(np.abs([est(p, bw) for p in hom.past] - hom.actual.values).mean())
        print(f"  held-out, affected rows only: {base:.4f} -> {new:.4f} "
              f"({(base - new) / base * 100:+.2f}%)")


if __name__ == "__main__":
    main()
