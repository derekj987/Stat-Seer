"""
nhl_game_model.py -- line-blind NHL game projections: expected score, margin and total.

    python nhl_game_model.py --backtest        # fit on early seasons, score on held-out ones
    python nhl_game_model.py --dry-run
    python nhl_game_model.py                   # writes web/lib/nhlGameModel.ts

Derek asked for a game board covering spreads and over/unders "just like the other sections", and
that is what The Model section is for: a line-blind number, published before puck drop and graded.
The NCAAF rating is published on exactly that footing — it ties Elo and does NOT beat the spread —
so hockey having one is consistent with the architecture rather than a departure from it.

🚨 SET EXPECTATIONS BEFORE READING THE OUTPUT. This is NOT an edge claim and the page must not make
one. The one hockey input anybody would reach for first, the starting goalie, was already tested
against four seasons of closing moneylines and came back priced: 3,241 games, ROI +0.15% with a
standard error of 2.60 (EMPIRICAL_REFERENCE §14d). A team-rating model is a weaker instrument than
that, so the honest prior is that it lands on the market rather than beside it. It is published
because a line-blind number that is graded in public is the trust engine, which is a different job
from finding a price error.

WHAT IT IS. Goals-for and goals-against rates per team, each shrunk toward the league mean, blended
with last season, then combined into an expected score:

    home goals = (home attack + away defence) / 2 + home ice
    away goals = (away attack + home defence) / 2

Home ice is fitted, not assumed — measured at +0.130 goals across 1,312 games when the margin SD
was computed for lib/nhlBoard.ts, and re-fitted here on the training seasons.

🚨 THE SCORE IS THE OUTPUT; THE PUCK LINE IS NOT. Hockey's puck line is ±1.5 on every game in the
league, and 43.2% of games finish inside one goal, so "our margin vs their spread" is the mistake
the MLB run line already taught this project (§12d). The board therefore publishes an expected
score and total, and converts the margin to a WIN PROBABILITY through the measured margin
distribution rather than pretending a 1.5 line is a number to beat.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import os
import sqlite3
import statistics as st
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(ROOT, "data", "nhl.db")
OUT = os.path.join(ROOT, "web", "lib", "nhlGameModel.ts")

CURRENT_SEASON = 20262027
PRIOR_SEASON = 20252026
# Shrink strengths, in games, fitted on the training seasons by the sweep in --backtest.
# Both fitted by --sweep on the training seasons, scored on 2,504 held-out games.
REGRESS_K = 6           # toward the league mean
# 🚨 ZERO, AND THAT IS THE MEASUREMENT, NOT AN OVERSIGHT. Carrying last season forward HURTS once a
# season is underway: margin beats its baseline by +2.04% at weight 0 against +1.51% at 20 and
# +1.45% at 200, and the total crosses from -0.16% to +0.07% over the same range. Last year's
# ratings are stale information in a league this high-variance.
#
# WHAT THE SWEEP DOES NOT TEST, stated because it is the obvious objection: the backtest skips each
# season's first 60 games, so the early-season case — where a team has three games and a prior
# would matter most — is untested. The shrink toward the LEAGUE mean (REGRESS_K) already carries
# that load: at six games a team's rating is half its own and half the league's.
PRIOR_W = 0
MARGIN_SD = 2.569       # measured, 1,312 games (see lib/nhlBoard.ts)


def load_games(conn):
    """[(season, date, home, away, home_goals, away_goals)] — the score reconstructed from the
    goalie rows: a team's goals-against, summed over its goalies, IS the opponent's goals."""
    rows = conn.execute(
        "select game_id, season, game_date, team, opponent, is_home, goals_against"
        "  from nhl_goalie_starts order by game_date, game_id").fetchall()
    by = collections.defaultdict(list)
    for r in rows:
        by[r[0]].append(r)
    out = []
    for gid, rs in by.items():
        sides = collections.defaultdict(int)
        meta = {}
        for _, season, date_s, team, opp, is_home, ga in rs:
            sides[team] += ga or 0
            meta[team] = (is_home, opp, season, date_s)
        if len(sides) != 2:
            continue
        home = [t for t, m in meta.items() if m[0] == 1]
        away = [t for t, m in meta.items() if m[0] == 0]
        if len(home) != 1 or len(away) != 1:
            continue
        h, a = home[0], away[0]
        # conceded by the AWAY side = home goals
        out.append((meta[h][2], meta[h][3], h, a, sides[a], sides[h]))
    return sorted(out, key=lambda x: (x[1],))


def ratings(games, upto_date=None, season=None):
    """Attack/defence goal rates per team, shrunk toward the league mean.

    Walks forward: only games strictly BEFORE upto_date count, which is what makes a backtest
    honest. A team's attack is goals scored per game, its defence goals allowed per game."""
    gf, ga, gp = collections.Counter(), collections.Counter(), collections.Counter()
    tot_goals = tot_games = 0
    for s, d, h, a, hg, ag in games:
        if season is not None and s != season:
            continue
        if upto_date is not None and d >= upto_date:
            continue
        gf[h] += hg; ga[h] += ag; gp[h] += 1
        gf[a] += ag; ga[a] += hg; gp[a] += 1
        tot_goals += hg + ag
        tot_games += 2
    lg = (tot_goals / tot_games) if tot_games else 3.0
    att, dfn = {}, {}
    for t in gp:
        n = gp[t]
        att[t] = (gf[t] + lg * REGRESS_K) / (n + REGRESS_K)
        dfn[t] = (ga[t] + lg * REGRESS_K) / (n + REGRESS_K)
    return att, dfn, lg


