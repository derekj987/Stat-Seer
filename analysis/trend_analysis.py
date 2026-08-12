"""
Trend analysis, tested against the closing line.

Covers the streak/momentum angles ("3-game losing streak and needs a win") plus
the two core claims of the trend-analysis framework:

  CLAIM 1  "Usage trends are usually more predictive than touchdowns or
           turnovers."  -> test trailing EPA (efficiency/usage) against trailing
           MARGIN (results) as predictors of next-game performance vs the spread.

  CLAIM 2  "One game can be noise. Three to five games is more meaningful."
           -> compare 1-, 3-, and 5-game lookback windows.

Both claims are almost certainly TRUE about predicting football. The question this
script asks is narrower and harder: do they beat the closing line, which already
contains them.
"""
import numpy as np
import pandas as pd
from scipy import stats

BREAKEVEN = 0.5238
RESULTS = []


def load():
    g = pd.read_csv("../data/games.csv", low_memory=False)
    g = g[(g.game_type == "REG") & g.home_score.notna()
          & g.spread_line.notna()].copy()
    g["margin"] = g.home_score - g.away_score
    return g


def team_rows(g):
    h = g.copy()
    h["team"], h["opp"] = h.home_team, h.away_team
    h["spread"] = -h.spread_line
    h["ats"] = h.margin - h.spread_line
    h["own_margin"] = h.margin
    a = g.copy()
    a["team"], a["opp"] = a.away_team, a.home_team
    a["spread"] = a.spread_line
    a["ats"] = -a.margin + a.spread_line
    a["own_margin"] = -a.margin
    c = ["season", "week", "team", "opp", "spread", "ats", "own_margin"]
    t = pd.concat([h[c], a[c]], ignore_index=True)
    t["won"] = (t.own_margin > 0).astype(int)
    return t.sort_values(["team", "season", "week"]).reset_index(drop=True)


def add_streaks(t):
    """Entering-game streak state, strictly lagged."""
    t = t.sort_values(["team", "season", "week"]).copy()
    g = t.groupby(["team", "season"], sort=False)
    t["prev_won"] = g["won"].shift(1)
    t["prev_margin"] = g["own_margin"].shift(1)

    def streak(s):
        out, run = [], 0
        for v in s:
            out.append(run)
            if pd.isna(v):
                run = 0
            elif v == 1:
                run = run + 1 if run > 0 else 1
            else:
                run = run - 1 if run < 0 else -1
        return pd.Series(out, index=s.index)

    t["streak"] = g["won"].transform(streak)
    for w in (1, 3, 5):
        t[f"m{w}"] = g["own_margin"].transform(
            lambda s: s.shift(1).rolling(w, min_periods=w).mean())
    t["games_in"] = g.cumcount()
    return t


def add_epa(t):
    fr = []
    for y in range(2016, 2026):
        d = pd.read_csv(f"../data/tstats_{y}.csv", low_memory=False)
        if "season_type" in d.columns:
            d = d[d.season_type == "REG"]
        d["off_epa"] = (pd.to_numeric(d.passing_epa, errors="coerce").fillna(0)
                        + pd.to_numeric(d.rushing_epa, errors="coerce").fillna(0))
        fr.append(d[["season", "week", "team", "off_epa"]])
    e = pd.concat(fr, ignore_index=True)
    t = t.merge(e, on=["season", "week", "team"], how="left")
    opp = e.rename(columns={"team": "opp", "off_epa": "opp_off_epa"})
    t = t.merge(opp, on=["season", "week", "opp"], how="left")
    t["net_epa"] = t.off_epa - t.opp_off_epa
    t = t.sort_values(["team", "season", "week"])
    g = t.groupby(["team", "season"], sort=False)
    for w in (1, 3, 5):
        t[f"e{w}"] = g["net_epa"].transform(
            lambda s: s.shift(1).rolling(w, min_periods=w).mean())
    return t


def test(label, sub, col="ats", positive=True):
    s = sub[sub[col] != 0]
    n = len(s)
    if n < 100:
        return
    k = int((s[col] > 0).sum()) if positive else int((s[col] < 0).sum())
    p = k / n
    z = 1.96
    d = 1 + z**2 / n
    c = (p + z**2 / (2 * n)) / d
    hw = z * np.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / d
    pv = stats.binomtest(k, n, 0.5).pvalue
    RESULTS.append(dict(label=label, n=n, p=p, lo=c - hw, hi=c + hw, pval=pv))


