"""
Referee crew analysis.

Three questions:
  Q1  Do a crew's games go over or under the set total?
  Q2  Do they favour the team getting points or the team laying them?
  Q3  Is any crew-to-crew variation MORE than chance would produce?

Q3 is the one that matters. Career rates will always spread out across ~40 crew
chiefs; the question is whether the spread exceeds binomial noise. Two tests:
  - chi-square homogeneity (are all crews the same underlying rate?)
  - split-half reliability within crew (random half vs other half)

Then the mechanism: PENALTY rates. Outcomes are far downstream of crew behaviour;
penalties are the behaviour itself. If anything about crews is persistent, it
should show up here first.

CAVEAT: the 'referee' field is the crew CHIEF. NFL crew membership is reshuffled
between seasons, so year-over-year tests partly measure crew turnover rather than
the chief's own tendency. Split-half within season isolates the chief better.
"""
import numpy as np
import pandas as pd
from scipy import stats

MIN_GAMES = 60
BREAKEVEN = 0.5238


def load_games():
    g = pd.read_csv("../data/games.csv", low_memory=False)
    g = g[(g.game_type == "REG") & g.home_score.notna()
          & g.spread_line.notna() & g.total_line.notna()
          & g.referee.notna()].copy()
    g["margin"] = g.home_score - g.away_score
    g["total_pts"] = g.home_score + g.away_score
    g["ou"] = g.total_pts - g.total_line
    g["fav_mag"] = g.spread_line.abs()
    g["fav_margin"] = np.where(g.spread_line >= 0, g.margin, -g.margin)
    g["ats"] = g.fav_margin - g.fav_mag        # >0 favourite covered
    return g


def load_penalties():
    fr = []
    for y in range(2016, 2025):
        d = pd.read_csv(f"../data/tstats_{y}.csv", low_memory=False)
        keep = ["season", "week", "team", "penalties", "penalty_yards"]
        keep = [c for c in keep if c in d.columns]
        d = d[keep]
        if "season_type" in d.columns:
            d = d[d.season_type == "REG"]
        fr.append(d)
    return pd.concat(fr, ignore_index=True)


