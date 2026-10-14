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
standard error of 2.60 (EMPIRICAL_REFERENCE §18d). A team-rating model is a weaker instrument than
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
CHAOS_WINDOW = 2        # completed seasons behind the current one, matching analysis/chaos_traits.py


def load_games(conn):
    """[(season, date, home, away, home_goals, away_goals)] from the OFFICIAL score.

    🚨 NOT RECONSTRUCTED FROM THE GOALIE ROWS, and the difference is not small. An empty-net goal is
    charged to no goalie, and a shootout decider is not charged either, so summing goals_against
    across a team's goalies misses both: measured across 6,646 games the official mean total is
    6.241 against 5.804 reconstructed, a gap of 0.437 goals a game. Shootouts are only 7.2% of
    games, so the bulk of it is empty netters.

    The first version of this model did reconstruct, and it carried that 0.437 into every projected
    total — against a market averaging 6.095 it would have read UNDER on very nearly every game.
    That is the one-way-lean failure this project has already been bitten by twice, and it was
    caught here only by checking our totals against the market's before shipping the column.
    """
    rows = conn.execute(
        "select season, game_date, home, away, home_score, away_score"
        "  from nhl_game_results where home_score is not null and away_score is not null"
        "  order by game_date, game_id").fetchall()
    return [(r[0], r[1], r[2], r[3], r[4], r[5]) for r in rows]


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


# Expected-margin bands for the EMPIRICAL win curve. Hockey margins are tightly packed, so the
# bands are narrow in the middle where almost every game sits and open up at the edges.
WIN_BANDS = [-9, -0.60, -0.40, -0.25, -0.12, 0.0, 0.12, 0.25, 0.40, 0.60, 9]


def win_prob(margin):
    """P(home wins) from an expected margin, through the measured MARGIN SD — the OLD way, kept
    only so the backtest can score it against the empirical curve that replaced it."""
    return norm_cdf(margin / MARGIN_SD)


def fit_win_table(pairs):
    """[(lo, hi, mid_margin, n, p_home_win)] counted off real outcomes.

    🚨 WHY NOT A NORMAL. An NHL margin distribution is nothing like one: there are no ties, 43.2%
    of games finish inside a single goal, and ~25% are settled in overtime or a shootout where the
    winning margin can ONLY be one. §14d measured the companion effect on totals — 68% of them land
    odd, because a shootout adds exactly one goal, and a fitted Poisson misprices the push on a 6.0
    total by five points. The same objection applies to putting a smooth curve over margins, so the
    curve is counted rather than assumed."""
    out = []
    for lo, hi in zip(WIN_BANDS, WIN_BANDS[1:]):
        v = [(m, w) for m, w in pairs if lo <= m < hi]
        if len(v) < 150:
            continue
        out.append({"lo": round(lo, 3), "hi": round(hi, 3),
                    "mid": round(sum(m for m, _ in v) / len(v), 4),
                    "n": len(v), "p": round(sum(w for _, w in v) / len(v), 4)})
    # Monotone by construction: a bigger expected margin cannot mean a smaller win chance, and a
    # thin band must not be allowed to invert the curve.
    for i in range(1, len(out)):
        out[i]["p"] = max(out[i]["p"], out[i - 1]["p"])
    return out


def win_prob_table(margin, table):
    """Interpolate the empirical curve on band midpoints; clamp outside the fitted range."""
    if not table:
        return win_prob(margin)
    if margin <= table[0]["mid"]:
        return table[0]["p"]
    if margin >= table[-1]["mid"]:
        return table[-1]["p"]
    for a, b in zip(table, table[1:]):
        if a["mid"] <= margin <= b["mid"]:
            t = (margin - a["mid"]) / (b["mid"] - a["mid"]) if b["mid"] > a["mid"] else 0
            return a["p"] + t * (b["p"] - a["p"])
    return win_prob(margin)


def fit_hfa(games, seasons):
    diffs = [hg - ag for s, d, h, a, hg, ag in games if s in seasons]
    return st.mean(diffs) if diffs else 0.13


