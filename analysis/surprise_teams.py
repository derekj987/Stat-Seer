"""
"Find the team that starts hot then regresses."

There is a tension inside this idea worth making explicit.

If a team starts 4-1 and then regresses to finish poorly, the 4-1 start was
largely LUCK. Predicting who gets lucky is not possible by construction. So the
literal version of the request -- find the surprise team in advance -- cannot
work.

But two adjacent versions CAN work, and both are testable:

  V1  FADE the hot start. If the market prices a 4-1 luck-driven team as a 4-1
      team, the value is on their opponents in weeks 6-12. This does not require
      predicting the start, only recognising it for what it is.

  V2  Identify teams whose PRIOR season record misrepresented their true quality
      -- Pythagorean luck. A team that went 6-11 with a positive point
      differential was better than its record. If preseason perception anchors on
      record rather than differential, that team is systematically underpriced.

V2 is the real version of "overlooked team." Test both, plus Derek's Week 1
premise.
"""
import numpy as np
import pandas as pd
from scipy import stats

PYTH_EXP = 2.37          # standard NFL Pythagorean exponent
BREAKEVEN = 0.5238


def load():
    g = pd.read_csv("../data/games.csv", low_memory=False)
    g = g[(g.game_type == "REG") & g.home_score.notna()
          & g.spread_line.notna()].copy()
    g["margin"] = g.home_score - g.away_score
    g["fav_mag"] = g.spread_line.abs()
    g["fav_margin"] = np.where(g.spread_line >= 0, g.margin, -g.margin)
    g["ats"] = g.fav_margin - g.fav_mag
    g["dog_won"] = (g.fav_margin < 0).astype(int)
    return g


def team_rows(g):
    h = g.copy()
    h["team"], h["opp"] = h.home_team, h.away_team
    h["spread"] = -h.spread_line
    h["ats"] = h.margin - h.spread_line
    h["pts"], h["opp_pts"] = h.home_score, h.away_score
    a = g.copy()
    a["team"], a["opp"] = a.away_team, a.home_team
    a["spread"] = a.spread_line
    a["ats"] = -a.margin + a.spread_line
    a["pts"], a["opp_pts"] = a.away_score, a.home_score
    cols = ["season", "week", "team", "opp", "spread", "ats", "pts", "opp_pts"]
    t = pd.concat([h[cols], a[cols]], ignore_index=True)
    t["won"] = (t.pts > t.opp_pts).astype(int)
    return t.sort_values(["team", "season", "week"]).reset_index(drop=True)


