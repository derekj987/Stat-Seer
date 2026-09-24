"""Should a team's RATING be corrected for who was missing in the games that built it?

Derek: "have we considered Michael Penix's return into our model spread and over/under yet?"

We had not, and the gap is structural rather than an oversight about one player. The model already
subtracts points for who is ruled out THIS week (analysis/injury_adj.py, QB -4.35 points per 100%
of pass attempts missing). But `ratings_asof` builds a team's rating from raw `home_score -
away_score` of its completed games, with no correction for who was missing in THOSE games. So:

    Atlanta played weeks 1 and 2 without Penix, lost ground in both, and carries a rating that
    says so. Penix returns in week 3 and the model adds nothing back — it is still pricing the
    team that played without him.

The correction is the same coefficients, applied in the other direction. If a team was weakened by
`adj` points in a past game, the margin it actually posted understates it by that much:

    observed = true + adj[home] - adj[away]   =>   true = observed - adj[home] + adj[away]

Accumulate the TRUE margin into the rating instead of the observed one, and a team is no longer
permanently marked down for games its starter missed.

This is a CORRECTION, not an edge claim — the same standing as injury_adj itself. It does not have
to beat the closing line to be worth having; it has to stop the published number being knowably
stale. But it does have to not make the model WORSE, which is what this measures.

    train 2017-2022    hold 2023-2025
    python analysis/ratings_injury_adj.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import game_model as gm  # noqa: E402
import injury_adj  # noqa: E402

TRAIN = range(2017, 2023)
HOLD = range(2023, 2026)


def adjusted_ratings(g, season, week, adj_by_week, shrink=1.0):
    """gm.ratings_asof, but each past game's margin is corrected for who was missing in it."""
    prior = gm.ratings(g, season - 1)
    k = gm.prior_k_for(week)
    s = g[(g.season == season) & (g.game_type == "REG") & g.home_score.notna() & (g.week < week)]
    cum, cnt = {}, {}
    for _, r in s.iterrows():
        m = r.home_score - r.away_score
        a = adj_by_week.get(int(r.week), {})
        # Undo the handicap each side was carrying in that game. shrink < 1 trusts the correction
        # only partly, which is the honest knob given the coefficients were fitted for a different
        # purpose (predicting a game, not de-noising a result).
        m = m - shrink * a.get(r.home_team, 0.0) + shrink * a.get(r.away_team, 0.0)
        for t, d in ((r.home_team, m), (r.away_team, -m)):
            cum[t] = cum.get(t, 0.0) + d
            cnt[t] = cnt.get(t, 0) + 1
    out = {}
    for t in set(prior) | set(cnt):
        p = prior.get(t, 0.0)
        n = cnt.get(t, 0)
        out[t] = p if n == 0 else (cum[t] + k * p) / (n + k)
    return out


def run(seasons, shrinks):
    g = gm.load("data/games.csv")
    rows = []
    for season in seasons:
        # Every week's adjustment once, reused for the ratings of every later week.
        adj_by_week = {}
        for wk in range(1, 23):
            try:
                adj_by_week[wk] = injury_adj.team_adjustment(season, wk)
            except Exception:  # noqa: BLE001
                adj_by_week[wk] = {}
        if not any(adj_by_week.values()):
            continue
        gs = g[(g.season == season) & (g.game_type == "REG") & g.home_score.notna()]
        for wk in sorted(gs.week.unique()):
            wk = int(wk)
            if wk < 2:
                continue                      # no completed games yet — nothing to correct
            base = gm.ratings_asof(g, season, wk)
            variants = {sh: adjusted_ratings(g, season, wk, adj_by_week, sh) for sh in shrinks}
            now = adj_by_week.get(wk, {})
            for _, r in gs[gs.week == wk].iterrows():
                h, a = r.home_team, r.away_team
                hfa = 0.0 if str(r.get("location")) == "Neutral" else gm.HFA
                actual = r.home_score - r.away_score
                rec = {"season": season, "week": wk, "actual": actual,
                       "market": (r.spread_line if pd.notna(r.get("spread_line")) else np.nan)}
                # The in-week adjustment is applied in every variant; only the RATINGS differ.
                bump = now.get(h, 0.0) - now.get(a, 0.0)
                rec["base"] = base.get(h, 0.0) - base.get(a, 0.0) + hfa + bump
                for sh, rt in variants.items():
                    rec[f"adj{sh}"] = rt.get(h, 0.0) - rt.get(a, 0.0) + hfa + bump
                rows.append(rec)
    return pd.DataFrame(rows)


def main():
    shrinks = [0.5, 1.0]
    print("Building TRAIN 2017-2022 …")
    tr = run(TRAIN, shrinks)
    print("Building HELD-OUT 2023-2025 …")
    ho = run(HOLD, shrinks)
    if tr.empty or ho.empty:
        print("no rows — injury data unavailable"); return

    def report(df, label):
        print(f"\n{label}  (n={len(df):,})")
        b = np.abs(df.base - df.actual).mean()
        print(f"  {'ratings as they are':28s} MAE {b:7.4f}")
        for sh in shrinks:
            m = np.abs(df[f"adj{sh}"] - df.actual).mean()
            print(f"  {'injury-adjusted, shrink ' + str(sh):28s} MAE {m:7.4f}  {(b - m) / b * 100:+6.2f}%")

    report(tr, "TRAIN 2017-2022")
    report(ho, "HELD-OUT 2023-2025")

    # Where it should bite hardest: a team whose earlier games were played shorthanded. Proxy it
    # with the size of the rating change the correction produces.
    print("\nHELD-OUT, by how much the correction MOVES the number")
    ho = ho.assign(move=(ho["adj1.0"] - ho.base).abs())
    for lo, hi, lab in ((0, 0.5, "< 0.5 pts"), (0.5, 1.5, "0.5-1.5"), (1.5, 3, "1.5-3"), (3, 99, "3+")):
        sub = ho[(ho.move >= lo) & (ho.move < hi)]
        if len(sub) < 30:
            continue
        b = np.abs(sub.base - sub.actual).mean()
        m = np.abs(sub["adj1.0"] - sub.actual).mean()
        print(f"  {lab:>10s}  n={len(sub):5,d}  MAE {b:7.3f} -> {m:7.3f}  {(b - m) / b * 100:+6.2f}%")

    print("\n  (for scale) market spread MAE on the same held-out games: "
          f"{np.abs(-ho.dropna(subset=['market']).market - ho.dropna(subset=['market']).actual).mean():.3f}")


if __name__ == "__main__":
    main()