def wilson(k, n, z=1.96):
    p = k / n
    d = 1 + z**2 / n
    c = (p + z**2 / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / d
    return (c - h, c + h)


def chi2_homogeneity(k_arr, n_arr, label):
    """H0: every crew shares one underlying rate."""
    k_arr, n_arr = np.asarray(k_arr), np.asarray(n_arr)
    p_bar = k_arr.sum() / n_arr.sum()
    exp_k = n_arr * p_bar
    exp_nk = n_arr * (1 - p_bar)
    chi2 = (((k_arr - exp_k) ** 2) / exp_k
            + (((n_arr - k_arr) - exp_nk) ** 2) / exp_nk).sum()
    dof = len(k_arr) - 1
    p = 1 - stats.chi2.cdf(chi2, dof)
    obs_sd = np.sqrt(np.average((k_arr / n_arr - p_bar) ** 2, weights=n_arr))
    exp_sd = np.sqrt(p_bar * (1 - p_bar) * np.average(1 / n_arr, weights=n_arr))
    print(f"\n  {label}")
    print(f"    pooled rate        {100*p_bar:.1f}%   crews={len(k_arr)}")
    print(f"    observed SD across crews  {100*obs_sd:.2f} pts")
    print(f"    expected SD if pure noise {100*exp_sd:.2f} pts")
    print(f"    chi2={chi2:.1f}  dof={dof}  p={p:.3f}"
          f"   => {'REAL crew variation' if p < 0.05 else 'consistent with pure noise'}")
    return p


def split_half(g, outcome_col, positive, label, n_reps=200):
    """Random-half reliability within crew, averaged over repetitions."""
    rng = np.random.default_rng(0)
    sub = g[g[outcome_col] != 0].copy()
    sub["hit"] = (sub[outcome_col] > 0).astype(int) if positive else \
                 (sub[outcome_col] < 0).astype(int)
    counts = sub.referee.value_counts()
    refs = counts[counts >= MIN_GAMES].index
    sub = sub[sub.referee.isin(refs)]
    cors = []
    for _ in range(n_reps):
        sub["h"] = rng.integers(0, 2, len(sub))
        a = sub[sub.h == 0].groupby("referee")["hit"].mean()
        b = sub[sub.h == 1].groupby("referee")["hit"].mean()
        j = pd.concat([a.rename("a"), b.rename("b")], axis=1).dropna()
        if len(j) > 5:
            cors.append(j.a.corr(j.b))
    r = np.mean(cors)
    print(f"  {label:<34} split-half r = {r:+.3f}   "
          f"(crews={len(refs)}, {n_reps} reps)")
    return r


def main():
    g = load_games()
    print("=" * 88)
    print(f"REFEREE CREW ANALYSIS   ({len(g):,} games, "
          f"{g.season.min()}-{g.season.max()})")
    print("=" * 88)

    # ---------------------------------------------------------- Q1 and Q2
    ou = g[g.ou != 0]
    ats = g[g.ats != 0]
    tab = []
    for ref, s in ou.groupby("referee"):
        n_ou = len(s)
        if n_ou < MIN_GAMES:
            continue
        k_ou = int((s.ou > 0).sum())
        sa = ats[ats.referee == ref]
        k_ats = int((sa.ats > 0).sum())
        tab.append(dict(referee=ref, n_ou=n_ou, over=k_ou / n_ou, k_ou=k_ou,
                        n_ats=len(sa), fav=k_ats / len(sa), k_ats=k_ats))
    tab = pd.DataFrame(tab)

    print(f"\nQ1/Q2. Career rates by crew chief (min {MIN_GAMES} games), "
          f"{len(tab)} crews")
    print(f"  {'crew chief':<20}{'n':>5}{'over%':>8}{'95% CI':>15}"
          f"{'fav ATS%':>10}{'95% CI':>15}")
    show = pd.concat([tab.nsmallest(4, "over"), tab.nlargest(4, "over")])
    for _, r in show.iterrows():
        lo1, hi1 = wilson(r.k_ou, r.n_ou)
        lo2, hi2 = wilson(r.k_ats, r.n_ats)
        print(f"  {r.referee:<20}{int(r.n_ou):>5}{100*r.over:>7.1f}%"
              f"{'['+f'{100*lo1:.0f}'+','+f'{100*hi1:.0f}'+']':>15}"
              f"{100*r.fav:>9.1f}%"
              f"{'['+f'{100*lo2:.0f}'+','+f'{100*hi2:.0f}'+']':>15}")

    print(f"\n  over% range across crews: {100*tab.over.min():.1f}% "
          f"to {100*tab.over.max():.1f}%")
    print(f"  fav ATS% range:           {100*tab.fav.min():.1f}% "
          f"to {100*tab.fav.max():.1f}%")
    print("  Looks exploitable. The next two tests are why it isn't.")

    # -------------------------------------------------------------- Q3
    print("\n" + "=" * 88)
    print("Q3. IS THE CREW-TO-CREW SPREAD MORE THAN CHANCE?")
    print("=" * 88)
    chi2_homogeneity(tab.k_ou, tab.n_ou, "OVER/UNDER rate by crew")
    chi2_homogeneity(tab.k_ats, tab.n_ats, "FAVOURITE ATS rate by crew")

    print("\n  Split-half reliability (random half of a crew's games vs the other):")
    split_half(g, "ou", True, "over rate")
    split_half(g, "ats", True, "favourite cover rate")
    print("\n  A reliable crew tendency would show r > 0. Near zero means the")
    print("  career spread above is sampling noise, not crew identity.")

    # ------------------------------------------------ year over year
    print("\n  Year-over-year persistence:")
    for col, lbl in (("ou", "over rate"), ("ats", "favourite cover rate")):
        s = g[g[col] != 0].copy()
        s["hit"] = (s[col] > 0).astype(int)
        yr = (s.groupby(["referee", "season"])
              .agg(rate=("hit", "mean"), n=("hit", "size")).reset_index())
        yr = yr[yr.n >= 8].sort_values(["referee", "season"])
        yr["prev"] = yr.groupby("referee")["rate"].shift(1)
        d = yr.dropna(subset=["prev"])
        print(f"    {lbl:<26} lag-1 r = {d.rate.corr(d.prev):+.3f}  "
              f"(n={len(d)} crew-seasons)")

    # ---------------------------------------------------- the mechanism
    print("\n" + "=" * 88)
    print("THE MECHANISM: PENALTY RATES  (2016-2024)")
    print("=" * 88)
    pen = load_penalties()
    gm = g[["season", "week", "home_team", "away_team", "referee"]].copy()
    ph = pen.merge(gm, left_on=["season", "week", "team"],
                   right_on=["season", "week", "home_team"], how="inner")
    pa = pen.merge(gm, left_on=["season", "week", "team"],
                   right_on=["season", "week", "away_team"], how="inner")
    pj = pd.concat([ph, pa], ignore_index=True)
    gp = (pj.groupby(["season", "week", "referee"])
          .agg(pen=("penalties", "sum"), pyd=("penalty_yards", "sum"))
          .reset_index())
    print(f"  matched {len(gp):,} games with penalty totals")

    car = (gp.groupby("referee").agg(pen=("pen", "mean"), n=("pen", "size"))
           .reset_index())
    car = car[car.n >= 40].sort_values("pen")
    print(f"\n  Penalties per game by crew chief (min 40 games), "
          f"{len(car)} crews:")
    for _, r in pd.concat([car.head(4), car.tail(4)]).iterrows():
        print(f"    {r.referee:<20}{r.pen:>6.2f} penalties/game   n={int(r.n)}")
    print(f"\n    range {car.pen.min():.2f} to {car.pen.max():.2f} "
          f"penalties/game  (spread {car.pen.max()-car.pen.min():.2f})")

    # is that spread real? ANOVA + year-over-year
    grp = [gp[gp.referee == r].pen.values for r in car.referee]
    f, p = stats.f_oneway(*grp)
    print(f"\n    ANOVA across crews: F={f:.2f}, p={p:.2e}"
          f"   => {'REAL crew variation' if p < 0.05 else 'noise'}")

    yr = (gp.groupby(["referee", "season"])
          .agg(pen=("pen", "mean"), n=("pen", "size")).reset_index())
    yr = yr[yr.n >= 8].sort_values(["referee", "season"])
    yr["prev"] = yr.groupby("referee")["pen"].shift(1)
    d = yr.dropna(subset=["prev"])
    print(f"    year-over-year persistence of penalties/game: "
          f"r = {d.pen.corr(d.prev):+.3f}  (n={len(d)})")

    # does penalty rate translate into totals?
    m = gp.merge(g[["season", "week", "home_team", "total_pts", "total_line",
                    "ou"]].rename(columns={"home_team": "ht"}),
                 on=["season", "week"], how="inner").drop_duplicates(
        subset=["season", "week", "referee"])
    lo = m[m.pen <= m.pen.quantile(0.25)]
    hi = m[m.pen >= m.pen.quantile(0.75)]
    print(f"\n    low-penalty games  (<= {m.pen.quantile(0.25):.0f}): "
          f"over rate {100*(lo.ou > 0).mean():.1f}%  n={len(lo)}")
    print(f"    high-penalty games (>= {m.pen.quantile(0.75):.0f}): "
          f"over rate {100*(hi.ou > 0).mean():.1f}%  n={len(hi)}")


if __name__ == "__main__":
    main()
