"""
Injury burden: the measurable version of "healthier roster."

Two tests:
  T1  PRIOR-season snap-weighted injury burden -> next-season performance.
      Hypothesis: a team that lost a lot of snap-weight to injury underperformed
      its true quality; if preseason perception anchors on record, it is
      underpriced the following year.

  T2  CURRENT-week injury burden -> ATS. Hypothesis: the market is slow to price
      cumulative absence, as opposed to headline single-player news.

Burden metric: for each player-week where a player is declared Out, add that
player's season-average snap share. This weights a 90%-snap starter far above a
special-teamer, which raw "players on IR" counts do not.
"""
import numpy as np
import pandas as pd
from scipy import stats

BREAKEVEN = 0.5238
SEASONS = range(2016, 2025)


def load_games():
    g = pd.read_csv("../data/games.csv", low_memory=False)
    g = g[(g.game_type == "REG") & g.home_score.notna()
          & g.spread_line.notna()].copy()
    g["margin"] = g.home_score - g.away_score
    return g


def team_rows(g):
    h = g.copy()
    h["team"], h["opp"] = h.home_team, h.away_team
    h["ats"] = h.margin - h.spread_line
    h["pts"], h["opp_pts"] = h.home_score, h.away_score
    a = g.copy()
    a["team"], a["opp"] = a.away_team, a.home_team
    a["ats"] = -a.margin + a.spread_line
    a["pts"], a["opp_pts"] = a.away_score, a.home_score
    c = ["season", "week", "team", "opp", "ats", "pts", "opp_pts"]
    t = pd.concat([h[c], a[c]], ignore_index=True)
    t["won"] = (t.pts > t.opp_pts).astype(int)
    return t


def build_burden():
    """Snap-weighted Out-designations per team-week."""
    xw = pd.read_csv("../data/players.csv", low_memory=False)
    xw = xw[["gsis_id", "pfr_id"]].dropna().drop_duplicates("gsis_id")

    snaps, injs = [], []
    for y in SEASONS:
        s = pd.read_csv(f"../data/snaps_{y}.csv.gz", low_memory=False)
        s = s[s.game_type == "REG"]
        s["snap_share"] = pd.to_numeric(s.offense_pct, errors="coerce")
        hi = s.snap_share > 1.5
        s.loc[hi, "snap_share"] = s.loc[hi, "snap_share"] / 100
        snaps.append(s[["season", "week", "team", "pfr_player_id",
                        "snap_share"]].rename(
            columns={"pfr_player_id": "pfr_id"}))
        for ext in (".csv.gz", ".csv"):
            try:
                i = pd.read_csv(f"../data/inj_{y}{ext}", low_memory=False)
                break
            except Exception:
                continue
        injs.append(i[i.game_type == "REG"][
            ["season", "week", "team", "gsis_id", "report_status"]])

    sn = pd.concat(snaps, ignore_index=True)
    inj = pd.concat(injs, ignore_index=True).drop_duplicates(
        subset=["season", "week", "team", "gsis_id"], keep="last")

    # each player's season-average offensive snap share
    base = (sn.groupby(["pfr_id", "season"])["snap_share"]
            .mean().rename("avg_share").reset_index())
    inj = inj.merge(xw, on="gsis_id", how="left")
    inj = inj.merge(base, on=["pfr_id", "season"], how="left")
    inj["avg_share"] = inj.avg_share.fillna(0.0)

    out = inj[inj.report_status.isin(["Out", "Doubtful"])]
    burden = (out.groupby(["season", "week", "team"])["avg_share"]
              .sum().rename("burden").reset_index())
    return burden


def report(label, k, n):
    if n < 60:
        print(f"  {label:<48} n={n} — too small")
        return
    p = k / n
    z = 1.96
    d = 1 + z**2 / n
    c = (p + z**2 / (2 * n)) / d
    hw = z * np.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / d
    lo, hi = c - hw, c + hw
    pv = stats.binomtest(k, n, 0.5).pvalue
    v = "BEATS VIG" if lo > BREAKEVEN else ("sig vs 50%" if pv < 0.05 else "-")
    print(f"  {label:<48}{n:>6}{100*p:>7.1f}%"
          f"{'['+f'{100*lo:.1f}'+','+f'{100*hi:.1f}'+']':>16}{pv:>8.3f}  {v}")


