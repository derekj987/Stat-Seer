#!/usr/bin/env python3
"""Reconcile a prop board against the market: who do the books price that we do not show?

Written because the same bug has now shipped from THREE different gates — a scraped depth chart
(NCAAF), a stale team join (both sports), and prior-season history (NFL) — and each time the board
looked fine, just smaller than it should have been. A screenshot cannot catch this. Diffing can.

The NFL case that prompted it: 136 of 552 priced players (25%) had no row on the 2026 Week 1 board,
including the four shortest anytime-TD prices on the whole slate. Jadarian Price was Seattle's
starting back at -115 to score and simply was not there, because a rookie has no prior-season stats
and the exporter dropped anyone it could not find in them.

Rank the misses by their SHORTEST posted price, never by count. "136 players missing" reads as a
data gap you can defer; "the four shortest prices on the slate are missing" is unmistakably a bug.

    python analysis/board_coverage.py --season 2026 --week 1
    python analysis/board_coverage.py --season 2026 --week 1 --max-missing 40   # CI-style gate
"""
import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request

BOARD = "web/lib/playerProjections.ts"
# A team defence is priced as a "player" by the books and is not one. Not a coverage failure.
# Matched AFTER norm(), which strips the slash — so "dst", never "d/st". (Written as "d/st" first,
# which silently matched nothing and left 20 defences in the results looking like real misses.)
NOT_A_PLAYER = ("dst", "defense", "no touchdown", "test player")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z ]", "", s.lower())
    return re.sub(r"\s+", " ", s).replace(" jr", "").replace(" sr", "").strip()


def load_env(path=".env"):
    env = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.split("#", 1)[0].strip().strip("\"'")
    env.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    return env


def page(url, key, table, params):
    """Every PostgREST read pages until a SHORT page comes back. `limit=` does not raise the cap."""
    out, start = [], 0
    while True:
        q = urllib.parse.urlencode(params, safe="*.,()")
        req = urllib.request.Request(
            f"{url.rstrip('/')}/rest/v1/{table}?{q}",
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Range": f"{start}-{start + 999}", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            rows = json.loads(r.read().decode())
        out += rows
        if len(rows) < 1000:
            return out
        start += 1000


def board_players(path=BOARD):
    src = open(path, encoding="utf-8").read()
    names = re.findall(r'"player": "([^"]+)"', src)
    # A parser that matches nothing reports a clean zero, which is a false pass, not a pass.
    if len(names) < 50:
        sys.exit(f"ERROR: parsed only {len(names)} players from {path} — the shape changed?")
    return {norm(n) for n in names}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--week", type=int, required=True)
    ap.add_argument("--board", default=BOARD)
    ap.add_argument("--max-missing", type=int, default=None,
                    help="exit non-zero if more than this many priced players have no row")
    a = ap.parse_args()

    env = load_env()
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")

    rows = page(url, key, "prop_snapshots",
                {"select": "player_name,market,price_american,home_team,away_team",
                 "season": f"eq.{a.season}", "week": f"eq.{a.week}"})
    if not rows:
        sys.exit(f"no prop rows for {a.season} week {a.week}")

    shown = board_players(a.board)
    priced, best = {}, {}
    for r in rows:
        n = r.get("player_name")
        if not n:
            continue
        k = norm(n)
        if any(w in k for w in NOT_A_PLAYER):
            continue
        priced[k] = n
        if r["market"] == "player_anytime_td" and r.get("price_american") is not None:
            g = f'{r["away_team"]} @ {r["home_team"]}'
            if k not in best or r["price_american"] < best[k][0]:
                best[k] = (r["price_american"], n, g)

    missing = sorted(k for k in priced if k not in shown)
    pct = 100.0 * len(missing) / len(priced) if priced else 0.0
    print(f"{a.season} week {a.week}: {len(priced)} priced players, {len(shown)} on the board")
    print(f"PRICED BUT MISSING: {len(missing)} ({pct:.0f}%)")
    if missing:
        # The market's own ranking of how much each omission matters.
        ranked = sorted((best[k] for k in missing if k in best))
        print("\nshortest anytime-TD price among the missing (the ones that matter):")
        for price, name, game in ranked[:15]:
            print(f"  {name:28} {price:+6}  {game}")
        rest = [priced[k] for k in missing if k not in best]
        if rest:
            print(f"\n  ...and {len(rest)} with no TD price posted: {', '.join(sorted(rest)[:8])}")

    if a.max_missing is not None and len(missing) > a.max_missing:
        sys.exit(f"\nFAIL: {len(missing)} priced players missing > --max-missing {a.max_missing}")


if __name__ == "__main__":
    main()
