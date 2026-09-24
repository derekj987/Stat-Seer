"""Out-of-sample backtest of VOLUME estimators — the input everything else multiplies through.

Derek, looking at tonight's GB backfield: "Kaleb Johnson is projected to be Green Bay's starter
and get a bulk of the carries. We cannot look at his career % and need to predict his carries and
volume better."

He is right, and tracing the pipeline showed three separate things going wrong at once:

  1. `blend_current` sets `games = prior_games + current_games`, and `apply_role` then uses that
     as the weight on the player's own volume. So the count that decides "how much do I trust
     what this player has done in his CURRENT role" is mostly a count of games in his OLD role.
     MarShawn Lloyd (no prior row, games=2) got pulled 86% of the way to the RB1 median; Kaleb
     Johnson (games=12) sat at 50% own — the opposite of what the evidence supports.

  2. The season-to-date rate is a SIMPLE MEAN. Johnson carried 0 times in week 1 and 8 in week 2.
     The mean is 4. For a player whose role is changing — exactly the case here — averaging the
     old role with the new one is the worst available estimator.

  3. The depth-chart rank is a stale weekly snapshot and it is the DOMINANT term for precisely
     the players whose role just moved.

This script measures estimators against what players actually did, so the fix is chosen rather
than argued. For each (season, week>=2) it predicts that week's volume from data available
strictly before it, for every player who played.

    RB -> carries | WR/TE -> targets | QB -> attempts

Line-blind throughout: every estimator reads box scores and our own depth chart, never a price.

    python analysis/volume_backtest.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]
VOL = {"RB": "carries", "FB": "carries", "WR": "targets", "TE": "targets", "QB": "attempts"}
CUR_K = 1.5           # what ships today
MIN_TEAM_GAMES = 1


def load(season: int) -> pd.DataFrame | None:
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return None
    d = pd.read_csv(path, low_memory=False)
    d = d[(d.season_type == "REG") & d.position.isin(VOL)].copy()
    for c in ("carries", "targets", "attempts"):
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0.0)
    d["vol"] = [r[VOL[p]] for r, p in zip(d.to_dict("records"), d.position)]
    d["week"] = pd.to_numeric(d.week, errors="coerce")
    return d[["player_id", "player_display_name", "position", "team", "week", "vol"]]


def prior_means(d: pd.DataFrame | None) -> dict[str, float]:
    """Per-game volume in the completed prior season, per player id."""
    if d is None:
        return {}
    g = d.groupby("player_id").agg(v=("vol", "sum"), n=("week", "nunique"))
    return {str(k): float(r.v / r.n) for k, r in g.iterrows() if r.n}


def ewma(vals: list[float], half_life: float) -> float:
    """Recency-weighted mean, most recent game last. half_life in games."""
    if not vals:
        return 0.0
    lam = 0.5 ** (1.0 / half_life)
    w = np.array([lam ** i for i in range(len(vals) - 1, -1, -1)], dtype=float)
    return float(np.dot(w, vals) / w.sum())


def run() -> None:
    data = {s: load(s) for s in SEASONS}
    rows: list[dict] = []

    for s in SEASONS:
        d = data.get(s)
        if d is None or d.empty:
            continue
        prior = prior_means(data.get(s - 1))
        # team volume per week, for the share-based estimators
        tw = d.groupby(["team", "week"], as_index=False)["vol"].sum().rename(columns={"vol": "tvol"})
        tvol = {(str(r.team), int(r.week)): float(r.tvol) for _, r in tw.iterrows()}

        hist: dict[str, list[float]] = {}          # player -> volumes, in week order
        thist: dict[str, list[float]] = {}         # team   -> team volumes, in week order
        for wk in sorted(d.week.dropna().unique()):
            wk = int(wk)
            cur = d[d.week == wk]
            for _, r in cur.iterrows():
                pid, pos, team = str(r.player_id), str(r.position), str(r.team)
                past = hist.get(pid, [])
                n = len(past)
                if n == 0:                          # nothing this season yet — week 1, skip
                    continue
                tpast = thist.get(team, [])
                if len(tpast) < MIN_TEAM_GAMES:
                    continue
                pr = prior.get(pid)
                std_mean = float(np.mean(past))
                std_ew2 = ewma(past, 2.0)
                std_ew3 = ewma(past, 3.0)
                last = past[-1]
                team_mean = float(np.mean(tpast))
                team_now = tvol.get((team, wk), team_mean)

                def blend(v: float) -> float:
                    return v if pr is None else (n * v + CUR_K * pr) / (n + CUR_K)

                # share of the team's volume, blended the same way, x the team's own mean volume
                shares = [v / t if t else 0.0 for v, t in zip(past, tpast[-n:])]
                sh_mean = float(np.mean(shares))
                sh_ew2 = ewma(shares, 2.0)
                pr_share = None
                if pr is not None and team_mean > 0:
                    pr_share = pr / team_mean

                def blend_sh(v: float) -> float:
                    return v if pr_share is None else (n * v + CUR_K * pr_share) / (n + CUR_K)

                rows.append({
                    "season": s, "week": wk, "pos": pos, "n": n, "actual": float(r.vol),
                    "A_prior":      pr if pr is not None else std_mean,
                    "B_current":    blend(std_mean),          # what ships today
                    "C_ewma2":      blend(std_ew2),
                    "C_ewma3":      blend(std_ew3),
                    "D_last":       blend(last),
                    "E_share":      blend_sh(sh_mean) * team_mean,
                    "F_share_ew2":  blend_sh(sh_ew2) * team_mean,
                    "G_share_ew2_tn": blend_sh(sh_ew2) * team_now,   # oracle team volume, ceiling
                })
            for _, r in cur.iterrows():
                hist.setdefault(str(r.player_id), []).append(float(r.vol))
            for t, v in cur.groupby("team")["vol"].sum().items():
                thist.setdefault(str(t), []).append(float(v))

    df = pd.DataFrame(rows)
    if df.empty:
        print("no rows"); return
    ests = [c for c in df.columns if c.split("_")[0] in list("ABCDEFG") and c != "actual"]

    def table(sub: pd.DataFrame, title: str) -> None:
        print(f"\n{title}  (n={len(sub):,})")
        print(f"  {'estimator':16s} {'MAE':>7s} {'bias':>8s}")
        base = float(np.abs(sub["B_current"] - sub.actual).mean())
        for e in ests:
            mae = float(np.abs(sub[e] - sub.actual).mean())
            bias = float((sub[e] - sub.actual).mean())
            mark = "  <- ships today" if e == "B_current" else (
                f"  {(base - mae) / base * 100:+5.1f}%" if mae != base else "")
            print(f"  {e:16s} {mae:7.3f} {bias:+8.3f}{mark}")

    table(df, "ALL POSITIONS")
    for pos in ("RB", "WR", "TE", "QB"):
        sub = df[df.pos == pos]
        if len(sub) > 200:
            table(sub, f"{pos}  ({VOL[pos]})")

    print("\n\nBY GAMES OF CURRENT-SEASON EVIDENCE  (MAE)")
    print(f"  {'n games':>8s} {'rows':>7s} " + " ".join(f"{e:>13s}" for e in ests))
    for lo, hi, lab in ((1, 1, "1"), (2, 2, "2"), (3, 4, "3-4"), (5, 8, "5-8"), (9, 99, "9+")):
        sub = df[(df.n >= lo) & (df.n <= hi)]
        if sub.empty:
            continue
        cells = " ".join(f"{np.abs(sub[e] - sub.actual).mean():13.3f}" for e in ests)
        print(f"  {lab:>8s} {len(sub):7,d} {cells}")

    # The case Derek is pointing at: a player whose role CHANGED. Proxy for "role just moved" that
    # uses no future information — his last game differed sharply from his earlier ones.
    print("\n\nROLE-CHANGE SUBSET  (last game >= 2x his prior season-to-date mean, and >= 3 volume)")
    df2 = df.copy()
    sub = df2[(df2.D_last > 0) & (df2.n >= 1)]
    # reconstruct the flag from the estimators we stored: D_last is the blended last game,
    # B_current the blended mean; their ratio carries the same signal without extra state.
    flag = (sub.D_last >= 2.0 * sub.B_current.clip(lower=0.5)) & (sub.D_last >= 3.0)
    table(sub[flag], "  role stepped UP")
    flag2 = (sub.D_last <= 0.5 * sub.B_current) & (sub.B_current >= 3.0)
    table(sub[flag2], "  role stepped DOWN")

    out = "data/_volume_backtest.csv"
    df.to_csv(out, index=False)
    print(f"\nwrote {out}  ({len(df):,} player-games)")


if __name__ == "__main__":
    run()