def main():
    g = load_games()
    t = team_rows(g)
    b = build_burden()

    print("=" * 96)
    print(f"INJURY BURDEN ANALYSIS  (snap-weighted, {min(SEASONS)}-{max(SEASONS)})")
    print("=" * 96)
    print(f"  team-weeks with burden data: {len(b):,}")
    print(f"  burden distribution: mean {b.burden.mean():.2f} snap-shares lost, "
          f"median {b.burden.median():.2f}, p90 {b.burden.quantile(0.9):.2f}, "
          f"max {b.burden.max():.2f}")
    print("  (1.00 = the equivalent of one full-time starter unavailable)")

    tb = t.merge(b, on=["season", "week", "team"], how="left")
    tb["burden"] = tb.burden.fillna(0.0)

    # ------------------------------------------------- T1 prior-season burden
    print("\n" + "=" * 96)
    print("T1.  PRIOR-SEASON BURDEN -> NEXT-SEASON PERFORMANCE")
    print("=" * 96)
    ssn = (tb.groupby(["team", "season"])
           .agg(burden=("burden", "sum"), w=("won", "sum"), n=("won", "size"),
                pf=("pts", "sum"), pa=("opp_pts", "sum")).reset_index())
    ssn = ssn[ssn.n >= 14]
    ssn["wp"] = ssn.w / ssn.n
    ssn = ssn.sort_values(["team", "season"])
    ssn["wp_next"] = ssn.groupby("team")["wp"].shift(-1)
    d = ssn.dropna(subset=["wp_next"])

    print(f"\n  season burden: mean {ssn.burden.mean():.1f}, "
          f"sd {ssn.burden.std():.1f}  (n={len(ssn)} team-seasons)")
    print(f"  burden vs SAME-season win%:  r = {ssn.burden.corr(ssn.wp):+.3f}"
          f"   <- does injury hurt in-season?")
    print(f"  burden vs NEXT-season win%:  r = {d.burden.corr(d.wp_next):+.3f}")
    # controlling for this year's record
    X = np.column_stack([np.ones(len(d)), d.wp.values, d.burden.values])
    beta, *_ = np.linalg.lstsq(X, d.wp_next.values, rcond=None)
    print(f"\n  next_wp = {beta[0]:.3f} {beta[1]:+.3f}*this_wp "
          f"{beta[2]:+.5f}*this_burden")
    print("  => sign and size of the burden term is the bounce-back effect")

    print("\n  Early-season ATS (weeks 1-6) by prior-year burden quartile:")
    print(f"  {'group':<48}{'n':>6}{'ATS':>7}{'95% CI':>16}{'p':>8}")
    nxt = ssn[["team", "season", "burden"]].copy()
    nxt["season"] = nxt.season + 1
    nxt = nxt.rename(columns={"burden": "prior_burden"})
    early = tb[tb.week <= 6].merge(nxt, on=["team", "season"], how="inner")
    early = early[early.ats != 0]
    q75 = early.prior_burden.quantile(0.75)
    q25 = early.prior_burden.quantile(0.25)
    hi = early[early.prior_burden >= q75]
    lo = early[early.prior_burden <= q25]
    report(f"HIGH prior-yr burden (>= {q75:.0f}) — bounce-back",
           int((hi.ats > 0).sum()), len(hi))
    report(f"LOW prior-yr burden (<= {q25:.0f}) — regression risk",
           int((lo.ats > 0).sum()), len(lo))
    report("betting AGAINST low prior-yr burden teams",
           int((lo.ats < 0).sum()), len(lo))

    # ---------------------------------------------------- T2 current burden
    print("\n" + "=" * 96)
    print("T2.  CURRENT-WEEK BURDEN -> ATS  (is the market slow to price absence?)")
    print("=" * 96)
    cur = tb[(tb.ats != 0) & (tb.week >= 2)].copy()
    print(f"\n  {'group':<48}{'n':>6}{'ATS':>7}{'95% CI':>16}{'p':>8}")
    for thresh, lbl in [(1.0, ">= 1.0 starter-equivalent Out"),
                        (1.5, ">= 1.5 starter-equivalents Out"),
                        (2.0, ">= 2.0 starter-equivalents Out")]:
        s = cur[cur.burden >= thresh]
        report(f"team with {lbl}", int((s.ats > 0).sum()), len(s))
        report(f"  ...betting AGAINST them", int((s.ats < 0).sum()), len(s))
    s0 = cur[cur.burden == 0]
    report("fully healthy team (burden = 0)", int((s0.ats > 0).sum()), len(s0))

    # burden differential vs opponent
    opp = cur[["season", "week", "team", "burden"]].rename(
        columns={"team": "opp", "burden": "opp_burden"})
    cd = cur.merge(opp, on=["season", "week", "opp"], how="inner")
    cd["diff"] = cd.burden - cd.opp_burden
    print()
    adv = cd[cd["diff"] <= -1.0]      # healthier than opponent by 1 starter
    dis = cd[cd["diff"] >= 1.0]
    report("healthier than opponent by 1+ starter-equiv",
           int((adv.ats > 0).sum()), len(adv))
    report("less healthy than opponent by 1+ starter-equiv",
           int((dis.ats > 0).sum()), len(dis))

    # does burden predict actual margin at all?
    print(f"\n  Correlation, burden differential vs ATS margin: "
          f"r = {cd['diff'].corr(cd.ats):+.3f}  (n={len(cd):,})")
    print(f"  Mean ATS margin, healthier by 1+: {adv.ats.mean():+.2f} pts")
    print(f"  Mean ATS margin, less healthy by 1+: {dis.ats.mean():+.2f} pts")

    print("\n" + "=" * 96)
    print(f"Break-even at -110 = {100*BREAKEVEN:.2f}%. CI lower bound must clear it.")
    print("=" * 96)


if __name__ == "__main__":
    main()
