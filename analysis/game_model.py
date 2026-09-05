"""
Line-blind game model — power ratings -> win probability.

This is NOT an edge. The market is sharper (line-blind MAE 10.15 vs the closing
line's 9.89). It is the *trust engine*: an honest prediction made with no
knowledge of the betting line, published and LOCKED before kickoff, with
calibration tracked publicly so anyone can check we're honest, not lucky.

Method, grounded in the project's findings:
  - Rating = prior-season mean point differential BLENDED with this season's games
    so far (see PRIOR_K). Point differential subsumes win-loss record entirely
    (coefficient -0.010 vs +0.450), so never feed W-L into a rating.
  - Regress the rating gap toward zero for early-season uncertainty + roster churn.
  - Predicted margin -> win prob via the EMPIRICAL margin distribution, never a
    Gaussian (mass sits on 3 and 7; a normal curve misprices both).

    python analysis/game_model.py            # print Week 1 2026 predictions
    python analysis/game_model.py --week 2
"""
import argparse
import numpy as np
import pandas as pd

MODEL_VERSION = "game-v3-inseason"
HFA = 2.0        # home-field advantage, points
REGRESS = 0.65   # shrink the rating gap toward the mean

# Weight of the PRIOR season, expressed in games of this season. A team's rating is the
# games-weighted blend of what it did last year and what it has done so far this year:
#
#     rating = (n * this_season_mean + PRIOR_K * last_season_mean) / (n + PRIOR_K)
#
# At n = 0 it is exactly last season (correct in Week 1); by n = 5 the two carry equal weight;
# by Week 12 the current season dominates. Before this, the model used last season ONLY, all
# season long -- so in Week 15 it was still rating teams on the previous year and produced the
# same number for a given matchup every single day of the season.
#
# Tuned on 2016-2022 and tested on HELD-OUT 2023-2025 (816 games):
#     prior-season only (the old model) : MAE 11.095
#     in-season blend, K=5 REGRESS=0.65 : MAE 10.303   (-0.79 pts/game)
#     the closing line                  : MAE  9.744
# i.e. it closes 59% of the gap to the market. The optimum is flat (K 3-6 x REGRESS 0.60-0.70 all
# land in 10.28-10.33), so this is not balanced on a knife-edge.
#
# Still NOT an edge -- the market remains sharper, exactly as the docstring says. This makes the
# published prediction defensible, not profitable.
PRIOR_K = 5.0


def load(path="../data/games.csv"):
    return pd.read_csv(path, low_memory=False)


def ratings(g, season):
    """Mean point differential per team over a completed regular season."""
    s = g[(g.season == season) & (g.game_type == "REG") & g.home_score.notna()].copy()
    s["margin"] = s.home_score - s.away_score
    diff = {}
    cnt = {}
    for _, r in s.iterrows():
        diff[r.home_team] = diff.get(r.home_team, 0) + r.margin
        diff[r.away_team] = diff.get(r.away_team, 0) - r.margin
        cnt[r.home_team] = cnt.get(r.home_team, 0) + 1
        cnt[r.away_team] = cnt.get(r.away_team, 0) + 1
    return {t: diff[t] / cnt[t] for t in diff}


def ratings_asof(g, season, week):
    """Team ratings as they stand BEFORE `week` of `season`.

    Prior-season mean point differential blended with this season's completed games, weighted by
    PRIOR_K. Uses only games with week < `week`, so there is no look-ahead: everything here was
    knowable before the week kicked off, which is what lets the prediction stay line-blind AND
    publishable pre-kickoff.

    A team absent from last season (expansion, or a name change) simply starts at 0.0 and is
    carried entirely by its current-season games."""
    prior = ratings(g, season - 1)
    s = g[(g.season == season) & (g.game_type == "REG") & g.home_score.notna() & (g.week < week)]
    cum, cnt = {}, {}
    for _, r in s.iterrows():
        m = r.home_score - r.away_score
        for t, d in ((r.home_team, m), (r.away_team, -m)):
            cum[t] = cum.get(t, 0.0) + d
            cnt[t] = cnt.get(t, 0) + 1
    out = {}
    for t in set(prior) | set(cnt):
        p = prior.get(t, 0.0)
        n = cnt.get(t, 0)
        out[t] = p if n == 0 else (cum[t] + PRIOR_K * p) / (n + PRIOR_K)
    return out


