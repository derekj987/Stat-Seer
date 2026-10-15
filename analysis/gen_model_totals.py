"""
Precompute the line-blind MODEL TOTAL for every 2026 game and emit a small TS map the model board
and the homepage import. Honest independent prediction, NOT an edge, and labelled that way.

    python analysis/gen_model_totals.py

🚨 THIS IS NO LONGER DETERMINISTIC FROM LAST SEASON, SO IT HAS TO BE REGENERATED. It used to be a
pure function of 2025 and the old docstring said "precomputing is fine" — which was true of the old
model and is the reason nothing ever re-ran it. It now reads the CURRENT season as it goes, so a
stale file prices week 10 off week 1. It runs in refresh-model-totals (daily) for that reason.

WHY IT CHANGED (analysis/totals_inseason.py). The margin model was given an in-season blend months
ago; the totals model never was, so a team scoring 31 a game was still priced off last year. Walking
the season forward and weighting games-played against the prior season, chosen on TRAIN 2018-22 and
confirmed once on HELD-OUT 2023-25:

    setting              train MAE   held-out MAE
    cur_w 0,   k 0.50      11.119       10.501     <- what shipped
    cur_w 1.5, k 0.75      10.980       10.402     <- this
    cur_w 3.0, k 0.75      11.016       10.493     <- too much; the optimum is interior

About +1% against what games actually score, in both splits, with the optimum in the interior of
the grid rather than on an edge. CUR_W 1.5 / K 0.75 is best-or-tied in both — the MAE curve is flat
enough that picking the single best cell on either split alone would be fitting noise.

🚨 WHAT THIS DOES NOT DO, STATED HERE BECAUSE THE REPORT CARD WILL TEMPT SOMEONE TO TRY AGAIN. It
does not make the number beat the closing total, and nothing does. Across 2,111 games the over/under
record against the close runs 47.3%-51.4% at EVERY setting in the sweep, including the ones that let
the column swing hardest. The 2026 board's 29-50 over five weeks is that coin flip landing badly at
n=79, not a defect with a fix in it. The level was never the problem either: our totals average
46.1 against 46.6 actually scored, where the market averages 44.9.

And the shrink is CORRECT, not timidity. K below 1 pulls each game toward the league rate, which is
what a less-informed forecaster's best estimate should do — it is why our MAE is close to the
market's at all. The cost is that the column varies less than the market's line (sd ~2.6 against
~4.1), so "ours versus theirs" is mostly the market's own line read backwards. That is an argument
against printing a SIDE from this number, not an argument for unshrinking it, and the board no
longer prints one.
"""
import io
import os
import sys
import urllib.request

import pandas as pd

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMES_LOCAL = os.path.join(_ROOT, "data", "games.csv")
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
SEASON = 2026
# Chosen on TRAIN 2018-22, confirmed on HELD-OUT 2023-25. See the module docstring.
CUR_W = 1.5     # how hard this season's games-so-far pull against the prior season
K = 0.75        # regression of the pair's tendency toward the league rate
MIN_PRIOR_GAMES = 4
LEAGUE_MIN_GAMES = 16   # before this many games the league anchor stays on last season's rate
OUT = os.path.join(_ROOT, "web", "lib", "modelTotals.ts")