def wilson(k, n, z=1.96):
    p = k / n
    d = 1 + z**2 / n
    c = (p + z**2 / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / d
    return (c - h, c + h)


def report(label, k, n):
    if n < 60:
        print(f"  {label:<46} n={n} — too small")
        return
    p = k / n
    lo, hi = wilson(k, n)
    pv = stats.binomtest(k, n, 0.5).pvalue
    v = "BEATS VIG" if lo > BREAKEVEN else ("sig vs 50%" if pv < 0.05 else "-")
    print(f"  {label:<46}{n:>6}{100*p:>7.1f}%"
          f"{'['+f'{100*lo:.1f}'+','+f'{100*hi:.1f}'+']':>16}{pv:>8.3f}  {v}")


# ---------------------------------------------------------------- Week 1 premise
def week1_upsets(g):
    print("=" * 92)
    print("1.  IS WEEK 1 ACTUALLY MORE UPSET-PRONE?")
    print("=" * 92)
    w1, rest = g[g.week == 1], g[g.week.between(2, 17)]
    print(f"  {'measure':<40}{'Week 1':>12}{'Weeks 2-17':>14}{'p':>10}")
    # outright dog wins
    a, b = w1.dog_won.mean(), rest.dog_won.mean()
    pv = stats.ttest_ind(w1.dog_won, rest.dog_won, equal_var=False).pvalue
    print(f"  {'underdog wins outright':<40}{100*a:>11.1f}%{100*b:>13.1f}%{pv:>10.3f}")
    # big dog wins
    w1b, rb = w1[w1.fav_mag >= 7], rest[rest.fav_mag >= 7]
    pv = stats.ttest_ind(w1b.dog_won, rb.dog_won, equal_var=False).pvalue
    print(f"  {'underdog of 7+ wins outright':<40}"
          f"{100*w1b.dog_won.mean():>11.1f}%{100*rb.dog_won.mean():>13.1f}%{pv:>10.3f}")
    # dispersion
    pv = stats.ttest_ind(w1.ats.abs(), rest.ats.abs(), equal_var=False).pvalue
    print(f"  {'mean |margin - spread|':<40}"
          f"{w1.ats.abs().mean():>12.2f}{rest.ats.abs().mean():>14.2f}{pv:>10.3f}")
    # blowouts
    pv = stats.ttest_ind((w1.ats.abs() > 17).astype(int),
                         (rest.ats.abs() > 17).astype(int), equal_var=False).pvalue
    print(f"  {'games missing the line by 17+':<40}"
          f"{100*(w1.ats.abs()>17).mean():>11.1f}%"
          f"{100*(rest.ats.abs()>17).mean():>13.1f}%{pv:>10.3f}")
    n1 = len(w1[w1.dog_won == 1]) / w1.season.nunique()
    print(f"\n  Week 1 averages {n1:.1f} outright underdog wins per season "
          f"(of ~16 games).")
    print("  So the '2-3 crazy upsets' observation is right in COUNT -- but the")
    print("  rate is indistinguishable from any other week. Upsets are a feature")
    print("  of every NFL week, not a Week 1 phenomenon.")


# ------------------------------------------------------- hot start / regression
def hot_starts(t):
    print("\n" + "=" * 92)
    print("2.  HOT STARTS: HOW MUCH DO THEY REGRESS, AND CAN YOU FADE THEM?")
    print("=" * 92)
    first5 = (t[t.week <= 5].groupby(["team", "season"])
              .agg(w5=("won", "sum"), n5=("won", "size"),
                   pf5=("pts", "sum"), pa5=("opp_pts", "sum")).reset_index())
    first5 = first5[first5.n5 >= 4]
    first5["wp5"] = first5.w5 / first5.n5
    rest = (t[t.week.between(6, 17)].groupby(["team", "season"])
            .agg(wr=("won", "sum"), nr=("won", "size")).reset_index())
    rest["wpr"] = rest.wr / rest.nr
    j = first5.merge(rest, on=["team", "season"])
    j = j[j.nr >= 8]

    r = j.wp5.corr(j.wpr)
    print(f"\n  Correlation, first-5 win% vs rest-of-season win%: "
          f"r = {r:+.3f}  (n={len(j)} team-seasons)")
    print(f"  R-squared = {r**2:.3f}  => a hot start explains "
          f"{100*r**2:.0f}% of what follows.")

    print(f"\n  {'first-5 record':<20}{'n':>6}{'rest-of-season win%':>22}"
          f"{'regression':>13}")
    for lo, hi, lbl in [(0.8, 1.01, "4-1 or better"), (0.6, 0.79, "3-2"),
                        (0.4, 0.59, "2-3"), (0.0, 0.39, "1-4 or worse")]:
        s = j[(j.wp5 >= lo) & (j.wp5 <= hi)]
        if len(s) < 20:
            continue
        print(f"  {lbl:<20}{len(s):>6}{100*s.wpr.mean():>21.1f}%"
              f"{100*(s.wpr.mean()-s.wp5.mean()):>+12.1f}")
    print("\n  Regression is large and in both directions -- exactly the pattern")
    print("  described. The question is whether the MARKET already knows.")

    # --- V1: fade the hot start
    print("\n  V1. Can you fade a hot start? ATS in weeks 6-12:")
    print(f"  {'group':<46}{'n':>6}{'ATS':>7}{'95% CI':>16}{'p':>8}")
    mid = t[t.week.between(6, 12)].merge(
        first5[["team", "season", "wp5"]], on=["team", "season"], how="inner")
    mid = mid[mid.ats != 0]
    hot = mid[mid.wp5 >= 0.8]
    cold = mid[mid.wp5 <= 0.2]
    report("hot starters (4-1+) ATS, wks 6-12", int((hot.ats > 0).sum()), len(hot))
    report("BETTING AGAINST hot starters, wks 6-12",
           int((hot.ats < 0).sum()), len(hot))
    report("cold starters (1-4-) ATS, wks 6-12",
           int((cold.ats > 0).sum()), len(cold))
    report("BETTING AGAINST cold starters, wks 6-12",
           int((cold.ats < 0).sum()), len(cold))
    return j


# --------------------------------------------- V2: prior-season Pythagorean luck
def pythag_luck(t):
    print("\n" + "=" * 92)
    print("3.  V2 -- DOES PRIOR-SEASON LUCK IDENTIFY NEXT YEAR'S SURPRISE TEAM?")
    print("=" * 92)
    print("""  Pythagorean expected wins from point differential. A team whose
  RECORD was worse than its differential was better than it looked, and if
  preseason perception anchors on record, it should be underpriced.""")

    ssn = (t.groupby(["team", "season"])
           .agg(w=("won", "sum"), n=("won", "size"),
                pf=("pts", "sum"), pa=("opp_pts", "sum")).reset_index())
    ssn = ssn[ssn.n >= 14]
    ssn["wp"] = ssn.w / ssn.n
    ssn["pyth"] = ssn.pf**PYTH_EXP / (ssn.pf**PYTH_EXP + ssn.pa**PYTH_EXP)
    ssn["luck"] = ssn.wp - ssn.pyth          # >0 = won more than differential

    # does luck persist? (it should not, if it is luck)
    s = ssn.sort_values(["team", "season"])
    s["luck_next"] = s.groupby("team")["luck"].shift(-1)
    s["wp_next"] = s.groupby("team")["wp"].shift(-1)
    s["pyth_next"] = s.groupby("team")["pyth"].shift(-1)
    d = s.dropna(subset=["luck_next"])
    print(f"\n  Persistence of luck itself:  r = {d.luck.corr(d.luck_next):+.3f}"
          f"  (n={len(d)})  <- near zero confirms it IS luck")
    print(f"  Prior win%  -> next win%:    r = {d.wp.corr(d.wp_next):+.3f}")
    print(f"  Prior pyth% -> next win%:    r = {d.pyth.corr(d.wp_next):+.3f}"
          f"   <- differential predicts better than record")

    # regression of next win% on prior record and prior differential
    x = d[["wp", "pyth"]].values
    y = d.wp_next.values
    X = np.column_stack([np.ones(len(x)), x])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    print(f"\n  next_wp = {beta[0]:.3f} + {beta[1]:+.3f}*prior_wp "
          f"{beta[2]:+.3f}*prior_pyth")
    print("  => the differential term carries the weight; record adds little.")

    # --- does the MARKET price this?
    print("\n  Does the market price it? Early-season ATS by prior-year luck:")
    print(f"  {'group':<46}{'n':>6}{'ATS':>7}{'95% CI':>16}{'p':>8}")
    nxt = ssn.copy()
    nxt["season"] = nxt.season + 1
    early = t[t.week <= 6].merge(nxt[["team", "season", "luck", "wp", "pyth"]],
                                on=["team", "season"], how="inner")
    early = early[early.ats != 0]
    unlucky = early[early.luck <= -0.10]     # underperformed differential
    lucky = early[early.luck >= 0.10]
    report("prior yr UNLUCKY (record < differential)",
           int((unlucky.ats > 0).sum()), len(unlucky))
    report("prior yr LUCKY (record > differential)",
           int((lucky.ats > 0).sum()), len(lucky))
    report("BETTING AGAINST prior-yr lucky teams",
           int((lucky.ats < 0).sum()), len(lucky))

    # tighter: bad record but good differential
    hid = early[(early.wp <= 0.45) & (early.pyth >= 0.50)]
    report("bad record (<=.450) BUT good differential",
           int((hid.ats > 0).sum()), len(hid))
    fake = early[(early.wp >= 0.55) & (early.pyth <= 0.50)]
    report("good record (>=.550) BUT bad differential",
           int((fake.ats > 0).sum()), len(fake))
    report("  ...betting AGAINST those teams",
           int((fake.ats < 0).sum()), len(fake))


def main():
    g = load()
    t = team_rows(g)
    print(f"loaded {len(g):,} games, {g.season.min()}-{g.season.max()}\n")
    week1_upsets(g)
    hot_starts(t)
    pythag_luck(t)
    print("\n" + "=" * 92)
    print(f"Break-even at -110 = {100*BREAKEVEN:.2f}%. "
          "A result must have its CI lower bound above that.")
    print("=" * 92)


if __name__ == "__main__":
    main()
