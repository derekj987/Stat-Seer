"""The injury adjustment forgets a player who has been out all season. Measure the fix.

Derek: "have we considered Michael Penix's return into our model spread and over/under yet?"

Checking turned up something worse than a missing feature. `injury_adj._shares` computes each
player's share of his team's volume from CURRENT-SEASON games only, falling back to the prior
season just in week 1 (when the current-season frame is empty). So a starter who has been out since
the opener has no current-season volume, therefore no share, therefore no adjustment. Measured on
Atlanta, who were without Penix for weeks 1 and 2:

    week 1  ATL QB shares: Penix 0.51, Cousins 0.49      -> adjustment -2.20   (fires)
    week 2  ATL QB shares: Cooper Rush 1.00              -> adjustment  0.00   (silent)

The longer a starter is out, the more completely the model forgets he exists — and it is exactly
the long absences that move a line. The bug hides because the adjustment still works for a player
hurt in week 6, who by then has five games of share on the books.

THE FIX. Treat the prior season as K games of evidence about a player's role, the same shape the
rest of the project already uses (CUR_K in player_proj_export, PRIOR_K in game_model):

    blended_volume = current_volume + K * prior_per_game_rate

At week 1 that is the prior season alone, which is today's behaviour. Later it is mostly current
usage, but a player with no current usage keeps a share proportional to what he did last year
instead of collapsing to zero.

    train 2017-2022    hold 2023-2025
    python analysis/share_prior_sweep.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import game_model as gm  # noqa: E402
import injury_adj as IA  # noqa: E402

TRAIN, HOLD = range(2017, 2023), range(2023, 2026)
KS = [0.0, 2.0, 4.0, 6.0, 10.0]      # 0.0 == what ships today


def shares_blended(u, season, week, k):
    """{(team, pos): {player_id: share}} with the prior season worth `k` games of evidence."""
    if k <= 0:
        return IA._shares(u, season, week)
    cur = u[(u.season == season) & (u.week < week)]
    if cur.empty:
        return IA._shares(u, season, week)          # week 1 — prior season is all there is
    prev = u[u.season == season - 1]
    prev_games = max(int(prev.week.nunique()), 1) if not prev.empty else 1
    out = {}
    for pos, col in IA.VOLUME.items():
        c = cur[cur.position == pos]
        p = prev[prev.position == pos]
        if c.empty and p.empty:
            continue
        cv = c.groupby(["team", "player_id"], as_index=False)[col].sum() if not c.empty \
            else pd.DataFrame(columns=["team", "player_id", col])
        pv = p.groupby(["team", "player_id"], as_index=False)[col].sum() if not p.empty \
            else pd.DataFrame(columns=["team", "player_id", col])
        pv = pv.rename(columns={col: "prev"})
        # A player who changed teams is carried on the team the CURRENT season has him on where we
        # have one; otherwise on last season's, which is the only thing knowable for someone who
        # has not played yet.
        cur_team = dict(zip(cv.player_id, cv.team)) if len(cv) else {}
        pv["team"] = [cur_team.get(pid, tm) for pid, tm in zip(pv.player_id, pv.team)]
        m = pd.merge(cv, pv[["team", "player_id", "prev"]], on=["team", "player_id"], how="outer")
        m[col] = pd.to_numeric(m.get(col), errors="coerce").fillna(0.0)
        m["prev"] = pd.to_numeric(m.get("prev"), errors="coerce").fillna(0.0)
        m["blend"] = m[col] + k * (m["prev"] / prev_games)
        tot = m.groupby("team")["blend"].transform("sum")
        m["share"] = np.where(tot > 0, m["blend"] / tot, 0.0)
        for team, grp in m.groupby("team"):
            out[(team, pos)] = dict(zip(grp.player_id, grp.share))
    return out


def adjustment(season, week, k, u, inj):
    sh = shares_blended(u, season, week, k)
    wk = inj[inj.week == week]
    adj = {}
    for team, grp in wk.groupby("team"):
        ids = set(grp.gsis_id)
        pts = 0.0
        for pos, coef in IA.COEF.items():
            missing = sum(v for kk, v in sh.get((team, pos), {}).items()
                          if kk in ids and v >= IA.MIN_SHARE)
            pts += coef * missing
        if pts:
            adj[team] = pts
    return adj


def run(seasons):
    g = gm.load("data/games.csv")
    rows = []
    for season in seasons:
        u, inj = IA._usage_for(season), IA._inj_for(season)
        if u is None or inj is None or not len(inj):
            continue
        gs = g[(g.season == season) & (g.game_type == "REG") & g.home_score.notna()]
        adjs = {k: {wk: adjustment(season, wk, k, u, inj) for wk in sorted(gs.week.unique())}
                for k in KS}
        for wk in sorted(gs.week.unique()):
            wk = int(wk)
            base = gm.ratings_asof(g, season, wk)
            for _, r in gs[gs.week == wk].iterrows():
                h, a = r.home_team, r.away_team
                hfa = 0.0 if str(r.get("location")) == "Neutral" else gm.HFA
                raw = base.get(h, 0.0) - base.get(a, 0.0) + hfa
                rec = {"season": season, "week": wk, "actual": r.home_score - r.away_score}
                for k in KS:
                    ad = adjs[k][wk]
                    rec[f"k{k}"] = raw + ad.get(h, 0.0) - ad.get(a, 0.0)
                    rec[f"moved{k}"] = abs(ad.get(h, 0.0) - ad.get(a, 0.0))
                rows.append(rec)
    return pd.DataFrame(rows)


def main():
    print("Building TRAIN 2017-2022 …")
    tr = run(TRAIN)
    print("Building HELD-OUT 2023-2025 …")
    ho = run(HOLD)
    if tr.empty or ho.empty:
        print("no rows"); return

    def table(df, label):
        print(f"\n{label}  (n={len(df):,})")
        b = np.abs(df["k0.0"] - df.actual).mean()
        for k in KS:
            m = np.abs(df[f"k{k}"] - df.actual).mean()
            tag = "  <- ships today" if k == 0.0 else f"  {(b - m) / b * 100:+6.2f}%"
            print(f"  prior worth {k:4.1f} games   MAE {m:7.4f}{tag}")

    table(tr, "TRAIN 2017-2022")
    table(ho, "HELD-OUT 2023-2025")

    print("\nHELD-OUT, games the current code says are UNAFFECTED but the fix does not")
    print("  (i.e. adjustment 0 today — the forgotten-starter case)")
    sub = ho[(ho["moved0.0"] < 0.25) & (ho["moved4.0"] >= 1.0)]
    if len(sub) >= 20:
        b = np.abs(sub["k0.0"] - sub.actual).mean()
        for k in (2.0, 4.0, 6.0):
            m = np.abs(sub[f"k{k}"] - sub.actual).mean()
            print(f"  n={len(sub):,}  k={k:<4} MAE {b:7.3f} -> {m:7.3f}  {(b - m) / b * 100:+6.2f}%")
    else:
        print(f"  only {len(sub)} such games")

    print("\nHow often the adjustment is silent when it should not be (held-out):")
    for k in (2.0, 4.0):
        silent = ((ho["moved0.0"] < 0.25) & (ho[f"moved{k}"] >= 1.0)).mean() * 100
        print(f"  k={k}: {silent:.1f}% of games gain an adjustment of 1+ pt that today is ~0")


if __name__ == "__main__":
    main()
