"""
Do team-level attributes beat the closing line?

Tests Derek's candidate list plus everything else the data supports. The bar is
not "is this effect real" -- it is "does it beat the CLOSING LINE," because the
line already contains every attribute the market has thought of.

Break-even at -110 is 52.38%. A result must clear that AND its confidence
interval must clear it. With ~25 tests, roughly 1.25 will look significant at
p<0.05 by chance, so a Bonferroni-adjusted threshold is also reported.

Data: 6,967 regular-season games, 1999-2025, with closing spreads and totals.
"""
import numpy as np
import pandas as pd
from scipy import stats

BREAKEVEN = 0.5238


def load():
    g = pd.read_csv("../data/games.csv", low_memory=False)
    g = g[(g.game_type == "REG") & g.home_score.notna()
          & g.spread_line.notna() & g.total_line.notna()].copy()
    g["margin"] = g.home_score - g.away_score
    g["total_pts"] = g.home_score + g.away_score
    g["ou"] = g.total_pts - g.total_line
    g["hour"] = pd.to_numeric(g.gametime.str.slice(0, 2), errors="coerce")
    return g


def to_team_rows(g):
    """One row per team-game, spread from that team's perspective."""
    h = g.copy()
    h["team"], h["opp"] = h.home_team, h.away_team
    h["is_home"] = 1
    h["spread"] = -h.spread_line          # negative = this team favoured
    h["ats"] = h.margin - h.spread_line
    h["coach"], h["opp_coach"] = h.home_coach, h.away_coach
    h["qb"] = h.home_qb_name
    h["rest"], h["opp_rest"] = h.home_rest, h.away_rest
    h["pts"], h["opp_pts"] = h.home_score, h.away_score

    a = g.copy()
    a["team"], a["opp"] = a.away_team, a.home_team
    a["is_home"] = 0
    a["spread"] = a.spread_line
    a["ats"] = -a.margin + a.spread_line
    a["coach"], a["opp_coach"] = a.away_coach, a.home_coach
    a["qb"] = a.away_qb_name
    a["rest"], a["opp_rest"] = a.away_rest, a.home_rest
    a["pts"], a["opp_pts"] = a.away_score, a.home_score

    cols = ["season", "week", "team", "opp", "is_home", "spread", "ats",
            "coach", "opp_coach", "qb", "rest", "opp_rest", "pts", "opp_pts",
            "div_game", "roof", "surface", "temp", "wind", "location", "hour",
            "weekday", "referee", "total_line", "total_pts", "ou"]
    t = pd.concat([h[cols], a[cols]], ignore_index=True)
    t["won"] = (t.pts > t.opp_pts).astype(int)
    return t.sort_values(["season", "week"]).reset_index(drop=True)


def add_records(t):
    """Running win pct entering each game, and a playoff-stakes proxy."""
    t = t.sort_values(["team", "season", "week"]).copy()
    grp = t.groupby(["team", "season"], sort=False)
    t["gp_prior"] = grp.cumcount()
    t["w_prior"] = grp["won"].transform(lambda s: s.shift(1).cumsum())
    t["winpct"] = t.w_prior / t.gp_prior.replace(0, np.nan)
    return t


def add_new_coach(t):
    """First season of a coach-team pairing."""
    first = (t.groupby(["team", "coach"])["season"].min()
             .rename("first_season").reset_index())
    t = t.merge(first, on=["team", "coach"], how="left")
    t["new_coach"] = (t.season == t.first_season).astype(int)
    fo = (t.groupby(["opp", "opp_coach"])["season"].min()
          .rename("opp_first").reset_index()
          .rename(columns={"opp": "opp_", "opp_coach": "opp_coach_"}))
    t = t.merge(fo, left_on=["opp", "opp_coach"],
                right_on=["opp_", "opp_coach_"], how="left")
    t["opp_new_coach"] = (t.season == t.opp_first).astype(int)
    return t.drop(columns=["opp_", "opp_coach_"], errors="ignore")


