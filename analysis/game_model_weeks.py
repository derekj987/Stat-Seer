"""
game_model_weeks.py -- is the in-season blend weight right EARLY in the season?

`PRIOR_K = 5.0` was chosen on 2016-2022 and held out on 2023-2025 against the whole season, so
it is the weight that is best ON AVERAGE. Early weeks are a different regime: after one game the
current-season term is one game of noise, after six it is most of what is known. This measures
MAE by week band for a range of K (and of REGRESS), to see whether a week-aware weight is worth
having -- and, just as usefully, to confirm when it is not.

    python analysis/game_model_weeks.py

Choose on TRAIN, read HELD-OUT. A spread of a tenth of a point across a 10x range of K is noise,
not a lever.
"""
import numpy as np
import pandas as pd

TRAIN = range(2016, 2023)
TEST = range(2023, 2026)
BANDS = ((1, 2), (3, 5), (6, 10), (11, 18))
HFA = 2.0


def prior_ratings(g, season):
    s = g[(g.season == season) & (g.game_type == "REG") & g.home_score.notna()].copy()
    s["margin"] = s.home_score - s.away_score
    d, c = {}, {}
    for _, r in s.iterrows():
        d[r.home_team] = d.get(r.home_team, 0) + r.margin
        d[r.away_team] = d.get(r.away_team, 0) - r.margin
        c[r.home_team] = c.get(r.home_team, 0) + 1
        c[r.away_team] = c.get(r.away_team, 0) + 1
    return {t: d[t] / c[t] for t in d}


def run(g, seasons, prior_k, regress):
    """MAE of the predicted margin by week band, walk-forward with no look-ahead."""
    out = {b: [] for b in BANDS}
    mkt = {b: [] for b in BANDS}
    for Y in seasons:
        prior = prior_ratings(g, Y - 1)
        cur = g[(g.season == Y) & (g.game_type == "REG") & g.home_score.notna()]
        run_d, run_n = {}, {}
        for week in sorted(cur.week.unique()):
            wk = cur[cur.week == week]
            band = next((b for b in BANDS if b[0] <= week <= b[1]), None)
            for _, r in wk.iterrows():
                h, a = r.home_team, r.away_team

                def rate(t):
                    n = run_n.get(t, 0)
                    return (run_d.get(t, 0.0) + prior_k * prior.get(t, 0.0)) / (n + prior_k)
                hfa = 0.0 if str(r.get("location")) == "Neutral" else HFA
                pred = regress * (rate(h) - rate(a)) + hfa
                actual = r.home_score - r.away_score
                if band:
                    out[band].append(abs(pred - actual))
                    if pd.notna(r.get("spread_line")):
                        mkt[band].append(abs(r.spread_line - actual))
            for _, r in wk.iterrows():
                m = r.home_score - r.away_score
                run_d[r.home_team] = run_d.get(r.home_team, 0.0) + m
                run_d[r.away_team] = run_d.get(r.away_team, 0.0) - m
                run_n[r.home_team] = run_n.get(r.home_team, 0) + 1
                run_n[r.away_team] = run_n.get(r.away_team, 0) + 1
    return ({b: (np.mean(v) if v else np.nan) for b, v in out.items()},
            {b: (np.mean(v) if v else np.nan) for b, v in mkt.items()},
            {b: len(v) for b, v in out.items()})


def main():
    g = pd.read_csv("data/games.csv", low_memory=False)
    grid = [(k, rg) for k in (1e9, 12, 8, 5, 3, 2, 1) for rg in (0.60, 0.65, 0.70)]
    print("HELD-OUT 2023-25 mean absolute error of the predicted margin, by week band\n")
    hdr = "  ".join(f"wk{lo}-{hi:<2}" for lo, hi in BANDS)
    print(f"{'prior_k':>8} {'reg':>5} | {hdr}   overall")
    rows = []
    for k, rg in grid:
        tr, _, trn = run(g, TRAIN, k, rg)
        te, mk, n = run(g, TEST, k, rg)
        overall_tr = sum(tr[b] * trn[b] for b in BANDS) / sum(trn.values())
        overall_te = sum(te[b] * n[b] for b in BANDS) / sum(n.values())
        rows.append((overall_tr, k, rg, te, overall_te))
        tag = "prior" if k > 1e6 else f"{k:g}"
        print(f"{tag:>8} {rg:>5.2f} | " + "  ".join(f"{te[b]:6.2f}" for b in BANDS) + f"   {overall_te:6.2f}")
    print("        market | " + "  ".join(f"{mk[b]:6.2f}" for b in BANDS)
          + f"   {sum(mk[b] * n[b] for b in BANDS) / sum(n.values()):6.2f}")
    print("             n | " + "  ".join(f"{n[b]:6d}" for b in BANDS))
    rows.sort()
    print(f"\nbest on TRAIN: prior_k={rows[0][1]:g} regress={rows[0][2]:.2f} "
          f"-> held-out overall {rows[0][4]:.3f}")
    # best PER BAND on train, to see whether a week-aware weight is even wanted
    print("\nbest setting per band, chosen on TRAIN:")
    for b in BANDS:
        cand = []
        for k, rg in grid:
            tr, _, _ = run(g, TRAIN, k, rg)
            cand.append((tr[b], k, rg))
        cand.sort()
        te, _, _ = run(g, TEST, cand[0][1], cand[0][2])
        base, _, _ = run(g, TEST, 5.0, 0.65)
        print(f"  wk{b[0]}-{b[1]:<2}: prior_k={cand[0][1]:g} regress={cand[0][2]:.2f} "
              f"-> held-out {te[b]:6.3f}   (shipped 5/0.65: {base[b]:6.3f})")


if __name__ == "__main__":
    main()
