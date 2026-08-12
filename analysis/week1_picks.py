"""
Week 1 2026: run every spread and total through a real model, then tier honestly.

STEP 1 is the one that matters: does the model beat the market at all? If it does
not, every "pick" it produces is noise and the tier assignment must say so.

Model: ridge-regularised team ratings from the PRIOR season's game margins
(opponent-adjusted via least squares on team indicators), regressed toward zero
for offseason turnover, plus home-field advantage. Totals projected the same way
from points scored/allowed.

This is deliberately the simple, defensible baseline -- not a straw man. It is
what a competent solo build produces before player-level work lands.
"""
import numpy as np
import pandas as pd
from scipy.stats import norm

BREAKEVEN = 0.5238
SHRINK = 0.62          # offseason regression toward mean, tuned below
HFA = 1.6              # recent-era home field, from the era analysis


def load():
    g = pd.read_csv("../data/games.csv", low_memory=False)
    g = g[g.game_type == "REG"].copy()
    g["margin"] = g.home_score - g.away_score
    g["total_pts"] = g.home_score + g.away_score
    return g


def fit_ratings(hist, lam=8.0):
    """Ridge least squares: margin = rating_home - rating_away + hfa."""
    teams = sorted(set(hist.home_team) | set(hist.away_team))
    idx = {t: i for i, t in enumerate(teams)}
    n, k = len(hist), len(teams)
    X = np.zeros((n, k + 1))
    for r, (_, row) in enumerate(hist.iterrows()):
        X[r, idx[row.home_team]] = 1
        X[r, idx[row.away_team]] = -1
        X[r, k] = 1
    y = hist.margin.values
    A = X.T @ X + lam * np.eye(k + 1)
    A[k, k] -= lam                       # do not penalise the HFA term
    beta = np.linalg.solve(A, X.T @ y)
    rat = {t: beta[idx[t]] for t in teams}
    mu = np.mean(list(rat.values()))
    return {t: v - mu for t, v in rat.items()}, beta[k]


def fit_scoring(hist):
    """Team offence/defence points per game, for totals."""
    off, dfn = {}, {}
    for t in sorted(set(hist.home_team) | set(hist.away_team)):
        h = hist[hist.home_team == t]
        a = hist[hist.away_team == t]
        pf = pd.concat([h.home_score, a.away_score])
        pa = pd.concat([h.away_score, a.home_score])
        off[t], dfn[t] = pf.mean(), pa.mean()
    lg = np.mean(list(off.values()))
    return off, dfn, lg


def project(g, season):
    """Project week-1 spreads/totals for `season` using `season-1` results."""
    hist = g[(g.season == season - 1) & g.home_score.notna()]
    if len(hist) < 200:
        return None
    rat, hfa = fit_ratings(hist)
    off, dfn, lg = fit_scoring(hist)
    wk1 = g[(g.season == season) & (g.week == 1)].copy()

    rows = []
    for _, r in wk1.iterrows():
        rh = SHRINK * rat.get(r.home_team, 0.0)
        ra = SHRINK * rat.get(r.away_team, 0.0)
        model_spread = -(rh - ra + HFA)      # negative = home favoured
        exp_h = SHRINK * (off.get(r.home_team, lg) + dfn.get(r.away_team, lg)) / 2 \
            + (1 - SHRINK) * lg
        exp_a = SHRINK * (off.get(r.away_team, lg) + dfn.get(r.home_team, lg)) / 2 \
            + (1 - SHRINK) * lg
        model_total = exp_h + exp_a
        rows.append(dict(
            season=season, away=r.away_team, home=r.home_team,
            mkt_spread=r.spread_line, model_spread=-model_spread,
            mkt_total=r.total_line, model_total=model_total,
            margin=r.margin, total_pts=r.total_pts))
    return pd.DataFrame(rows)