def wilson(k, n, z=1.96):
    if n == 0:
        return (np.nan, np.nan)
    p = k / n
    d = 1 + z**2 / n
    c = (p + z**2 / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / d
    return (c - h, c + h)


RESULTS = []


def test_ats(label, sub, side="cover"):
    """side='cover' -> did this team beat the spread."""
    s = sub[sub.ats != 0]
    n = len(s)
    if n < 100:
        return
    k = int((s.ats > 0).sum())
    p = k / n
    lo, hi = wilson(k, n)
    pval = stats.binomtest(k, n, 0.5).pvalue
    RESULTS.append(dict(label=label, k=k, n=n, p=p, lo=lo, hi=hi, pval=pval,
                        kind="ATS"))


def test_ou(label, sub, over=True):
    s = sub[sub.ou != 0]
    n = len(s)
    if n < 100:
        return
    k = int((s.ou > 0).sum()) if over else int((s.ou < 0).sum())
    p = k / n
    lo, hi = wilson(k, n)
    pval = stats.binomtest(k, n, 0.5).pvalue
    RESULTS.append(dict(label=label, k=k, n=n, p=p, lo=lo, hi=hi, pval=pval,
                        kind="O/U"))


def main():
    g = load()
    t = add_new_coach(add_records(to_team_rows(g)))

    # ---------------------------------------------------------- 1 home/away
    test_ats("Home teams ATS", t[t.is_home == 1])
    test_ats("Road teams ATS", t[t.is_home == 0])
    test_ats("Home underdogs ATS", t[(t.is_home == 1) & (t.spread > 0)])
    test_ats("Road favourites ATS", t[(t.is_home == 0) & (t.spread < 0)])

    # ------------------------------------------------------- 2 favourite size
    for lo, hi, lbl in [(0.5, 3.5, "0.5-3.5"), (4, 7, "4-7"),
                        (7.5, 13, "7.5-13"), (13.5, 30, "13.5+")]:
        test_ats(f"Favourites ATS, {lbl}",
                 t[(t.spread <= -lo) & (t.spread >= -hi)])

    # ------------------------------------------------------------ 3 primetime
    pt = t[(t.hour >= 19) | (t.weekday.isin(["Monday", "Thursday"]))]
    test_ats("Primetime favourites ATS", pt[pt.spread < 0])
    test_ats("Primetime underdogs ATS", pt[pt.spread > 0])
    test_ou("Primetime overs", g[(g.hour >= 19) |
                                 (g.weekday.isin(["Monday", "Thursday"]))])

    # --------------------------------------------------------- 4 new coach
    test_ats("New head coach ATS (all season)", t[t.new_coach == 1])
    test_ats("New head coach ATS, weeks 1-4",
             t[(t.new_coach == 1) & (t.week <= 4)])
    test_ats("New head coach ATS, weeks 13+",
             t[(t.new_coach == 1) & (t.week >= 13)])
    test_ats("Facing a new head coach ATS", t[t.opp_new_coach == 1])

    # --------------------------------------------------- 5 playoff stakes
    late = t[(t.week >= 14) & t.winpct.notna()]
    test_ats("Late season, winpct >= .600", late[late.winpct >= 0.60])
    test_ats("Late season, winpct <= .350", late[late.winpct <= 0.35])
    test_ats("Late season, contender vs also-ran",
             late[(late.winpct >= 0.60)])
    # motivation mismatch: good team vs bad team late
    m = late.merge(late[["season", "week", "team", "winpct"]]
                   .rename(columns={"team": "opp", "winpct": "opp_winpct"}),
                   on=["season", "week", "opp"], how="left")
    test_ats("Late: winpct>=.6 vs opp winpct<=.35",
             m[(m.winpct >= 0.60) & (m.opp_winpct <= 0.35)])

    # ------------------------------------------------------------- 6 rest
    test_ats("Off a bye (rest >= 13)", t[t.rest >= 13])
    test_ats("Short week (rest <= 4)", t[t.rest <= 4])
    test_ats("Rest advantage >= 7 days",
             t[(t.rest - t.opp_rest) >= 7])

    # ------------------------------------------------------- 7 division
    test_ats("Division games, favourites ATS",
             t[(t.div_game == 1) & (t.spread < 0)])
    test_ou("Division game overs", g[g.div_game == 1])

    # ------------------------------------------------------- 8 environment
    out = g[g.roof == "outdoors"]
    for lo, hi, lbl in [(0, 7, "wind 0-7"), (8, 14, "wind 8-14"),
                        (15, 60, "wind 15+")]:
        test_ou(f"Overs, {lbl} mph (outdoor)",
                out[(out.wind >= lo) & (out.wind <= hi)])
    test_ou("Overs, dome", g[g.roof.isin(["dome", "closed"])])
    test_ou("Overs, temp <= 32F", out[out.temp <= 32])
    test_ou("Overs, turf surface", g[g.surface != "grass"])
    test_ats("Neutral site games, favourites ATS",
             t[(t.location == "Neutral") & (t.spread < 0)])

    # ---------------------------------------------------------- 9 QB change
    t2 = t.sort_values(["team", "season", "week"]).copy()
    t2["prev_qb"] = t2.groupby(["team", "season"])["qb"].shift(1)
    test_ats("New starting QB vs last week",
             t2[t2.prev_qb.notna() & (t2.qb != t2.prev_qb)])

    # ------------------------------------------------------------- report
    df = pd.DataFrame(RESULTS)
    n_tests = len(df)
    bonf = 0.05 / n_tests

    print("=" * 96)
    print(f"TEAM ATTRIBUTE TESTS vs THE CLOSING LINE   "
          f"({len(g):,} games, {g.season.min()}-{g.season.max()})")
    print("=" * 96)
    print(f"Break-even at -110 = {100*BREAKEVEN:.2f}%. "
          f"{n_tests} tests run; Bonferroni threshold p<{bonf:.4f}\n")
    print(f"  {'attribute':<42}{'kind':>5}{'n':>7}{'rate':>8}"
          f"{'95% CI':>16}{'p':>9}  verdict")
    df = df.sort_values("p", ascending=False)
    for _, r in df.iterrows():
        beats = r.lo > BREAKEVEN
        sig = r.pval < bonf
        if beats and sig:
            v = "*** BEATS VIG + SURVIVES BONFERRONI"
        elif beats:
            v = "beats vig (single test only)"
        elif r.pval < 0.05:
            v = "sig vs 50% but under vig"
        else:
            v = "-"
        ci = f"[{100*r.lo:.1f},{100*r.hi:.1f}]"
        print(f"  {r.label:<42}{r.kind:>5}{r.n:>7}{100*r.p:>7.1f}%"
              f"{ci:>16}{r.pval:>9.3f}  {v}")

    print("\n" + "=" * 96)
    print("SUPPORTING DETAIL")
    print("=" * 96)

    # home field advantage over time
    print("\nHome field advantage by era (actual margin, and vs the spread):")
    g2 = g.copy()
    g2["era"] = pd.cut(g2.season, [1998, 2004, 2010, 2016, 2021, 2026],
                       labels=["99-04", "05-10", "11-16", "17-21", "22-25"])
    for era, s in g2.groupby("era", observed=True):
        print(f"  {era}: home margin {s.margin.mean():+.2f} pts   "
              f"market spread {s.spread_line.mean():+.2f}   "
              f"home ATS {100*(s.margin > s.spread_line).mean():.1f}%   n={len(s)}")

    # does team-level home edge persist year to year?
    print("\nDoes a team's home ATS record persist season to season?")
    hm = t[t.is_home == 1]
    hm = hm[hm.ats != 0]
    yr = (hm.groupby(["team", "season"])
          .agg(cover=("ats", lambda s: (s > 0).mean()), n=("ats", "size"))
          .reset_index())
    yr = yr[yr.n >= 6].sort_values(["team", "season"])
    yr["prev"] = yr.groupby("team")["cover"].shift(1)
    d = yr.dropna(subset=["prev"])
    r_val = d.cover.corr(d.prev)
    print(f"  lag-1 correlation of home cover rate = {r_val:+.3f}  (n={len(d)})")
    print("  => near zero means 'good home team' has no predictive carryover")

    # wind effect on scoring, directly
    print("\nWind vs actual scoring (outdoor games only):")
    for lo, hi, lbl in [(0, 7, "0-7"), (8, 14, "8-14"), (15, 60, "15+")]:
        s = out[(out.wind >= lo) & (out.wind <= hi)]
        print(f"  wind {lbl:>5} mph: mean total {s.total_pts.mean():.2f} pts   "
              f"market total {s.total_line.mean():.2f}   "
              f"diff {s.total_pts.mean()-s.total_line.mean():+.2f}   n={len(s)}")


if __name__ == "__main__":
    main()