def main():
    g = load()
    t = add_epa(add_streaks(team_rows(g)))
    t = t[t.games_in >= 1]

    # ------------------------------------------------------------- streaks
    for k, lbl in [(-2, "2-game losing streak"), (-3, "3-game losing streak"),
                   (-4, "4+ game losing streak")]:
        s = t[t.streak <= k] if k == -4 else t[t.streak == k]
        test(f"On {lbl} — backing them", s)
        test(f"On {lbl} — fading them", s, positive=False)
    for k, lbl in [(2, "2-game win streak"), (3, "3-game win streak"),
                   (4, "4+ game win streak")]:
        s = t[t.streak >= k] if k == 4 else t[t.streak == k]
        test(f"On {lbl} — backing them", s)
        test(f"On {lbl} — fading them", s, positive=False)

    # blowout bounce-back
    test("After losing by 14+ — backing them", t[t.prev_margin <= -14])
    test("After winning by 14+ — fading them",
         t[t.prev_margin >= 14], positive=False)
    test("After losing by 21+ — backing them", t[t.prev_margin <= -21])

    # "needs a win": losing streak, late season, still mathematically alive
    late = t[(t.week >= 12) & (t.streak <= -2)]
    test("Losing streak, week 12+ — backing them", late)
    test("Losing streak, week 12+ — fading them", late, positive=False)

    # ------------------------------------------- CLAIM 1: usage vs results
    print("=" * 92)
    print("CLAIM 1.  ARE USAGE/EFFICIENCY TRENDS MORE PREDICTIVE THAN RESULTS?")
    print("=" * 92)
    d3 = t.dropna(subset=["m3", "e3", "ats"])
    print(f"\n  n = {len(d3):,} team-games with 3-game trailing history\n")
    print(f"  {'trailing signal':<34}{'r with next-game':>18}"
          f"{'r with ATS margin':>20}")
    for col, lbl in [("m1", "1-game margin (results)"),
                     ("m3", "3-game margin (results)"),
                     ("m5", "5-game margin (results)"),
                     ("e1", "1-game net EPA (usage)"),
                     ("e3", "3-game net EPA (usage)"),
                     ("e5", "5-game net EPA (usage)")]:
        s = t.dropna(subset=[col, "own_margin", "ats"])
        r_next = s[col].corr(s.own_margin)
        r_ats = s[col].corr(s.ats)
        print(f"  {lbl:<34}{r_next:>+18.3f}{r_ats:>+20.3f}")
    print("\n  'r with next-game' = does the trend predict the next result at all?")
    print("  'r with ATS margin' = does it predict beyond what the line already says?")
    print("  The first column is the football question. The second is the betting")
    print("  question, and it is the one that has to be non-zero to matter.")

    # do trend extremes beat the line?
    print("\n  Betting the trend extremes (top/bottom quintile of 3-game signal):")
    for col, lbl in [("m3", "3-game margin"), ("e3", "3-game net EPA")]:
        s = t.dropna(subset=[col])
        hi = s[s[col] >= s[col].quantile(0.8)]
        lo = s[s[col] <= s[col].quantile(0.2)]
        test(f"Hot by {lbl} — backing them", hi)
        test(f"Cold by {lbl} — backing them", lo)

    # ------------------------------------------------------------- report
    df = pd.DataFrame(RESULTS)
    nt = len(df)
    bonf = 0.05 / nt
    print("\n" + "=" * 92)
    print(f"TREND / STREAK ANGLES vs THE CLOSING LINE   "
          f"({nt} tests, Bonferroni p<{bonf:.4f})")
    print("=" * 92)
    print(f"  {'angle':<48}{'n':>6}{'ATS':>7}{'95% CI':>16}{'p':>8}  verdict")
    for _, r in df.sort_values("p", ascending=False).iterrows():
        beats = r.lo > BREAKEVEN
        v = ("*** BEATS VIG" if beats and r.pval < bonf else
             "beats vig (single test)" if beats else
             "sig vs 50%" if r.pval < 0.05 else "-")
        ci = f"[{100*r.lo:.1f},{100*r.hi:.1f}]"
        print(f"  {r.label:<48}{r.n:>6}{100*r.p:>6.1f}%{ci:>16}{r.pval:>8.3f}  {v}")

    n_beat = int(((df.lo > BREAKEVEN) & (df.pval < bonf)).sum())
    print(f"\n  {n_beat} of {nt} angles clear the vig with Bonferroni correction.")


if __name__ == "__main__":
    main()
