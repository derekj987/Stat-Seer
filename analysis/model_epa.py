"""
Did the omitted attributes matter?

The Week 1 model used four inputs: prior-season opponent-adjusted MARGIN, home
field advantage, offseason shrinkage, and prior-season points for totals.

Two things I recommended earlier and then did not implement:

  1. OPPONENT-ADJUSTED EPA instead of margin. Stated earlier: "EPA per play,
     opponent-adjusted, is the workhorse. Points and yards are both worse."
     The model used raw margins.

  2. LUCK-STRIPPING. Stated earlier: "explicitly decomposing performance into
     persistent and non-persistent components, then regressing the
     non-persistent part aggressively, is probably the highest-return modelling
     decision on this list." Not done. Raw margins contain fumble-recovery luck,
     turnover luck, and garbage time.

This script builds three ratings on identical folds and asks whether either fix
closes the gap to the market:

  A  margin-based        (what shipped)
  B  EPA-based
  C  EPA + turnover-luck adjustment

Sample: weeks 1-6, 2017-2025 -- the window where model A demonstrably lost to
the market (n=925, market MAE 9.85 vs model 10.07).
"""
import numpy as np
import pandas as pd
from scipy import stats

SEASONS_T = range(2016, 2026)
SHRINK = 0.62
HFA = 1.6


def load_games():
    g = pd.read_csv("../data/games.csv", low_memory=False)
    g = g[g.game_type == "REG"].copy()
    g["margin"] = g.home_score - g.away_score
    return g


def load_team_stats():
    fr = []
    for y in SEASONS_T:
        d = pd.read_csv(f"../data/tstats_{y}.csv", low_memory=False)
        if "season_type" in d.columns:
            d = d[d.season_type == "REG"]
        keep = ["season", "week", "team", "passing_epa", "rushing_epa",
                "passing_interceptions", "fumbles_lost_total",
                "def_interceptions", "def_fumbles",
                "fumble_recovery_own", "fumbles_total"]
        keep = [c for c in keep if c in d.columns]
        fr.append(d[keep])
    t = pd.concat(fr, ignore_index=True)
    for c in t.columns:
        if c not in ("team",):
            t[c] = pd.to_numeric(t[c], errors="coerce")
    t["off_epa"] = t.passing_epa.fillna(0) + t.rushing_epa.fillna(0)
    t["giveaways"] = t.passing_interceptions.fillna(0) + t.fumbles_lost_total.fillna(0)
    t["takeaways"] = t.def_interceptions.fillna(0) + t.def_fumbles.fillna(0)
    t["to_margin"] = t.takeaways - t.giveaways
    return t


def build_panel(g, ts):
    """One row per team-game with own and opponent EPA."""
    gm = g[["season", "week", "home_team", "away_team", "margin"]].copy()
    h = gm.rename(columns={"home_team": "team", "away_team": "opp"})
    h["own_margin"] = h.margin
    a = gm.rename(columns={"away_team": "team", "home_team": "opp"})
    a["own_margin"] = -a.margin
    tg = pd.concat([h[["season", "week", "team", "opp", "own_margin"]],
                    a[["season", "week", "team", "opp", "own_margin"]]],
                   ignore_index=True)
    tg = tg.merge(ts[["season", "week", "team", "off_epa", "to_margin"]],
                  on=["season", "week", "team"], how="inner")
    opp = ts[["season", "week", "team", "off_epa"]].rename(
        columns={"team": "opp", "off_epa": "opp_off_epa"})
    tg = tg.merge(opp, on=["season", "week", "opp"], how="inner")
    tg["net_epa"] = tg.off_epa - tg.opp_off_epa
    return tg


def ridge_ratings(rows, value_col, lam=8.0):
    """Least squares on team indicators: value = rating_team - rating_opp + const."""
    teams = sorted(set(rows.team) | set(rows.opp))
    idx = {t: i for i, t in enumerate(teams)}
    n, k = len(rows), len(teams)
    X = np.zeros((n, k + 1))
    tt = rows.team.map(idx).values
    oo = rows.opp.map(idx).values
    X[np.arange(n), tt] = 1
    X[np.arange(n), oo] -= 1
    X[:, k] = 1
    y = rows[value_col].values
    A = X.T @ X + lam * np.eye(k + 1)
    A[k, k] -= lam
    beta = np.linalg.solve(A, X.T @ y)
    rat = {t: beta[idx[t]] for t in teams}
    mu = np.mean(list(rat.values()))
    return {t: v - mu for t, v in rat.items()}


