"""Fit the two in-week role-change corrections we can already measure.

role_change_signal.py established that depth-chart MOVEMENT predicts the part our volume estimator
gets wrong. This fits both candidate corrections properly -- chosen on train 2021-24, confirmed on
held-out 2025-26 -- so nothing ships on a number that was allowed to pick itself.

  A. CHART MOVEMENT. A player who climbed the depth chart since last week beats our estimate; one
     who fell undershoots it. Our estimator recency-weights his own games, so it catches a role
     change ONE WEEK LATE; the chart moves before that game is played.

  B. VACATED VOLUME. When the man ahead of him is ruled Out, his volume has to go somewhere. We
     already hold the injury report (18 seasons of it) and already use it to SUPPRESS the injured
     player's own projection -- we have never pushed his workload down to the players who inherit
     it. This is the bigger of the two if it holds: an Out starter is a far larger event than a
     one-slot chart nudge, and the report lands Wednesday through Friday, before kickoff.

Both are line-blind: depth charts, injury reports and box scores. No prices anywhere.

    python analysis/role_change_fit.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from role_weight_backtest import load_stats, ranks_by_week, ewma  # noqa: E402

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
TRAIN, HOLD = {2021, 2022, 2023, 2024}, {2025, 2026}
CUR_K = 1.0
OUT_STATUS = {"out"}                       # Doubtful tested separately below
GROUP = {"RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "QB": "QB"}


def injuries(season: int) -> dict[tuple[int, str], set[str]]:
    """{(week, team): {gsis_id ruled Out}} from the weekly injury report."""
    path = f"data/inj_{season}.csv"
    if not os.path.exists(path):
        return {}
    d = pd.read_csv(path, low_memory=False)
    # Older seasons of this release have no season_type column at all; guard rather than assume,
    # because `d.season_type` on a frame that lacks it raises, and an early season silently
    # dropping out of the fit would be worse than the crash.
    if "season_type" in d.columns:
        d = d[d.season_type == "REG"]
    out: dict[tuple[int, str], set[str]] = {}
    for _, r in d.iterrows():
        st = str(r.get("report_status") or "").strip().lower()
        if st not in OUT_STATUS or pd.isna(r.get("gsis_id")):
            continue
        try:
            wk = int(r.week)
        except Exception:  # noqa: BLE001
            continue
        out.setdefault((wk, str(r.team)), set()).add(str(r.gsis_id))
    return out


def build() -> pd.DataFrame:
    rows = []
    for s in SEASONS:
        d = load_stats(s)
        if d is None or d.empty:
            continue
        charts, inj = ranks_by_week(s), injuries(s)
        if not charts:
            continue
        p = load_stats(s - 1)
        prior = {}
        if p is not None:
            g = p.groupby("player_id").agg(v=("vol", "sum"), n=("week", "nunique"))
            prior = {str(k): float(r.v / r.n) for k, r in g.iterrows() if r.n}
        hist: dict[str, list[float]] = {}
        est_by_pid: dict[str, float] = {}      # last computed estimate, for the vacated-volume sum
        pos_by_pid: dict[str, str] = {}
        team_by_pid: dict[str, str] = {}
        for wk in sorted(int(w) for w in d.week.dropna().unique()):
            def chart_for(w):
                if w in charts:
                    return charts[w]
                earlier = [k for k in charts if k <= w]
                return charts[max(earlier)] if earlier else {}

            now, was = chart_for(wk), chart_for(wk - 1)
            cur = d[d.week == wk]

            batch = []
            for _, r in cur.iterrows():
                pid, pos, team = str(r.player_id), str(r.position), str(r.team)
                past = hist.get(pid, [])
                if not past:
                    continue
                own = ewma(past)
                pm = prior.get(pid)
                if pm is not None:
                    own = (len(past) * own + CUR_K * pm) / (len(past) + CUR_K)
                est_by_pid[pid] = own
                pos_by_pid[pid], team_by_pid[pid] = pos, team
                a, b = now.get(pid), was.get(pid)
                batch.append({"season": s, "week": wk, "pos": pos, "pid": pid, "team": team,
                              "rank_now": a[1] if a else None,
                              "move": (b[1] - a[1]) if (a and b) else 0,
                              "est": own, "actual": float(r.vol), "n": len(past)})

            # Vacated volume: same team, same position group, ruled Out this week, and NOT playing.
            playing = {str(x) for x in cur.player_id}
            for row in batch:
                sick = inj.get((wk, row["team"]), set())
                vac = 0.0
                for opid in sick:
                    if opid in playing or opid == row["pid"]:
                        continue
                    if GROUP.get(pos_by_pid.get(opid, ""), "") != GROUP.get(row["pos"], "?"):
                        continue
                    if team_by_pid.get(opid) != row["team"]:
                        continue
                    vac += est_by_pid.get(opid, 0.0)
                row["vacated"] = vac
            rows += batch
            for _, r in cur.iterrows():
                hist.setdefault(str(r.player_id), []).append(float(r.vol))
    return pd.DataFrame(rows)


def main():
    df = build()
    df["resid"] = df.actual - df.est
    df["climb"] = df.move.clip(lower=0).clip(upper=2)
    df["drop"] = (-df.move).clip(lower=0).clip(upper=2)
    tr, ho = df[df.season.isin(TRAIN)], df[df.season.isin(HOLD)]
    print(f"train {len(tr):,}   held-out {len(ho):,}\n")

    print("B. VACATED VOLUME -- a same-position team-mate ruled OUT (train 2021-24)")
    print(f"  {'vacated':>14s} {'rows':>7s} {'mean resid':>11s} {'actual':>8s} {'est':>8s}")
    for lo, hi, lab in ((0, 0.001, "none"), (0.001, 3, "0-3"), (3, 7, "3-7"),
                        (7, 12, "7-12"), (12, 99, "12+")):
        sub = tr[(tr.vacated >= lo) & (tr.vacated < hi)]
        if len(sub) < 30:
            continue
        print(f"  {lab:>14s} {len(sub):7,d} {sub.resid.mean():+11.3f}"
              f" {sub.actual.mean():8.2f} {sub.est.mean():8.2f}")

    print("\n  by position, any vacated volume vs none (train)")
    for pos in ("RB", "WR", "TE", "QB"):
        a = tr[(tr.pos == pos) & (tr.vacated > 0)]
        b = tr[(tr.pos == pos) & (tr.vacated == 0)]
        if len(a) < 40:
            continue
        print(f"     {pos:3s} vacated>0 n={len(a):5,d} resid {a.resid.mean():+6.3f}"
              f"   none n={len(b):6,d} resid {b.resid.mean():+6.3f}")

    # Fit both corrections jointly on TRAIN by least squares, with no intercept beyond a constant.
    feats = ["climb", "drop", "vacated"]
    X = np.column_stack([tr[f].values for f in feats] + [np.ones(len(tr))])
    beta, *_ = np.linalg.lstsq(X, tr.resid.values, rcond=None)
    print("\nFITTED ON TRAIN (coefficients on the residual our estimator leaves):")
    for f, b in zip(feats + ["const"], beta):
        print(f"  {f:10s} {b:+.4f}")

    def apply(sub):
        Xs = np.column_stack([sub[f].values for f in feats] + [np.ones(len(sub))])
        return sub.est.values + Xs @ beta

    print("\nHELD-OUT 2025-2026")
    base = np.abs(ho.est.values - ho.actual.values).mean()
    new = np.abs(apply(ho) - ho.actual.values).mean()
    print(f"  all rows       n={len(ho):6,d}  MAE {base:.4f} -> {new:.4f}  {(base - new) / base * 100:+5.2f}%")
    for lab, sub in (("chart moved", ho[ho.move != 0]),
                     ("promoted to 1", ho[(ho.rank_now == 1) & (ho.move > 0)]),
                     ("vacated > 0", ho[ho.vacated > 0]),
                     ("vacated > 5", ho[ho.vacated > 5]),
                     ("RB, vacated>5", ho[(ho.pos == "RB") & (ho.vacated > 5)])):
        if len(sub) < 30:
            continue
        b = np.abs(sub.est.values - sub.actual.values).mean()
        n2 = np.abs(apply(sub) - sub.actual.values).mean()
        bb = (sub.est.values - sub.actual.values).mean()
        nb = (apply(sub) - sub.actual.values).mean()
        print(f"  {lab:14s} n={len(sub):6,d}  MAE {b:.4f} -> {n2:.4f}  {(b - n2) / b * 100:+5.2f}%"
              f"   bias {bb:+6.3f} -> {nb:+6.3f}")

    print("\n  how much of the board does this touch?")
    for lab, m in (("chart moved", ho.move != 0), ("vacated > 0", ho.vacated > 0),
                   ("either", (ho.move != 0) | (ho.vacated > 0))):
        print(f"     {lab:14s} {m.mean() * 100:5.2f}% of player-weeks")

    df.to_csv("data/_role_change_fit.csv", index=False)
    print(f"\nwrote data/_role_change_fit.csv ({len(df):,} rows)")


if __name__ == "__main__":
    main()