def collect_pairs(games, seasons, hfa):
    """[(expected_margin, home_won)] walking forward, prior games only."""
    pairs = []
    for season in sorted({g[0] for g in games if g[0] in seasons}):
        gs = [g for g in games if g[0] == season]
        for i, (s, d, h, a, hg, ag) in enumerate(gs):
            if i < 60:
                continue
            att, dfn, lg = ratings(games, upto_date=d, season=season)
            if h not in att or a not in att:
                continue
            ph, pa = project(att[h], dfn[h], att[a], dfn[a], lg, hfa)
            pairs.append((ph - pa, 1 if hg > ag else 0))
    return pairs


def backtest(games, train, hold):
    hfa = fit_hfa(games, train)
    print(f"  fitted home ice on train: {hfa:+.3f} goals")
    # Fit the empirical win curve on TRAIN only, then score both it and the normal on HOLDOUT.
    win_tbl = fit_win_table(collect_pairs(games, train, hfa))
    # Walk the held-out seasons game by game, rating only on what came before.
    rows = [g for g in games if g[0] in hold]
    by_season = collections.defaultdict(list)
    for g in rows:
        by_season[g[0]].append(g)
    tot = {"n": 0, "mae_margin": [], "mae_total": [], "base_margin": [], "base_total": [],
           "correct": 0, "brier": [], "brier_tbl": [], "correct_tbl": 0}
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
            won = 1 if hg > ag else 0
            p = win_prob(m)
            tot["correct"] += (p > 0.5) == bool(won)
            tot["brier"].append((p - won) ** 2)
            pt = win_prob_table(m, win_tbl)
            tot["correct_tbl"] += (pt > 0.5) == bool(won)
            tot["brier_tbl"].append((pt - won) ** 2)
    n = tot["n"]
    if not n:
        print("  no held-out games")
        return
    print(f"  held out {n:,} games over {sorted(hold)}")
    print(f"    margin MAE  {st.mean(tot['mae_margin']):.4f}  vs baseline {st.mean(tot['base_margin']):.4f}"
          f"   {(st.mean(tot['base_margin'])-st.mean(tot['mae_margin']))/st.mean(tot['base_margin'])*100:+.2f}%")
    print(f"    total  MAE  {st.mean(tot['mae_total']):.4f}  vs baseline {st.mean(tot['base_total']):.4f}"
          f"   {(st.mean(tot['base_total'])-st.mean(tot['mae_total']))/st.mean(tot['base_total'])*100:+.2f}%")
    base_brier = st.mean([(0.5 - (1 if g[4] > g[5] else 0)) ** 2 for g in rows])
    print(f"    coin-flip baseline Brier {base_brier:.4f}")
    print(f"    NORMAL on the margin SD   winner {tot['correct']/n*100:.1f}%   Brier {st.mean(tot['brier']):.4f}")
    print(f"    EMPIRICAL win curve       winner {tot['correct_tbl']/n*100:.1f}%   Brier {st.mean(tot['brier_tbl']):.4f}"
          f"   {(st.mean(tot['brier'])-st.mean(tot['brier_tbl']))/st.mean(tot['brier'])*100:+.2f}% vs normal")
    print()
    print(f"  fitted curve ({len(win_tbl)} bands):")
    for b in win_tbl:
        print(f"    margin {b['lo']:+.2f}..{b['hi']:+.2f}  mid {b['mid']:+.3f}  n={b['n']:5}"
              f"  P(home) {b['p']:.3f}   normal says {win_prob(b['mid']):.3f}")


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

    # Per-team context for the game cards — the NHL's honest analogue of the NFL card's scoring /
    # weather / referee / injury block. Hockey is indoors and we capture neither NHL referees nor an
    # NHL injury report, so those three rows do not exist and are not faked. What DOES exist and is
    # genuinely NHL-specific: the scoring ranks, days of rest (a back-to-back is the scheduling fact
    # that most often decides who starts in goal), and who has actually been starting.
    last_game = {}
    for s_, d, h, a, hg, ag in games:
        if s_ != CURRENT_SEASON:
            continue
        last_game[h] = max(last_game.get(h, ""), d)
        last_game[a] = max(last_game.get(a, ""), d)

    goalies = collections.defaultdict(list)
    try:
        for team, name, starts, sa, sv in conn.execute(
                "select team, goalie_name, count(*) n, sum(shots_against), sum(saves)"
                "  from nhl_goalie_starts where is_starter = 1 and season = ?"
                "  group by team, goalie_id order by team, n desc", (CURRENT_SEASON,)):
            if len(goalies[team]) < 3 and name:
                goalies[team].append({"name": name, "starts": starts,
                                      "savePct": round(sv / sa, 4) if sa else None})
    except sqlite3.Error:
        pass

    # Ranks are 1 = best: most goals scored, fewest allowed.
    gf_rank = {t: i + 1 for i, t in enumerate(sorted(teams, key=lambda x: -att[x]))}
    ga_rank = {t: i + 1 for i, t in enumerate(sorted(teams, key=lambda x: dfn[x]))}

    # --- Chaos traits, for the Upset Meter's non-predictive driver ------------------------------
    # The same two measurements analysis/chaos_traits.py takes for the NFL, over the same window
    # (the last CHAOS_WINDOW completed seasons plus this one): how VOLATILE a team's game margins
    # are, and how high its single-game CEILING is. A boom-and-bust favourite is more crashable; a
    # high-ceiling underdog has a bigger night in it.
    #
    # 🚨 NOT PREDICTIVE, BY CONSTRUCTION, and it is the smallest weight on the meter that uses it.
    # A PERCENTILE HIDES HOW CLOSE THESE CLUBS ARE, so the size was measured rather than assumed:
    # across 32 teams and three seasons, margin volatility runs 2.39 to 2.85 goals — a 0.46 spread,
    # 18% of the league median. The NFL's is 11.1 to 16.4, 40% of ITS median. So hockey's teams are
    # less than half as differentiated on this measure as football's, and a 90th-percentile NHL
    # favourite is about a third of a goal more volatile than a 10th-percentile one. The driver is
    # published with that stated; it is not stretched until it looks informative.
    chaos_seasons = sorted({g[0] for g in games})[-(CHAOS_WINDOW + 1):]
    margins = collections.defaultdict(list)
    for s_, d, h, a, hg, ag in games:
        if s_ not in chaos_seasons:
            continue
        margins[h].append(hg - ag)
        margins[a].append(ag - hg)
    raw = {t: {"vol": st.pstdev(ms), "ceiling": max(ms)}
           for t, ms in margins.items() if len(ms) >= 10}

    def pct_rank(vals):
        order = sorted(vals)
        n = len(order)
        return {v: (0.0 if n < 2 else round(100.0 * order.index(v) / (n - 1))) for v in set(vals)}

    volp = pct_rank([r["vol"] for r in raw.values()])
    ceilp = pct_rank([r["ceiling"] for r in raw.values()])
    chaos = {t: {"volPct": volp[r["vol"]], "ceilPct": ceilp[r["ceiling"]]} for t, r in raw.items()}
    out = []
    for t in teams:
        out.append({"team": t, "attack": round(att[t], 3), "defence": round(dfn[t], 3),
                    "gfRank": gf_rank[t], "gaRank": ga_rank[t],
                    "lastGame": last_game.get(t), "goalies": goalies.get(t, []),
                    "volPct": chaos.get(t, {}).get("volPct"),
                    "ceilPct": chaos.get(t, {}).get("ceilPct")})
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
        "export interface NhlGoalieForm { name: string; starts: number; savePct: number | null }",
        "export interface NhlTeamRating {",
        "  team: string; attack: number; defence: number;",
        "  gfRank: number; gaRank: number;",
        "  lastGame: string | null;   // this season's most recent game, for days of rest",
        "  goalies: NhlGoalieForm[];  // who has actually been starting (no projected starter exists)",
        "  // Upset Meter chaos driver only — margin volatility and single-game ceiling as league",
        "  // percentiles. Deliberately NON-predictive; null for a club without enough games.",
        "  volPct: number | null;",
        "  ceilPct: number | null;",
        "}",
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