def win_curve(g):
    """Historical (|market spread|, fav_margin) pairs. NOTE: calibrated for MARKET
    spreads, which are sharper than model margins — using it on model margins made
    the model overconfident (see grade_predictions.py --backtest). Kept for reference;
    predict_week now uses model_win_curve instead."""
    s = g[(g.game_type == "REG") & g.home_score.notna() & g.spread_line.notna()].copy()
    s["margin"] = s.home_score - s.away_score
    s["fav_margin"] = np.where(s.spread_line >= 0, s.margin, -s.margin)
    s["fav_mag"] = s.spread_line.abs()
    return s[["fav_mag", "fav_margin"]].to_numpy()


def model_win_curve(g, before_season):
    """Self-calibrating curve: (predicted fav-margin magnitude, actual fav margin)
    from the MODEL's OWN out-of-sample predictions over seasons < before_season.
    Because it learns win rates from the model's noisier margins, a given predicted
    margin implies the certainty it actually earns — fixing the overconfidence.

    Built WEEK BY WEEK with ratings_asof, exactly as predict_week forms a live prediction. If the
    curve were built from full-season prior ratings while predictions used in-season ratings, the
    two would disagree about what a "+7 predicted margin" means and every published probability
    would be miscalibrated — the mapping has to learn from the same estimator that produces it.
    """
    frames = []
    for season in sorted(s for s in g.season.unique() if s < before_season):
        if not ratings(g, season - 1):
            continue
        sea = g[(g.season == season) & (g.game_type == "REG") & g.home_score.notna()]
        for week in sorted(sea.week.unique()):
            rt = ratings_asof(g, season, week)
            s = sea[sea.week == week].copy()
            neutral = s["location"].astype(str).eq("Neutral") if "location" in s else False
            hfa = np.where(neutral, 0.0, HFA)
            margin = REGRESS * (s.home_team.map(rt).fillna(0.0) - s.away_team.map(rt).fillna(0.0)) + hfa
            s["fav_mag"] = margin.abs()
            s["fav_margin"] = np.where(margin >= 0, s.home_score - s.away_score, s.away_score - s.home_score)
            frames.append(s[["fav_mag", "fav_margin"]])
    return pd.concat(frames).to_numpy() if frames else np.empty((0, 2))


def winprob(mag, curve, bw=1.0):
    """Empirical P(favored team wins | predicted margin ~= mag)."""
    m, fm = curve[:, 0], curve[:, 1]
    sel = (m >= mag - bw) & (m <= mag + bw)
    if sel.sum() < 120:
        sel = (m >= mag - 2.5) & (m <= mag + 2.5)
    s = fm[sel]
    if not len(s):
        return 0.5
    wins = int((s > 0).sum())
    ties = int((s == 0).sum())
    denom = len(s) - ties
    return wins / denom if denom else 0.5


def predict_week(g, season, week):
    # Ratings AS OF this week: last season blended with everything played so far this season.
    # This is the input that lets a published number move during the season instead of being a
    # fixed function of last year's point differential.
    prior = ratings_asof(g, season, week)
    curve = model_win_curve(g, before_season=season)   # self-calibrated on prior seasons
    games = g[(g.season == season) & (g.week == week)]
    out = []
    for _, r in games.iterrows():
        h, a = r.home_team, r.away_team
        # Neutral-site (international) games get NO home-field edge — the "home"
        # team is only nominal. Travel/jet-lag effects are Context, not modelled
        # here (small, heterogeneous sample; don't fabricate a number).
        neutral = str(r.get("location")) == "Neutral"
        hfa = 0.0 if neutral else HFA
        margin = REGRESS * (prior.get(h, 0.0) - prior.get(a, 0.0)) + hfa  # home perspective
        fav = h if margin >= 0 else a
        p_fav = winprob(abs(margin), curve)
        p_home = p_fav if fav == h else 1 - p_fav
        out.append({
            "away": a, "home": h, "gameday": r.get("gameday"),
            "neutral": neutral, "venue": r.get("stadium") if neutral else None,
            "pred_margin": round(margin, 1), "fav": fav,
            "home_winprob": round(p_home, 4),
        })
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--week", type=int, default=1)
    args = ap.parse_args(argv)
    g = load()
    preds = predict_week(g, args.season, args.week)
    print(f"LINE-BLIND MODEL ({MODEL_VERSION}) — {args.season} Week {args.week}")
    print(f"{'game':<12}{'pred margin':>12}{'favored':>9}{'home win%':>11}  note")
    for p in preds:
        note = f"NEUTRAL @ {p['venue']}" if p["neutral"] else ""
        print(f"{p['away']+'@'+p['home']:<12}{p['pred_margin']:>+12.1f}"
              f"{p['fav']:>9}{100*p['home_winprob']:>10.1f}%  {note}")


if __name__ == "__main__":
    main()
