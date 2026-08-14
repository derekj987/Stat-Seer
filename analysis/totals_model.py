"""
Line-blind TOTALS model, to sit beside the margin model. Predicts a game's total
points (and, split by the margin model, each team's total).

Method (mirrors game_model.py's discipline):
  * A team's "game-total tendency" = avg points in its games last season (PF+PA).
  * Predicted total = regress the two teams' average tendency toward the league total.
  * Team totals = predicted_total split by the model's predicted margin.

This is line-blind and NOT expected to beat the market (totals are efficiently
priced) — it's an honest independent prediction for the model-vs-market view.
Backtested here to (a) pick the regression k, (b) confirm it's calibrated, and
(c) measure how far behind the market total it runs.

    python analysis/totals_model.py
"""
import numpy as np
import pandas as pd

TESTS = range(2015, 2026)   # walk-forward test seasons (prior season supplies ratings)


def tendencies(g, season):
    """Per-team avg game total (PF+PA per game) and the league avg game total."""
    s = g[(g.season == season) & (g.game_type == "REG") & g.home_score.notna()].copy()
    s["tot"] = s.home_score + s.away_score
    t, c = {}, {}
    for _, r in s.iterrows():
        for team in (r.home_team, r.away_team):
            t[team] = t.get(team, 0) + r.tot
            c[team] = c.get(team, 0) + 1
    return {k: t[k] / c[k] for k in t}, s.tot.mean()


def backtest(g, k):
    pe, me, ne, bias = [], [], [], []
    for Y in TESTS:
        tend, Lt = tendencies(g, Y - 1)
        s = g[(g.season == Y) & (g.game_type == "REG") & g.home_score.notna()]
        for _, r in s.iterrows():
            h, a = r.home_team, r.away_team
            if h not in tend or a not in tend:
                continue
            pred = Lt + k * ((tend[h] + tend[a]) / 2 - Lt)
            actual = r.home_score + r.away_score
            pe.append(abs(pred - actual))
            bias.append(pred - actual)
            if pd.notna(r.total_line):
                me.append(abs(r.total_line - actual))
            ne.append(abs(Lt - actual))
    return (np.mean(pe), np.mean(me), np.mean(ne), np.mean(bias), len(pe))


def main():
    g = pd.read_csv("data/games.csv", low_memory=False)
    print(f"Totals model backtest — walk-forward {min(TESTS)}-{max(TESTS)}\n")
    print(f"{'k (regression)':<16}{'model MAE':>11}{'bias':>8}")
    best = None
    for k in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
        pmae, mmae, nmae, bias, n = backtest(g, k)
        print(f"{k:<16.2f}{pmae:>11.3f}{bias:>+8.2f}")
        if best is None or pmae < best[1]:
            best = (k, pmae, mmae, nmae, bias, n)
    k, pmae, mmae, nmae, bias, n = best
    print(f"\nBest k = {k:.2f}  (n={n:,} games)")
    print(f"  naive (league avg total) MAE : {nmae:6.3f}")
    print(f"  MODEL total              MAE : {pmae:6.3f}")
    print(f"  MARKET total (total_line)MAE : {mmae:6.3f}")
    print(f"  model vs market            : {pmae - mmae:+.3f} pts "
          f"({'market sharper' if mmae < pmae else 'model sharper'})")
    print(f"  model beats naive by       : {nmae - pmae:+.3f} pts")


if __name__ == "__main__":
    main()