def load_games():
    """The schedule with scores, fetched if `data/` is not present — that directory is gitignored,
    and a script whose input only exists locally is the shape that had `injury_adj` publishing
    unadjusted for weeks. Raises rather than returning an empty frame: this file is read by the
    board, so writing a stale or short one is worse than failing the job."""
    if os.path.exists(GAMES_LOCAL):
        g = pd.read_csv(GAMES_LOCAL, low_memory=False)
    else:
        req = urllib.request.Request(GAMES_URL, headers={"User-Agent": "statseer/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            g = pd.read_csv(io.BytesIO(r.read()), low_memory=False)
    played = g[(g.season == SEASON - 1) & (g.game_type == "REG") & g.home_score.notna()]
    if len(played) < 200:
        raise SystemExit(f"refusing to write: only {len(played)} completed {SEASON - 1} games in "
                         "the schedule, so the prior-season baseline would be built on nothing")
    return g


def season_tendencies(g, season):
    """{team: mean game total} and the league mean, over one completed season."""
    s = g[(g.season == season) & (g.game_type == "REG") & g.home_score.notna()].copy()
    s["tot"] = s.home_score + s.away_score
    t, c = {}, {}
    for _, r in s.iterrows():
        for team in (r.home_team, r.away_team):
            t[team] = t.get(team, 0.0) + r.tot
            c[team] = c.get(team, 0) + 1
    return ({k: t[k] / c[k] for k in t if c[k] >= MIN_PRIOR_GAMES},
            float(s.tot.mean()) if len(s) else float("nan"))


def main():
    g = load_games()
    prior, prior_lg = season_tendencies(g, SEASON - 1)
    sched = g[(g.season == SEASON) & (g.game_type == "REG")].sort_values(["week"])

    # Walk the season forward exactly as the backtest does: a week is predicted from the state
    # BEFORE it, then that week's results are folded in. Weeks still to play all share the latest
    # state, which is what makes this file need regenerating rather than precomputing once.
    run_tot, run_n = {}, {}
    lg_tot, lg_n = 0.0, 0
    rows = {}
    for wk in sorted(sched.week.unique()):
        games = sched[sched.week == wk]
        lg_now = (lg_tot / lg_n) if lg_n >= LEAGUE_MIN_GAMES else prior_lg

        def tend(team):
            pr = prior.get(team)
            if pr is None:
                return None
            n = run_n.get(team, 0)
            if not n:
                return pr
            # Weight by games played: a team with n games this year and a full prior season puts
            # CUR_W * n/(n+16) of the weight on this year, so week 1 leans on last season and the
            # back half of the schedule leans on this one.
            w = CUR_W * n / (n + 16.0)
            return (1 - w) * pr + w * (run_tot[team] / n)

        for _, r in games.iterrows():
            th, ta = tend(r.home_team), tend(r.away_team)
            if th is None or ta is None:
                continue
            pred = lg_now + K * ((th + ta) / 2.0 - lg_now)
            rows[f"{int(r.week)}-{r.away_team}-{r.home_team}"] = round(float(pred), 1)

        for _, r in games.iterrows():
            if pd.isna(r.home_score):
                continue
            tot = float(r.home_score) + float(r.away_score)
            for team in (r.home_team, r.away_team):
                run_tot[team] = run_tot.get(team, 0.0) + tot
                run_n[team] = run_n.get(team, 0) + 1
            lg_tot += tot
            lg_n += 1

    played = lg_n
    lines = [
        "// AUTO-GENERATED by analysis/gen_model_totals.py — do not edit by hand.",
        "// Line-blind model total (combined points), keyed by `${week}-${away}-${home}`.",
        "// Blends the PRIOR season with this season as it goes (CUR_W 1.5, K 0.75, chosen on",
        "// 2018-22 and confirmed on 2023-25: about +1% on MAE against what games actually score).",
        "// It does NOT beat the closing total — over 2,111 games the over/under record against the",
        "// close is a coin flip at every setting — so the board shows the number beside the",
        "// market's and no longer calls a side. See docs/EMPIRICAL_REFERENCE.md §3.",
        f"// {played} games of {SEASON} folded in at generation time; regenerate weekly.",
        "export const MODEL_TOTALS: Record<string, number> = {",
    ]
    for k in sorted(rows, key=lambda x: (int(x.split("-")[0]), x)):
        lines.append(f'  "{k}": {rows[k]},')
    lines.append("};")
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"wrote {len(rows)} model totals to {OUT}")
    print(f"  prior-season league total {prior_lg:.1f}; {played} {SEASON} games folded in"
          + (f", league so far {lg_tot / lg_n:.1f}" if lg_n else ""))


if __name__ == "__main__":
    main()