def backtest(g):
    print("=" * 92)
    print("STEP 1.  DOES THE MODEL BEAT THE MARKET?  (week 1, 2016-2025)")
    print("=" * 92)
    frames = [project(g, s) for s in range(2016, 2026)]
    d = pd.concat([f for f in frames if f is not None], ignore_index=True)
    d = d.dropna(subset=["margin", "mkt_spread"])

    mkt_err = (d.margin - d.mkt_spread).abs()
    mod_err = (d.margin - d.model_spread).abs()
    print(f"\n  n = {len(d)} week-1 games with results")
    print(f"  {'':<28}{'MAE':>8}{'RMSE':>9}")
    print(f"  {'market closing spread':<28}{mkt_err.mean():>8.2f}"
          f"{np.sqrt(((d.margin-d.mkt_spread)**2).mean()):>9.2f}")
    print(f"  {'this model':<28}{mod_err.mean():>8.2f}"
          f"{np.sqrt(((d.margin-d.model_spread)**2).mean()):>9.2f}")
    diff = mod_err.mean() - mkt_err.mean()
    print(f"  {'difference':<28}{diff:>+8.2f}  "
          f"({'model WORSE' if diff > 0 else 'model better'})")

    dis = d.model_spread - d.mkt_spread
    print(f"\n  model-vs-market disagreement: mean {dis.mean():+.2f}, "
          f"SD {dis.std():.2f} pts")

    # does disagreement magnitude predict who was right?
    print("\n  When the model disagreed most, who was closer to the actual margin?")
    print(f"  {'disagreement':<20}{'n':>5}{'market MAE':>13}{'model MAE':>12}"
          f"{'model ATS':>12}")
    d["absdis"] = dis.abs()
    for lo, hi, lbl in [(0, 2, "0-2 pts"), (2, 4, "2-4 pts"),
                        (4, 7, "4-7 pts"), (7, 99, "7+ pts")]:
        s = d[(d.absdis >= lo) & (d.absdis < hi)]
        if len(s) < 10:
            continue
        # did the model's side beat the spread?
        side = np.sign(s.model_spread - s.mkt_spread)   # + => model likes home more
        cover = np.sign(s.margin - s.mkt_spread)
        hit = (side == cover).mean()
        print(f"  {lbl:<20}{len(s):>5}"
              f"{(s.margin-s.mkt_spread).abs().mean():>13.2f}"
              f"{(s.margin-s.model_spread).abs().mean():>12.2f}"
              f"{100*hit:>11.1f}%")

    # totals
    tm = (d.total_pts - d.mkt_total).abs()
    to = (d.total_pts - d.model_total).abs()
    print(f"\n  TOTALS: market MAE {tm.mean():.2f}   model MAE {to.mean():.2f}"
          f"   ({'model WORSE' if to.mean() > tm.mean() else 'model better'})")
    return d, dis.std()


def tier(edge_pts, se_pts):
    """Confidence tier from edge in points and model error in points."""
    t = abs(edge_pts) / se_pts
    if t < 0.5:
        return "DO NOT BET", t
    if t < 1.0:
        return "BAD BET", t
    if t < 1.5:
        return "MODERATE", t
    if t < 2.0:
        return "GOOD", t
    return "BEST", t


def week1_2026(g, se):
    print("\n" + "=" * 92)
    print("STEP 2.  WEEK 1 2026 -- EVERY GAME THROUGH THE MODEL")
    print("=" * 92)
    p = project(g, 2026)
    print(f"\n  model error SD from backtest: {se:.2f} pts. Tiers use "
          f"|edge| / {se:.2f}.")
    print(f"\n  {'game':<11}{'market':>9}{'model':>8}{'edge':>7}"
          f"{'t':>6}  {'SPREAD tier':<12}{'mkt tot':>8}{'mod tot':>8}"
          f"{'edge':>7}{'t':>6}  {'TOTAL tier'}")
    out = []
    for _, r in p.iterrows():
        e_s = r.model_spread - r.mkt_spread
        t_s, ts = tier(e_s, se)
        e_t = r.model_total - r.mkt_total
        t_t, tt = tier(e_t, se * 1.35)      # totals are noisier
        side = r.home if e_s < 0 else r.away
        ou = "over" if e_t > 0 else "under"
        out.append(dict(game=f"{r.away}@{r.home}", spread_tier=t_s,
                        total_tier=t_t, edge_s=e_s, edge_t=e_t,
                        side=side, ou=ou, t_s=ts, t_t=tt))
        print(f"  {r.away+'@'+r.home:<11}{r.mkt_spread:>+9.1f}"
              f"{r.model_spread:>+8.1f}{e_s:>+7.1f}{ts:>6.2f}  {t_s:<12}"
              f"{r.mkt_total:>8.1f}{r.model_total:>8.1f}{e_t:>+7.1f}"
              f"{tt:>6.2f}  {t_t}")

    o = pd.DataFrame(out)
    print("\n" + "-" * 92)
    print("  TIER COUNTS")
    for t in ["BEST", "GOOD", "MODERATE", "BAD BET", "DO NOT BET"]:
        print(f"    {t:<12} spreads {int((o.spread_tier==t).sum()):>3}"
              f"    totals {int((o.total_tier==t).sum()):>3}")
    return o


if __name__ == "__main__":
    g = load()
    d, se = backtest(g)
    week1_2026(g, se)