def project(g, tg, season, maxwk, mode):
    hist_g = g[(g.season == season - 1) & g.home_score.notna()]
    hist_t = tg[tg.season == season - 1]
    if len(hist_g) < 200 or len(hist_t) < 400:
        return None

    if mode == "margin":
        rat = ridge_ratings(
            pd.concat([
                hist_g.rename(columns={"home_team": "team", "away_team": "opp"})
                .assign(v=lambda d: d.margin)[["team", "opp", "v"]],
                hist_g.rename(columns={"away_team": "team", "home_team": "opp"})
                .assign(v=lambda d: -d.margin)[["team", "opp", "v"]],
            ], ignore_index=True), "v")
        scale = 1.0
    else:
        col = "net_epa" if mode == "epa" else "adj_epa"
        rat = ridge_ratings(hist_t[["team", "opp", col]], col)
        # convert EPA rating units to points: regress margin on net_epa
        sl = np.polyfit(hist_t[col].values, hist_t.own_margin.values, 1)[0]
        scale = sl

    wk = g[(g.season == season) & (g.week <= maxwk)]
    rows = []
    for _, r in wk.iterrows():
        rh = SHRINK * rat.get(r.home_team, 0.0) * scale
        ra = SHRINK * rat.get(r.away_team, 0.0) * scale
        rows.append((float(r.spread_line), float(rh - ra + HFA),
                     float(r.margin) if pd.notna(r.margin) else np.nan,
                     r.away_team, r.home_team))
    return pd.DataFrame(rows, columns=["mkt", "pred", "marg", "away", "home"])


def evaluate(g, tg, mode, maxwk, seasons):
    fr = [project(g, tg, s, maxwk, mode) for s in seasons]
    d = pd.concat([f for f in fr if f is not None], ignore_index=True).dropna()
    me = (d.marg - d.mkt).abs()
    mo = (d.marg - d.pred).abs()
    side = np.sign(d.pred - d.mkt)
    cov = np.sign(d.marg - d.mkt)
    m = side != 0
    ats = (side[m] == cov[m]).mean()
    n = int(m.sum())
    se = np.sqrt(ats * (1 - ats) / n)
    _, p = stats.ttest_rel(mo, me)
    return dict(n=n, mkt=me.mean(), mod=mo.mean(), p=p, ats=ats,
                lo=ats - 1.96 * se, hi=ats + 1.96 * se,
                dis=(d.pred - d.mkt).std())


def main():
    g = load_games()
    ts = load_team_stats()
    tg = build_panel(g, ts)

    # luck adjustment: strip the turnover-margin contribution from net EPA
    sl = np.polyfit(tg.to_margin.values, tg.net_epa.values, 1)[0]
    tg["adj_epa"] = tg.net_epa - sl * tg.to_margin
    print("=" * 94)
    print("LUCK ADJUSTMENT")
    print("=" * 94)
    print(f"  net EPA per unit of turnover margin: {sl:+.3f}")
    print(f"  turnover margin persistence, team season to season: ", end="")
    ss = (tg.groupby(["team", "season"])["to_margin"].sum().reset_index()
          .sort_values(["team", "season"]))
    ss["nxt"] = ss.groupby("team")["to_margin"].shift(-1)
    dd = ss.dropna()
    print(f"r = {dd.to_margin.corr(dd.nxt):+.3f}  (n={len(dd)})")
    print("  => near zero confirms turnover margin is mostly luck, so removing")
    print("     its contribution should IMPROVE a forward-looking rating.")

    print("\n" + "=" * 94)
    print("THREE RATINGS, IDENTICAL FOLDS")
    print("=" * 94)
    seasons = range(2017, 2026)
    for maxwk in (1, 6):
        print(f"\n  Weeks 1-{maxwk}, seasons 2017-2025")
        print(f"  {'model':<22}{'n':>6}{'mkt MAE':>10}{'model MAE':>11}"
              f"{'diff':>8}{'p':>8}{'ATS':>8}{'95% CI':>16}")
        for mode, lbl in (("margin", "A. margin (shipped)"),
                          ("epa", "B. EPA"),
                          ("adj", "C. EPA + luck-adj")):
            r = evaluate(g, tg, mode, maxwk, seasons)
            ci = f"[{100*r['lo']:.1f},{100*r['hi']:.1f}]"
            print(f"  {lbl:<22}{r['n']:>6}{r['mkt']:>10.2f}{r['mod']:>11.2f}"
                  f"{r['mod']-r['mkt']:>+8.2f}{r['p']:>8.3f}"
                  f"{100*r['ats']:>7.1f}%{ci:>16}")

    print("\n" + "=" * 94)
    print("WEEK 1 2026 -- BEST MODEL (C) vs MARKET")
    print("=" * 94)
    p = project(g, tg, 2026, 1, "adj")
    p["edge"] = p.pred - p.mkt
    p = p.reindex(p.edge.abs().sort_values(ascending=False).index)
    print(f"  {'game':<12}{'market':>9}{'model C':>10}{'edge':>8}")
    for _, r in p.iterrows():
        print(f"  {r.away+'@'+r.home:<12}{r.mkt:>+9.1f}{r.pred:>+10.1f}"
              f"{r.edge:>+8.1f}")
    print(f"\n  disagreement SD: {p.edge.std():.2f} pts")


if __name__ == "__main__":
    main()
