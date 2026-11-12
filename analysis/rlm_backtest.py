#!/usr/bin/env python3
"""rlm_backtest.py -- does the way a line MOVES predict the result against the close?

🚨 READ THIS BEFORE QUOTING ANY NUMBER THIS PRINTS: WE CANNOT MEASURE TRUE REVERSE LINE
MOVEMENT, AND THIS DOES NOT CLAIM TO.

Reverse line movement is defined as the line moving AGAINST the side taking the majority of
the BETS. That requires public ticket percentages. The Odds API sells prices, not tickets, and
nothing in our schema carries a ticket or handle split -- checked, there is no such column.
So the literal thing cannot be computed from the data we own, and a script that printed an
"RLM record" off these tables would be inventing the half it cannot see.

What IS computable, in two honest layers:

  LAYER 1 -- does movement predict at all?  Take each game's earliest pregame price and its
    last pregame price, and back the side the line moved TOWARD, graded against the CLOSING
    spread. This is the prerequisite: if the direction of movement carries no information,
    no refinement of it can either. Needs no ticket data.

  LAYER 2 -- RLM BY PROXY, labelled as a proxy.  Public money leans to FAVOURITES and OVERS;
    that is about as close to a settled fact as this field has. So "the line moved toward the
    UNDERDOG" stands in for "the line moved against the public side". It is a proxy, it is
    not the definition, and the output says so every time it prints.

The bar is the project's standing one: beat 52.4% (the -110 break-even) OUT OF SAMPLE, chosen
on train seasons and confirmed on held-out ones. Not "better than 50%".

🚨 AND THE SAMPLE IS TOO SMALL TO SETTLE IT -- stated up front rather than buried under a
percentage. Telling 52.4% from 50.0% at 80% power needs roughly 2,700 bets. NFL 2024+2025
gives ~548 games with a usable open/close pair. So this run can rule out a LARGE edge and
cannot confirm a small one, and the printed confidence interval is the honest summary. A
headline win rate on 548 games is a number with a +/- 4pt interval around it; treat it that
way, and watch what it does as seasons accumulate.

    python analysis/rlm_backtest.py                      # NFL 2024 train, 2025 confirm
    python analysis/rlm_backtest.py --seasons 2024 2025 2026
"""
import argparse
import collections
import csv
import json
import math
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import odds_client as oc   # noqa: E402

VIG = 0.524           # -110 break-even
BOOK = "fanduel"      # LINE_BOOK: the number a member actually sees


def sb(env, table, query, cap=200000):
    """Paged PostgREST read, retrying 5xx. Same shape the live readers use."""
    url = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + table
    key = env["SUPABASE_SERVICE_KEY"]
    out, PAGE, off = [], 1000, 0
    while off <= cap:
        req = urllib.request.Request(url + query, headers={
            "apikey": key, "Authorization": f"Bearer {key}",
            "Range": f"{off}-{off + PAGE - 1}", "Range-Unit": "items"})
        page = None
        for attempt in range(4):
            try:
                page = json.loads(urllib.request.urlopen(req, timeout=90).read())
                break
            except (urllib.error.HTTPError, urllib.error.URLError) as e:
                code = getattr(e, "code", None)
                if (code is not None and code < 500) or attempt == 3:
                    raise
                import time
                time.sleep(2 * (attempt + 1))
        out += page
        if len(page) < PAGE:
            break
        off += PAGE
    return out