def blend_prior(cur, prior, lg, weight=None):
    """Carry last season forward: early in a year a team's own 6 games say less than last year's 82.

    🚨 `weight=None` RATHER THAN `weight=PRIOR_W`. A default argument is evaluated once, when the
    function is defined, so writing PRIOR_W there froze the import-time value into the signature —
    the parameter sweep reassigned the global and every PRIOR_W row came back byte-identical,
    which is what exposed it. Read the module global at CALL time instead."""
    if weight is None:
        weight = PRIOR_W
    out = {}
    for t in set(cur) | set(prior):
        c = cur.get(t, lg)
        p = prior.get(t, lg)
        out[t] = (c + p * weight) / (1 + weight) if t in prior else c
    return out


def project(att_h, dfn_h, att_a, dfn_a, lg, hfa):
    """Expected goals for each side. Attack and the opposing defence are averaged — each is an
    estimate of the same quantity from a different direction, and neither is better informed."""
    hg = (att_h + dfn_a) / 2 + hfa / 2
    ag = (att_a + dfn_h) / 2 - hfa / 2
    return max(0.5, hg), max(0.5, ag)


def norm_cdf(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def win_prob(margin):
    """P(home wins) from an expected margin, through the measured margin SD.

    Hockey has no ties, so this is P(margin > 0). The normal is a poor fit to a distribution with
    43% of its mass on |1| — the ORDERING is reliable, the third decimal is not, which is why the
    page prints a percentage and never a price."""
    return norm_cdf(margin / MARGIN_SD)


def fit_hfa(games, seasons):
    diffs = [hg - ag for s, d, h, a, hg, ag in games if s in seasons]
    return st.mean(diffs) if diffs else 0.13


def backtest(games, train, hold):
    hfa = fit_hfa(games, train)
    print(f"  fitted home ice on train: {hfa:+.3f} goals")
    # Walk the held-out seasons game by game, rating only on what came before.
    rows = [g for g in games if g[0] in hold]
    by_season = collections.defaultdict(list)
    for g in rows:
        by_season[g[0]].append(g)
    tot = {"n": 0, "mae_margin": [], "mae_total": [], "base_margin": [], "base_total": [],
           "correct": 0, "brier": []}
    for season, gs in by_season.items():
        prior_att, prior_dfn, prior_lg = ratings(games, season=season - 10001)
        for i, (s, d, h, a, hg, ag) in enumerate(gs):
            if i < 60:
                continue                        # let the season accumulate a little first
            att, dfn, lg = ratings(games, upto_date=d, season=season)
            att = blend_prior(att, prior_att, lg)
            dfn = blend_prior(dfn, prior_dfn, lg)
            if h not in att or a not in att:
                continue
            ph, pa = project(att[h], dfn[h], att[a], dfn[a], lg, hfa)
            m, t = ph - pa, ph + pa
            tot["n"] += 1
            tot["mae_margin"].append(abs(m - (hg - ag)))
            tot["mae_total"].append(abs(t - (hg + ag)))
            # Baseline: home ice and the league total, i.e. knowing nothing about the teams.
            tot["base_margin"].append(abs(hfa - (hg - ag)))
            tot["base_total"].append(abs(2 * lg - (hg + ag)))
            p = win_prob(m)
            tot["correct"] += (p > 0.5) == (hg > ag)
            tot["brier"].append((p - (1 if hg > ag else 0)) ** 2)
    n = tot["n"]
    if not n:
        print("  no held-out games")
        return
    print(f"  held out {n:,} games over {sorted(hold)}")
    print(f"    margin MAE  {st.mean(tot['mae_margin']):.4f}  vs baseline {st.mean(tot['base_margin']):.4f}"
          f"   {(st.mean(tot['base_margin'])-st.mean(tot['mae_margin']))/st.mean(tot['base_margin'])*100:+.2f}%")
    print(f"    total  MAE  {st.mean(tot['mae_total']):.4f}  vs baseline {st.mean(tot['base_total']):.4f}"
          f"   {(st.mean(tot['base_total'])-st.mean(tot['mae_total']))/st.mean(tot['base_total'])*100:+.2f}%")
    print(f"    winner called right {tot['correct']/n*100:.1f}%   Brier {st.mean(tot['brier']):.4f}"
          f"  (always-home baseline Brier {st.mean([(0.5-(1 if g[4]>g[5] else 0))**2 for g in rows]):.4f})")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backtest", action="store_true")
    ap.add_argument("--sweep", action="store_true",
                    help="grid the shrink strengths before believing a single setting")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args(argv)

    conn = sqlite3.connect(DB)
    games = load_games(conn)
    seasons = sorted({g[0] for g in games})
    print(f"{len(games):,} games across {seasons}")

    if args.sweep:
        global REGRESS_K, PRIOR_W
        hold = {20242025, 20252026}
        train = {x for x in seasons if x not in hold}
        print(f"{'REGRESS_K':>10} {'PRIOR_W':>8} {'margin MAE':>11} {'vs base':>9} {'total MAE':>10} {'vs base':>9}")
        for k in (6, 12, 18, 30, 50):
            for w in (0, 5, 20, 60):
                REGRESS_K, PRIOR_W = k, w
                import io as _io, contextlib
                buf = _io.StringIO()
                with contextlib.redirect_stdout(buf):
                    backtest(games, train, hold)
                t = buf.getvalue()
                import re as _re
                mm = _re.search(r"margin MAE\s+([\d.]+)\s+vs baseline\s+([\d.]+)\s+([+-][\d.]+)%", t)
                tt = _re.search(r"total  MAE\s+([\d.]+)\s+vs baseline\s+([\d.]+)\s+([+-][\d.]+)%", t)
                if mm and tt:
                    print(f"{k:10} {w:8} {mm.group(1):>11} {mm.group(3)+'%':>9} {tt.group(1):>10} {tt.group(3)+'%':>9}")
        return 0

    if args.backtest:
        hold = {20242025, 20252026}
        train = {s for s in seasons if s not in hold}
        print(f"train {sorted(train)}  holdout {sorted(hold)}")
        backtest(games, train, hold)
        return 0

    hfa = fit_hfa(games, set(seasons) - {CURRENT_SEASON})
    prior_att, prior_dfn, prior_lg = ratings(games, season=PRIOR_SEASON)
    att, dfn, lg = ratings(games, season=CURRENT_SEASON)
    att = blend_prior(att, prior_att, lg)
    dfn = blend_prior(dfn, prior_dfn, lg)
    teams = sorted(att)
    print(f"{len(teams)} teams rated; league {lg:.3f} goals/game, home ice {hfa:+.3f}")

    out = []
    for t in teams:
        out.append({"team": t, "attack": round(att[t], 3), "defence": round(dfn[t], 3)})
    if args.dry_run:
        for r in sorted(out, key=lambda r: -r["attack"])[:5]:
            print("   ", r)
        print("DRY RUN — nothing written.")
        return 0

    head = [
        "// AUTO-GENERATED by nhl_game_model.py — do not edit by hand.",
        "// Line-blind NHL team ratings: goals scored and allowed per game, shrunk toward the",
        "// league mean and blended with last season. lib/nhlGame.ts turns two of these into an",
        "// expected score; helpers belong there, never in this file, which is rewritten on every",
        "// refresh.",
        f"// {len(teams)} teams. League {lg:.3f} goals/game. Home ice {hfa:+.3f} goals.",
        "",
        "export interface NhlTeamRating { team: string; attack: number; defence: number }",
        f"export const NHL_LEAGUE_GOALS = {lg:.3f};",
        f"export const NHL_HOME_ICE = {hfa:.3f};",
        f"export const NHL_MARGIN_SD = {MARGIN_SD};",
        "export const NHL_RATINGS: NhlTeamRating[] = [",
    ]
    body = [f"  {json.dumps(r)}," for r in out]
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(head + body + ["];", ""]))
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
