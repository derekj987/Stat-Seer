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

MODEL_VERSION = "game-v4-injury"
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


def model_win_curve(g, before_season, adj_fn=None):
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
            if adj_fn is not None:
                # Same correction the live prediction gets. If the curve were built WITHOUT it while
                # predictions applied it, the two would again disagree about what a given predicted
                # margin means — the exact mismatch the week-aware fix above was written for.
                a = adj_fn(season, week) or {}
                if a:
                    margin = margin + s.home_team.map(a).fillna(0.0) - s.away_team.map(a).fillna(0.0)
            s["fav_mag"] = margin.abs()
            s["fav_margin"] = np.where(margin >= 0, s.home_score - s.away_score, s.away_score - s.home_score)
            s["wk"] = week
            frames.append(s[["fav_mag", "fav_margin", "wk"]])
    return pd.concat(frames).to_numpy() if frames else np.empty((0, 3))


_HIST_ADJ = {}


def _hist_adj(season, week):
    """Injury adjustment for a PAST week, memoised — model_win_curve asks for every week of every
    training season, so recomputing shares each time would dominate the run."""
    kk = (season, week)
    if kk not in _HIST_ADJ:
        try:
            import injury_adj
            _HIST_ADJ[kk] = injury_adj.team_adjustment(season, week)
        except Exception:                        # noqa: BLE001
            _HIST_ADJ[kk] = {}
    return _HIST_ADJ[kk]


# How far either side of the target week the curve may look for comparable predictions.
WEEK_BAND = 4


def winprob(mag, curve, week=None, bw=1.0):
    """Empirical P(favored team wins | predicted margin ~= mag), CONDITIONED ON SEASON PROGRESS.

    The week matters because the estimator itself changes over a season: in Week 1 a rating is pure
    prior-season, by Week 12 it is mostly current-season and materially sharper. A single curve
    learns the AVERAGE accuracy and therefore hands Week 1 the confidence Week 12 earned.

    Measured on held-out 2023-2025 with an unconditioned curve, and note how the aggregate hides it:

        weeks 1-2    predicted 63.6%   actual 60.4%   -3.2   overconfident
        weeks 3-5    predicted 63.4%   actual 56.9%   -6.5   overconfident
        weeks 6-10   predicted 63.2%   actual 66.8%   +3.6   underconfident
        weeks 11-18  predicted 63.0%   actual 64.7%   +1.6
        ALL WEEKS    predicted 63.2%   actual 63.4%   +0.2   <- looks perfect

    That +0.2 is two real errors cancelling. Since these numbers are published and locked, an early
    week publishing 63.6% where 60.4% is earned is a calibration claim we would later fail in public.

    Falls back to the whole curve when a week band is too thin to say anything — a wider,
    slightly-miscalibrated estimate beats a confident one drawn from 20 games."""
    m, fm = curve[:, 0], curve[:, 1]
    wk = curve[:, 2] if curve.shape[1] > 2 else None
    near = np.ones(len(m), dtype=bool) if (week is None or wk is None) else (np.abs(wk - week) <= WEEK_BAND)

    for band in (bw, 2.5, 4.0):
        sel = near & (m >= mag - band) & (m <= mag + band)
        if sel.sum() >= 120:
            break
    else:
        sel = (m >= mag - 2.5) & (m <= mag + 2.5)      # give up on the week, keep the magnitude
    s = fm[sel]
    if not len(s):
        return 0.5
    wins = int((s > 0).sum())
    ties = int((s == 0).sum())
    denom = len(s) - ties
    return wins / denom if denom else 0.5


def predict_week(g, season, week, adj=None):
    # Ratings AS OF this week: last season blended with everything played so far this season.
    # This is the input that lets a published number move during the season instead of being a
    # fixed function of last year's point differential.
    prior = ratings_asof(g, season, week)
    # Points each team loses to players ruled OUT. {} when no injury report exists yet (preseason,
    # or before a week's reports are filed), in which case the model predicts unadjusted rather
    # than guessing. See analysis/injury_adj.py for how the coefficients were measured.
    if adj is None:
        try:
            import injury_adj
            adj = injury_adj.team_adjustment(season, week)
        except Exception:                        # noqa: BLE001 — the correction is never a hard dep
            adj = {}
    curve = model_win_curve(g, before_season=season,
                            adj_fn=(lambda sn, wk: _hist_adj(sn, wk)) if adj else None)
    games = g[(g.season == season) & (g.week == week)]
    out = []
    for _, r in games.iterrows():
        h, a = r.home_team, r.away_team
        # Neutral-site (international) games get NO home-field edge — the "home"
        # team is only nominal. Travel/jet-lag effects are Context, not modelled
        # here (small, heterogeneous sample; don't fabricate a number).
        neutral = str(r.get("location")) == "Neutral"
        hfa = 0.0 if neutral else HFA
        margin = (REGRESS * (prior.get(h, 0.0) - prior.get(a, 0.0)) + hfa
                  + adj.get(h, 0.0) - adj.get(a, 0.0))                     # home perspective
        fav = h if margin >= 0 else a
        p_fav = winprob(abs(margin), curve, week)
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
