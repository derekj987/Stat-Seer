"""
totals_inseason.py -- should the NFL totals model read THIS season's games?

`totals_model.tendencies` takes each team's scoring environment from the PRIOR season only, so
the published model total for week 12 is the same number it would have been in week 1. That is
the defect the player projections had (fixed with CUR_K) and the game model had before the
in-season blend (PRIOR_K). This measures whether totals want the same treatment, and how much
weight the current season should carry:

    tendency = (n * this_season_avg_total + PRIOR_K * prior_season_avg_total) / (n + PRIOR_K)
    predicted total = league + k * (mean(tendency_home, tendency_away) - league)

Walk-forward, week by week, with only games BEFORE the week in view -- the same no-look-ahead
rule ratings_asof follows. Choose on TRAIN seasons, report HELD-OUT seasons separately, and
report the market's error on the same games so the comparison is honest.

    python analysis/totals_inseason.py
"""
import numpy as np
import pandas as pd

TRAIN = range(2015, 2023)
TEST = range(2023, 2026)
PRIOR_KS = [1e9, 12, 8, 6, 5, 4, 3, 2, 1]        # 1e9 = prior season only (what ships)
REG_KS = [0.4, 0.5, 0.6, 0.7]
# The league's own scoring level also moves within a season; blend it the same way.
LEAGUE_K = 40.0


def season_frame(g, season):
    s = g[(g.season == season) & (g.game_type == "REG") & g.home_score.notna()].copy()
    s["tot"] = s.home_score + s.away_score
    return s


def prior_tendency(g, season):
    s = season_frame(g, season)
    t, c = {}, {}
    for _, r in s.iterrows():
        for team in (r.home_team, r.away_team):
            t[team] = t.get(team, 0) + r.tot
            c[team] = c.get(team, 0) + 1
    return {k: t[k] / c[k] for k in t}, (s.tot.mean() if len(s) else np.nan)


def run(g, seasons, prior_k, reg_k):
    err, bias, mkt, naive, n = [], [], [], [], 0
    for Y in seasons:
        prior, lg_prior = prior_tendency(g, Y - 1)
        cur = season_frame(g, Y)
        if not len(cur) or not prior:
            continue
        run_tot, run_n = {}, {}
        lg_sum, lg_n = 0.0, 0
        for week in sorted(cur.week.unique()):
            wk = cur[cur.week == week]
            lg = (lg_sum + LEAGUE_K * lg_prior) / (lg_n + LEAGUE_K)
            for _, r in wk.iterrows():
                h, a = r.home_team, r.away_team
                if h not in prior or a not in prior:
                    continue

                def tend(t):
                    m = run_n.get(t, 0)
                    return (run_tot.get(t, 0.0) + prior_k * prior[t]) / (m + prior_k)
                pred = lg + reg_k * ((tend(h) + tend(a)) / 2 - lg)
                actual = r.tot
                err.append(abs(pred - actual))
                bias.append(pred - actual)
                naive.append(abs(lg - actual))
                if pd.notna(r.total_line):
                    mkt.append(abs(r.total_line - actual))
                n += 1
            # only AFTER predicting the week do its results enter the running totals
            for _, r in wk.iterrows():
                for t in (r.home_team, r.away_team):
                    run_tot[t] = run_tot.get(t, 0.0) + r.tot
                    run_n[t] = run_n.get(t, 0) + 1
                lg_sum += r.tot
                lg_n += 1
    return np.mean(err), np.mean(bias), np.mean(naive), (np.mean(mkt) if mkt else np.nan), n


def main():
    g = pd.read_csv("data/games.csv", low_memory=False)
    print(f"{'prior_k':>8} {'reg_k':>6} | {'TRAIN mae':>10} {'bias':>6} | {'TEST mae':>9} {'bias':>6} "
          f"{'naive':>7} {'market':>7}")
    best = None
    for pk in PRIOR_KS:
        for rk in REG_KS:
            tr = run(g, TRAIN, pk, rk)
            te = run(g, TEST, pk, rk)
            tag = "prior-only" if pk > 1e6 else f"{pk:g}"
            print(f"{tag:>8} {rk:>6.2f} | {tr[0]:>10.3f} {tr[1]:>+6.2f} | {te[0]:>9.3f} {te[1]:>+6.2f} "
                  f"{te[2]:>7.3f} {te[3]:>7.3f}")
            if best is None or tr[0] < best[0]:
                best = (tr[0], pk, rk, te)
    _, pk, rk, te = best
    print(f"\nchosen on TRAIN: prior_k={pk:g} reg_k={rk:.2f}  ->  held-out MAE {te[0]:.3f} "
          f"(naive {te[2]:.3f}, market {te[3]:.3f}, n={te[4]:,})")
    # week-band detail for the chosen setting
    print("\nheld-out error by week band, chosen setting vs prior-only:")
    for lo, hi in ((1, 2), (3, 5), (6, 10), (11, 18)):
        sub = g[(g.week >= lo) & (g.week <= hi)]
        a = run(sub, TEST, pk, rk)
        b = run(sub, TEST, 1e9, 0.5)
        print(f"  weeks {lo:>2}-{hi:<2} n={a[4]:>4}  in-season {a[0]:6.3f}   prior-only {b[0]:6.3f}   "
              f"market {a[3]:6.3f}")


if __name__ == "__main__":
    main()
