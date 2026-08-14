"""
Line-blind game model — power ratings -> win probability.

This is NOT an edge. The market is sharper (line-blind MAE 10.15 vs the closing
line's 9.89). It is the *trust engine*: an honest prediction made with no
knowledge of the betting line, published and LOCKED before kickoff, with
calibration tracked publicly so anyone can check we're honest, not lucky.

Method, grounded in the project's findings:
  - Rating = a team's mean point differential last season (point diff subsumes
    win-loss record, coefficient -0.010 vs +0.450 — so never use W-L).
  - Regress the rating gap toward zero for early-season uncertainty + roster churn.
  - Predicted margin -> win prob via the EMPIRICAL margin distribution, never a
    Gaussian (mass sits on 3 and 7; a normal curve misprices both).

    python analysis/game_model.py            # print Week 1 2026 predictions
    python analysis/game_model.py --week 2
"""
import argparse
import numpy as np
import pandas as pd

MODEL_VERSION = "game-v1-powerdiff"
HFA = 2.0        # home-field advantage, points
REGRESS = 0.70   # shrink last-season rating gap toward the mean


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


def win_curve(g):
    """Historical (|margin|, fav_margin) pairs for the empirical margin->winprob map."""
    s = g[(g.game_type == "REG") & g.home_score.notna() & g.spread_line.notna()].copy()
    s["margin"] = s.home_score - s.away_score
    s["fav_margin"] = np.where(s.spread_line >= 0, s.margin, -s.margin)
    s["fav_mag"] = s.spread_line.abs()
    return s[["fav_mag", "fav_margin"]].to_numpy()


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
    prior = ratings(g, season - 1)
    curve = win_curve(g)
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