def actuals(seasons):
    """(season, away, home) -> home margin, from nflverse games.csv."""
    out = {}
    with open(os.path.join(ROOT, "data", "games.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get("game_type") != "REG" or not r.get("home_score"):
                continue
            try:
                s = int(r["season"])
            except (TypeError, ValueError):
                continue
            if s not in seasons:
                continue
            try:
                out[(s, r["away_team"], r["home_team"])] = int(r["home_score"]) - int(r["away_score"])
            except ValueError:
                continue
    return out


def open_close(env, season):
    """event -> (open_home_spread, close_home_spread, home, away). Pregame only.

    The OPEN is the earliest price we hold, not the true market open -- the backfill captured a
    sweep per kickoff instant, so a game first appears in whatever sweep preceded it. Say
    "earliest held" rather than "open"; it understates total movement and that is the safe
    direction for a test looking FOR movement.
    """
    # 🚨 ONE WEEK AT A TIME. A whole season of a LIVE table is too much for one paged read: the
    # 2026 season (sweeps every ~30 min since September) returns 500 when asked for in one go,
    # while the backfilled seasons fit easily. Chunking by week keeps every request inside the
    # (season, week, snapshot_at desc) index and bounds the offset depth, and it costs nothing on
    # the small seasons. Found by running this on 2026 and watching it die where 2024/2025 passed.
    rows = []
    for wk in range(1, 23):          # 18 regular weeks, plus slack for playoff numbering
        rows += sb(env, "odds_snapshots",
                   f"?season=eq.{season}&week=eq.{wk}&book=eq.{BOOK}&market=eq.spreads"
                   f"&select=event_id,snapshot_at,commence_time,home_team,away_team,"
                   f"outcome_name,outcome_point")
    by = collections.defaultdict(list)
    for r in rows:
        if r["outcome_point"] is None or r["snapshot_at"] >= r["commence_time"]:
            continue                                  # no point, or a live line
        if r["outcome_name"] != r["home_team"]:
            continue                                  # home side only: one row per snapshot
        by[r["event_id"]].append(r)
    out = {}
    for eid, rs in by.items():
        rs.sort(key=lambda x: x["snapshot_at"])
        if len(rs) < 2:
            continue
        out[eid] = (float(rs[0]["outcome_point"]), float(rs[-1]["outcome_point"]),
                    rs[0]["home_team"], rs[0]["away_team"])
    return out


def wilson(k, n):
    """95% Wilson interval — honest about a small sample in a way k/n alone is not."""
    if not n:
        return (0.0, 0.0)
    p, z = k / n, 1.96
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def grade(games, label, only=None):
    """Back the side the line moved toward; grade ATS at the CLOSING spread."""
    w = l = push = 0
    for (mv, close, margin) in games:
        if abs(mv) < 0.5:
            continue                                   # no meaningful move
        if only == "dog" and not toward_dog(mv, close):
            continue
        if only == "fav" and toward_dog(mv, close):
            continue
        # mv < 0 => home spread fell => line moved TOWARD HOME.
        side_home = mv < 0
        edge = margin + close                          # home covers when > 0
        if abs(edge) < 1e-9:
            push += 1
            continue
        home_covered = edge > 0
        if home_covered == side_home:
            w += 1
        else:
            l += 1
    n = w + l
    if not n:
        print(f"  {label:<34} no qualifying games")
        return
    p = w / n
    lo, hi = wilson(w, n)
    verdict = "beats" if lo > VIG else ("cannot rule out" if hi > VIG else "BELOW")
    print(f"  {label:<34} {w}-{l}{'' if not push else f'-{push}'}  {p*100:5.1f}%  "
          f"95% CI [{lo*100:4.1f}, {hi*100:4.1f}]  vs vig {(p-VIG)*100:+5.1f}  -> {verdict}")


def toward_dog(mv, close_home_spread):
    """Did the line move toward the UNDERDOG? (the RLM proxy — public leans to favourites)"""
    home_is_fav = close_home_spread < 0
    moved_to_home = mv < 0
    return moved_to_home != home_is_fav


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seasons", type=int, nargs="+", default=[2024, 2025])
    ap.add_argument("--confirm-from", type=int, default=None,
                    help="seasons >= this are HELD OUT (default: the last one given)")
    args = ap.parse_args(argv)

    env = oc.load_env()
    seasons = sorted(set(args.seasons))
    cut = args.confirm_from or seasons[-1]
    act = actuals(set(seasons))

    per_season = {}
    for s in seasons:
        oc_map = open_close(env, s)
        got = []
        for eid, (o, c, home, away) in oc_map.items():
            m = act.get((s, away, home))
            if m is None:
                continue
            got.append((c - o, c, float(m)))
        per_season[s] = got
        moved = sum(1 for g in got if abs(g[0]) >= 0.5)
        print(f"  {s}: {len(oc_map)} games with open+close, {len(got)} joined to a result, "
              f"{moved} moved >= 0.5 pt")

    train = [g for s in seasons if s < cut for g in per_season[s]]
    test = [g for s in seasons if s >= cut for g in per_season[s]]
    print(f"\n  CHOOSE  seasons < {cut}: {len(train)} games")
    print(f"  CONFIRM seasons >= {cut}: {len(test)} games")

    print("\n=== LAYER 1: back the side the line moved toward (needs no ticket data) ===")
    grade(train, "train")
    grade(test, "HELD OUT")

    print("\n=== LAYER 2: RLM BY PROXY — moves toward the UNDERDOG only ===")
    print("  (proxy for 'against the public side'. We do NOT have ticket percentages.)")
    grade(train, "train, moved to dog", only="dog")
    grade(test, "HELD OUT, moved to dog", only="dog")
    print("  control — moves toward the FAVOURITE (the non-RLM half):")
    grade(train, "train, moved to fav", only="fav")
    grade(test, "HELD OUT, moved to fav", only="fav")

    print(f"\n  Bar is {VIG*100:.1f}% (-110 break-even), not 50%. A 95% interval that straddles")
    print("  it means the sample cannot answer the question — see the power note in the header.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
