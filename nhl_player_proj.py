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
# 🚨 THE SAME MINIMUMS GOVERN BOTH PATHS, OR LOCAL AND CI DISAGREE. The frozen static file only
# carries a baseline for players with this much prior-season history, so a run reading the DB
# directly must apply the identical cut — otherwise a player with four prior games gets a real
# baseline locally and the league rate on the runner, and the committed board changes depending on
# WHERE it was generated. Measured before this was fixed: 34 of 676 projections differed, one by a
# full shot (2.23 vs 1.13).
MIN_PRIOR_SKATER = 10
MIN_PRIOR_GOALIE = 5
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
    # 🚨 WHY A STATIC FILE EXISTS AT ALL. Only the CURRENT season changes day to day. The
    # prior-season per-player baselines and the P(over) table are fixed for the whole year, and
    # they are computed from five seasons / 227,871 games — roughly 6,600 boxscores, over an hour
    # of fetching. A daily job cannot pay that, and a CI runner has no data/nhl.db to read it from.
    # So they are frozen once (locally, where the full history lives) and committed, and the
    # scheduled refresh reads them instead of recomputing them.
    ap.add_argument("--write-static", metavar="PATH",
                    help="freeze the prior-season baselines + P(over) table (run locally, full history)")
    ap.add_argument("--static", metavar="PATH",
                    help="read those frozen inputs instead of computing them (what CI does)")
    args = ap.parse_args(argv)

    conn = sqlite3.connect(DB)
    static = None
    if args.static:
        with open(args.static, encoding="utf-8") as fh:
            static = json.load(fh)
        print(f"static inputs: {sum(len(v) for v in static['skaterPrior'].values())} skater / "
              f"{len(static['goaliePrior'])} goalie baselines across "
              f"{len(static['overTables'])} markets")

    # ---- skaters: one projection per market the book actually posts ----
    #
    # 🚨 EVERY ONE OF THESE IS PUBLISHED AS A PROBABILITY, which is what makes four different
    # markets comparable to four different prices. The lines below are the ones the feed posts:
    # shots 1.5/2.5/3.5, assists and points at 0.5 (and points also 1.5), and GOALS as the
    # anytime-scorer market, which is already a probability and so needs no line at all — P(>0.5)
    # IS "does he score". That market being a probability on both sides is exactly why the football
    # boards publish anytime TD as a percentage, and it is the shape the other three are converted
    # into rather than the exception.
    #
    # Goals are the one market the project's own rule says NOT to project directly: a goal is a
    # shot times a shooting percentage, shots persist at r = 0.949 and shooting% at only 0.563
    # (§15a). But the P(over) table is built on the HISTORICAL DISTRIBUTION of goals at a given
    # goal rate, not on a parametric model of them, so the decomposition is already baked into the
    # empirical frequencies — a player projected at 0.35 goals a game scored at the rate players
    # projected at 0.35 actually scored. Projecting the rate and reading the frequency off real
    # outcomes is the same discipline by another route.
    SKATER_MARKETS = {
        "shots":   {"col": "sog",     "lines": [1.5, 2.5, 3.5], "dp": 2,
                    "bands": [(0, 1.25), (1.25, 1.75), (1.75, 2.25), (2.25, 2.75),
                              (2.75, 3.25), (3.25, 3.75), (3.75, 99)]},
        "goals":   {"col": "goals",   "lines": [0.5], "dp": 3,
                    "bands": [(0, 0.08), (0.08, 0.14), (0.14, 0.20), (0.20, 0.28),
                              (0.28, 0.38), (0.38, 0.50), (0.50, 9)]},
        "assists": {"col": "assists", "lines": [0.5, 1.5], "dp": 3,
                    "bands": [(0, 0.15), (0.15, 0.25), (0.25, 0.35), (0.35, 0.50),
                              (0.50, 0.70), (0.70, 0.95), (0.95, 9)]},
        "points":  {"col": "points",  "lines": [0.5, 1.5], "dp": 3,
                    "bands": [(0, 0.25), (0.25, 0.40), (0.40, 0.55), (0.55, 0.75),
                              (0.75, 1.00), (1.00, 1.30), (1.30, 9)]},
    }

    names, teams = {}, {}
    cur_by, prior_by = {}, {}
    for mk, spec in SKATER_MARKETS.items():
        cur_by[mk] = collections.defaultdict(list)
        prior_by[mk] = collections.defaultdict(list)
        for season, pid, nm, team, v in conn.execute(
                f"select season, player_id, player_name, team, {spec['col']} from nhl_skater_games"
                f" where {spec['col']} is not null and toi_seconds > 0 order by game_date, game_id"):
            if season == CURRENT_SEASON:
                cur_by[mk][pid].append(v)
                names[pid] = nm
                teams[pid] = team
            elif season == PRIOR_SEASON:
                prior_by[mk][pid].append(v)
                names.setdefault(pid, nm)

    skaters = []
    league_rate = {}
    for mk, spec in SKATER_MARKETS.items():
        cur, prior = cur_by[mk], prior_by[mk]
        league_rate[mk] = st.mean([v for vs in cur.values() for v in vs]) if cur else 0.0
        for pid, vals in cur.items():
            if len(vals) < MIN_GAMES:
                continue
            # Rounded to the precision the static file stores, or the two paths differ in the third
            # decimal and the published projection moves depending on where it was built.
            prior_vals = prior.get(pid, [])
            pr = (round(st.mean(prior_vals), 3) if len(prior_vals) >= MIN_PRIOR_SKATER
                  else (static["skaterPrior"].get(mk, {}).get(str(pid)) if static else None))
            proj, n = blend(vals, pr, league_rate[mk])
            skaters.append({"id": pid, "player": names.get(pid), "team": teams.get(pid),
                            "market": mk, "proj": round(proj, spec["dp"]), "games": n,
                            "seasonMean": round(st.mean(vals), spec["dp"]),
                            "priorMean": round(pr, spec["dp"]) if pr is not None else None})

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
        pr = (round(st.mean(g_prior_sa[gid]), 2) if len(g_prior_sa.get(gid, [])) >= MIN_PRIOR_GOALIE
              else (static["goaliePrior"].get(str(gid)) if static else None))
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
    # 🚨 GOALIE SAVES NEEDS ITS OWN TABLE, AND NOT HAVING ONE WAS A SILENT HOLE. The Goalie saves
    # tab published a projection and an em-dash in the column the whole page is built around,
    # because `pOver` returns null for a market the table was never built for and saves was never
    # in it. A blank is honest about one row; a blank on every row of a tab is a tab that does not
    # work.
    #
    # It is built from `nhl_goalie_starts` rather than `nhl_skater_games` and keyed on STARTS, so
    # the bands below are saves per start rather than per game. Two differences from the skater
    # markets, both forced by the data:
    #
    #   * The lines are a LADDER, not three fixed numbers. Books post saves anywhere from the low
    #     twenties to the mid thirties, so the table carries every half-integer across the range
    #     the data actually covers; a line outside it still returns null, which is correct.
    #   * The bands are narrower, because 12,299 starts spread over a 16-save range would make a
    #     seven-band table where neighbouring bands are three saves apart.
    #
    # THE LADDER IS CUT WHERE THE TABLE STOPS BEING MONOTONE, which is the test the skater tables
    # are already held to and the reason it is not simply 15.5 to 40.5. Measured across the seven
    # bands: every line from 17.5 to 38.5 rises with the band mean, while 15.5 and 16.5 invert at
    # the top (0.963 then 0.958) and 39.5 and up invert in the middle — both ends are places where
    # the probability is near 0 or 1 and the ordering is sampling noise. A table that goes the
    # wrong way at the edges is worse than one that returns nothing there.
    GOALIE_SPEC = {
        "col": "saves", "dp": 1,
        "lines": [x / 2 for x in range(35, 78, 2)],          # 17.5 .. 38.5, the monotone range
        "bands": [(0, 23.0), (23.0, 24.5), (24.5, 25.5), (25.5, 26.5),
                  (26.5, 27.5), (27.5, 29.0), (29.0, 99)],
    }

    def build_over_tables():
        """{market: [band, ...]} — P(stat > line) by the player's own per-game rate, counted off
        real outcomes rather than assumed from a distribution."""
        out = {}
        for mk, spec in SKATER_MARKETS.items():
            hist = collections.defaultdict(list)
            for season, pid, v in conn.execute(
                    f"select season, player_id, {spec['col']} from nhl_skater_games"
                    f" where {spec['col']} is not null and toi_seconds > 0"):
                hist[(season, pid)].append(v)
            hist = {k: v for k, v in hist.items() if len(v) >= 20}
            tbl = []
            for lo, hi in spec["bands"]:
                members = [v for k, v in hist.items() if lo <= st.mean(v) < hi]
                g = [x for v in members for x in v]
                if len(g) < 500:
                    continue
                tbl.append({"mean": round(st.mean([st.mean(v) for v in members]), 4), "n": len(g),
                            "p": {str(L): round(sum(1 for x in g if x > L) / len(g), 4)
                                  for L in spec["lines"]}})
            out[mk] = tbl

        # Goalies, same recipe against the starts table. The history cut is 15 starts rather than
        # the skaters' 20 games: a goalie-season IS about sixty starts at most, so 20 would throw
        # away a third of the backups, who are exactly the band a reader needs when a back-to-back
        # puts one in net.
        ghist = collections.defaultdict(list)
        for season, gid, v in conn.execute(
                "select season, goalie_id, saves from nhl_goalie_starts"
                " where is_starter = 1 and saves is not null and shots_against > 0"):
            ghist[(season, gid)].append(v)
        ghist = {k: v for k, v in ghist.items() if len(v) >= 15}
        gtbl = []
        for lo, hi in GOALIE_SPEC["bands"]:
            members = [v for v in ghist.values() if lo <= st.mean(v) < hi]
            g = [x for v in members for x in v]
            if len(g) < 500:
                continue
            gtbl.append({"mean": round(st.mean([st.mean(v) for v in members]), 4), "n": len(g),
                         "p": {str(L): round(sum(1 for x in g if x > L) / len(g), 4)
                               for L in GOALIE_SPEC["lines"]}})
        out["saves"] = gtbl
        return out

    over_tables = static["overTables"] if static else build_over_tables()

    # Freeze the year-constant inputs so a daily job never has to rebuild five seasons.
    if args.write_static:
        prior_sk = {mk: {str(pid): round(st.mean(v), 3)
                         for pid, v in prior_by[mk].items() if len(v) >= MIN_PRIOR_SKATER}
                    for mk in SKATER_MARKETS}
        prior_gl = {str(gid): round(st.mean(v), 2) for gid, v in g_prior_sa.items() if len(v) >= MIN_PRIOR_GOALIE}
        with open(args.write_static, "w", encoding="utf-8", newline="\n") as fh:
            json.dump({"_note": "Frozen by nhl_player_proj.py --write-static from the full local "
                                "history. Prior-season baselines and the P(over) table are constant "
                                "for a season; the scheduled refresh reads this instead of "
                                "rebuilding ~6,600 boxscores. Regenerate once per season.",
                       "priorSeason": PRIOR_SEASON, "overTables": over_tables,
                       "skaterPrior": prior_sk, "goaliePrior": prior_gl}, fh, indent=0)
        print(f"wrote {args.write_static} "
              f"({sum(len(v) for v in prior_sk.values())} skater / {len(prior_gl)} goalie baselines)")
    conn.close()

    # Market first, then our projection descending — the generated file is read by a page that
    # tabs by market, so grouping it here saves the page a sort and makes the diff legible.
    order = {mk: i for i, mk in enumerate(SKATER_MARKETS)}
    rows = (sorted(skaters, key=lambda r: (order.get(r["market"], 99), -r["proj"]))
            + sorted(goalies, key=lambda r: -r["proj"]))
    by_mkt = collections.Counter(r["market"] for r in rows)
    print(f"{len(skaters)} skater rows across {len(SKATER_MARKETS)} markets "
          f"({dict(by_mkt)}), {len(goalies)} goalies")
    print(f"  league rates: " + ", ".join(f"{k} {v:.3f}" for k, v in league_rate.items())
          + f"; shots against {league_sa:.1f}, save% {league_pct:.4f}")
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
        "  // `market` is a plain string, NOT a union of the five keys. With ~2,500 elements TS",
        "  // checks the union per element and gives up: 'Expression produces a union type that is",
        "  // too complex to represent'. The union lives on NhlMarket in lib/nhlProjMatch.ts, which",
        "  // is where callers touch it, so nothing is lost but the compile.",
        "  market: string; proj: number; games: number;",
        "  seasonMean: number; priorMean: number | null; shotsAgainst: number | null;",
        "}",
        "",
        f"export const NHL_LEAGUE_SAVE_PCT = {league_pct:.4f};",
        "",
        "/** Empirical P(stat > line) by the player's projected per-game rate, counted off real",
        " *  outcomes. One table per market. Published as a probability because a small count",
        " *  against a half-point line cannot be compared to a mean, and its median snaps to an",
        " *  integer (EMPIRICAL_REFERENCE §15d). */",
        "export interface NhlOverBand { mean: number; n: number; p: Record<string, number> }",
        "export const NHL_OVER_TABLES: Record<string, NhlOverBand[]> = {",
    ]
    for mk, tbl in over_tables.items():
        head.append(f"  {json.dumps(mk)}: [")
        head += [f"    {json.dumps(b)}," for b in tbl]
        head.append("  ],")
    head += [
        "};",
        "",
    ]
    # 🚨 EVERY ROW GETS THE SAME KEYS IN THE SAME ORDER. Skater rows had no `shotsAgainst` and
    # goalie rows did, so TypeScript inferred a different object type per element and gave up on
    # ~2,500 of them: "Expression produces a union type that is too complex to represent". One
    # uniform shape is one inferred type. Annotating the array did not help — TS still computes the
    # literal's own type to check assignability.
    KEYS = ("id", "player", "team", "market", "proj", "games",
            "seasonMean", "priorMean", "shotsAgainst")
    # 🚨 ONE ARRAY PER MARKET, THEN CONCATENATED — NOT ONE ARRAY OF ~2,500.
    #
    # TypeScript gives up on a single literal that large: "Expression produces a union type that is
    # too complex to represent" (TS2590). It is the COUNT, not the shape — the 676-row version of
    # this file compiled fine, and neither making every row the same shape nor widening `market`
    # from a union to a string fixed the 2,560-row one. Five arrays of ~630 each are each well
    # inside the limit, and the spread below is a runtime concat of already-typed arrays, so
    # nothing has to be re-inferred.
    #
    # Adding a sixth market? Give it its own const here rather than growing one of these.
    body: list[str] = []
    for mk in list(SKATER_MARKETS) + ["saves"]:
        part = [r for r in rows if r["market"] == mk]
        if not part:
            continue
        body.append(f"const P_{mk.upper()}: NhlProj[] = [")
        body += [f"  {json.dumps({k: r.get(k) for k in KEYS}, ensure_ascii=False)}," for r in part]
        body += ["];", ""]
    present = [mk for mk in list(SKATER_MARKETS) + ["saves"] if any(r["market"] == mk for r in rows)]
    body.append("export const NHL_PROJ: NhlProj[] = ["
                + ", ".join(f"...P_{mk.upper()}" for mk in present) + "];")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(head + body + [""]))
    print(f"wrote {args.out} ({len(rows)} rows across {len(present)} arrays)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
