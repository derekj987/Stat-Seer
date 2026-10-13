"""
nhl_player_proj.py -- line-blind NHL shots and saves projections for /nhl/props.

    python nhl_player_proj.py --dry-run
    python nhl_player_proj.py                 # writes web/lib/nhlPlayerProjections.ts

🚨 THE PROJECTION IS DELIBERATELY SIMPLE, AND THAT IS THE FINDING, NOT LAZINESS. §15 measured
skater shots on goal at r = 0.949 across 239,197 games -- more persistent than any NFL volume
metric this project has -- and then showed that an exponentially-weighted model beats the player's
own season-to-date mean by 0.20% out of sample, with the fitter choosing a 35-game half-life, which
is flat weighting by another name. At that persistence there is no recency structure left to
exploit, so the mean IS the projection and anything more elaborate is decoration that would have to
be maintained.

SAVES ARE THE EXCEPTION AND GET THE DECOMPOSITION. Goalie save% persists at only r = 0.307, so a
goalie's own save percentage is not worth conditioning on -- measured, the optimal shrink toward the
league mean is INFINITE. Saves are therefore projected as

    projected shots against  x  LEAGUE save%

which beat projecting saves directly by 1.58% and the season mean by 0.59% held out. This is the
project's oldest rule (project volume, multiply by a regressed efficiency baseline) landing exactly
where the persistence numbers said it would.

EARLY SEASON: a player with four games has a mean that is mostly noise, so each projection is
shrunk toward his PRIOR-SEASON rate by PRIOR_K games, and toward the league rate when there is no
prior season either. The shrink is what makes an October board usable at all.

🚨 THIS IS NOT AN EDGE CLAIM AND THE PAGE MUST NOT MAKE ONE. Everything above is accuracy against
the ACTUAL result. Nothing here has been tested against the closing line, because NHL shots props
have only been captured since 2026-10-09 and saves since 2026-10-13. The project has already
measured that its NFL and NCAAF prop projections do NOT beat the close. Publish this line-blind,
graded in public, and let the record decide.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sqlite3
import statistics as st
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(ROOT, "data", "nhl.db")
OUT = os.path.join(ROOT, "web", "lib", "nhlPlayerProjections.ts")

CURRENT_SEASON = 20262027
PRIOR_SEASON = 20252026
PRIOR_K = 8            # games of prior-season rate blended in before a player's own season carries
MIN_GAMES = 2          # fewer than this and we publish nothing rather than a guess


def blend(cur_vals, prior_rate, league_rate):
    """Season-to-date mean, shrunk toward the prior-season rate (or league if there is none)."""
    n = len(cur_vals)
    base = prior_rate if prior_rate is not None else league_rate
    if n == 0:
        return (base, 0)
    return ((sum(cur_vals) + base * PRIOR_K) / (n + PRIOR_K), n)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args(argv)

    conn = sqlite3.connect(DB)

    # ---- skaters: shots on goal ----
    cur = collections.defaultdict(list)
    prior = collections.defaultdict(list)
    names, teams = {}, {}
    for season, pid, nm, team, sog in conn.execute(
            "select season, player_id, player_name, team, sog from nhl_skater_games"
            " where sog is not null and toi_seconds > 0 order by game_date, game_id"):
        if season == CURRENT_SEASON:
            cur[pid].append(sog)
            names[pid] = nm
            teams[pid] = team
        elif season == PRIOR_SEASON:
            prior[pid].append(sog)
            names.setdefault(pid, nm)
    league_sog = st.mean([v for vs in cur.values() for v in vs]) if cur else 1.72
    skaters = []
    for pid, vals in cur.items():
        if len(vals) < MIN_GAMES:
            continue
        pr = st.mean(prior[pid]) if prior.get(pid) else None
        proj, n = blend(vals, pr, league_sog)
        skaters.append({"id": pid, "player": names.get(pid), "team": teams.get(pid),
                        "market": "shots", "proj": round(proj, 2), "games": n,
                        "seasonMean": round(st.mean(vals), 2),
                        "priorMean": round(pr, 2) if pr is not None else None})

    # ---- goalies: saves = projected shots against x LEAGUE save% ----
    g_cur_sa, g_cur_sv, g_prior_sa = (collections.defaultdict(list) for _ in range(3))
    g_names, g_teams = {}, {}
    lg_sv_num = lg_sv_den = 0
    for season, gid, nm, team, sa, sv in conn.execute(
            "select season, goalie_id, goalie_name, team, shots_against, saves"
            "  from nhl_goalie_starts where is_starter = 1 and shots_against > 0"
            "  order by game_date, game_id"):
        if season == CURRENT_SEASON:
            g_cur_sa[gid].append(sa)
            g_cur_sv[gid].append(sv or 0)
            g_names[gid] = nm
            g_teams[gid] = team
            lg_sv_num += sv or 0
            lg_sv_den += sa
        elif season == PRIOR_SEASON:
            g_prior_sa[gid].append(sa)
            g_names.setdefault(gid, nm)
    league_sa = st.mean([v for vs in g_cur_sa.values() for v in vs]) if g_cur_sa else 29.9
    league_pct = (lg_sv_num / lg_sv_den) if lg_sv_den else 0.897
    goalies = []
    for gid, vals in g_cur_sa.items():
        if len(vals) < MIN_GAMES:
            continue
        pr = st.mean(g_prior_sa[gid]) if g_prior_sa.get(gid) else None
        shots, n = blend(vals, pr, league_sa)
        goalies.append({"id": gid, "player": g_names.get(gid), "team": g_teams.get(gid),
                        "market": "saves", "proj": round(shots * league_pct, 1), "games": n,
                        "shotsAgainst": round(shots, 1),
                        "seasonMean": round(st.mean(g_cur_sv[gid]), 1),
                        "priorMean": round(pr * league_pct, 1) if pr is not None else None})
    # ---- P(over the posted line), empirical, from every historical skater game ----
    # 🚨 THE PANEL PUBLISHES A PROBABILITY, NOT A MEAN BESIDE A HALF-POINT LINE. Shots on goal is a
    # small count and the book posts 1.5 / 2.5 / 3.5, so "our mean vs their line" is not a
    # like-for-like comparison: a mean of 4.46 against a 3.5 line says nothing on its own, and
    # measured across the live board it made 58% of players read as overs. Converting the mean to a
    # median is not the fix either — the median of a small count snaps to an integer, so median/mean
    # sawtooths (1.255, 0.810, 1.156, 0.900 by band) rather than forming a curve. That is §13k's
    # lesson, re-confirmed here on 227,871 games instead of 216 rows.
    #
    # What IS comparable to the book's number is the probability of going over, so that is what gets
    # published. Non-parametric: bucket player-seasons by their per-game mean and count how often a
    # game cleared each line. Every cell holds thousands of games and the table is monotone in the
    # mean for all three lines.
    hist = collections.defaultdict(list)
    for season, pid, sog in conn.execute(
            "select season, player_id, sog from nhl_skater_games"
            " where sog is not null and toi_seconds > 0"):
        hist[(season, pid)].append(sog)
    hist = {k: v for k, v in hist.items() if len(v) >= 20}
    BANDS = [(0, 1.25), (1.25, 1.75), (1.75, 2.25), (2.25, 2.75), (2.75, 3.25), (3.25, 3.75), (3.75, 99)]
    LINES = [1.5, 2.5, 3.5]
    over_table = []
    for lo, hi in BANDS:
        g = [x for k, v in hist.items() if lo <= st.mean(v) < hi for x in v]
        if len(g) < 500:
            continue
        mid = st.mean([st.mean(v) for k, v in hist.items() if lo <= st.mean(v) < hi])
        over_table.append({"mean": round(mid, 3), "n": len(g),
                           "p": {str(L): round(sum(1 for x in g if x > L) / len(g), 4) for L in LINES}})
    conn.close()

    rows = sorted(skaters, key=lambda r: -r["proj"]) + sorted(goalies, key=lambda r: -r["proj"])
    print(f"{len(skaters)} skaters, {len(goalies)} goalies "
          f"(league {league_sog:.2f} shots, {league_sa:.1f} shots against, save% {league_pct:.4f})")
    if args.dry_run:
        for r in rows[:5]:
            print("   ", r)
        print("DRY RUN — nothing written.")
        return 0

    head = [
        "// AUTO-GENERATED by nhl_player_proj.py — do not edit by hand.",
        "// Line-blind NHL projections for /nhl/props: shots on goal per skater, saves per goalie.",
        "//",
        "// Shots is the player's own season-to-date mean shrunk toward his prior-season rate. That",
        "// is not a simplification for its own sake — shots on goal persist at r = 0.949, and a",
        "// fitted recency model beat the plain mean by 0.20% out of sample (EMPIRICAL_REFERENCE",
        "// §15b), so the mean is the projection.",
        "//",
        "// Saves is projected shots against x the LEAGUE save percentage, NOT the goalie's own:",
        "// save% persists at r = 0.307 and the measured optimal shrink toward league is infinite",
        "// (§15c). Logic lives in nhl_player_proj.py; helpers belong in their own module, never",
        "// in this file, which is rewritten on every refresh.",
        f"// {len(skaters)} skaters, {len(goalies)} goalies. League save% {league_pct:.4f}.",
        "",
        "export interface NhlProj {",
        "  id: number; player: string | null; team: string | null;",
        '  market: "shots" | "saves"; proj: number; games: number;',
        "  seasonMean: number; priorMean: number | null; shotsAgainst?: number;",
        "}",
        "",
        f"export const NHL_LEAGUE_SAVE_PCT = {league_pct:.4f};",
        "",
        "/** Empirical P(shots > line) by the player's projected per-game mean, from "
        f"{sum(b['n'] for b in over_table):,} historical skater games.",
        " *  Published as a probability because a small count against a half-point line cannot be",
        " *  compared to a mean, and its median snaps to an integer (EMPIRICAL_REFERENCE §15d). */",
        "export interface NhlOverBand { mean: number; n: number; p: Record<string, number> }",
        "export const NHL_OVER_TABLE: NhlOverBand[] = [",
        *[f"  {json.dumps(b)}," for b in over_table],
        "];",
        "",
        "export const NHL_PROJ: NhlProj[] = [",
    ]
    body = [f"  {json.dumps(r, ensure_ascii=False)}," for r in rows]
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(head + body + ["];", ""]))
    print(f"wrote {args.out} ({len(rows)} rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
