"""
Grade the published Parlay of the Week tickets.

    python grade_parlays.py            # dry run — prints what it would grade
    python grade_parlays.py --write    # append grades (permanent)

The card tells the reader "Every ticket is published before kickoff and graded at /report".
parlay_ledger makes the first half true; this makes the second half true.

WHAT A PARLAY SETTLEMENT ACTUALLY IS, because the arithmetic is where a record quietly turns
flattering. A parlay is all-or-nothing across its legs:

  * one LOST leg loses the ticket, however well the others did;
  * a PUSHED leg (the actual lands exactly on the line, or a game ties) DROPS OUT and the
    remaining legs still have to land — it does not rescue the ticket and it does not sink it;
  * a VOID leg does the same. A player prop where the player never took the field is voided at
    every book worth copying, so it is voided here rather than scored as a loss. Scoring a DNP
    as a loss would make our published record look WORSE than the truth, which is the mirror
    image of flattery and just as wrong;
  * a ticket whose legs ALL push or void is itself VOID — no stake was at risk, so it is not a
    result and parlayRecord() leaves it out of the record entirely.

Results come from nflverse, the same source grade_predictions.py uses:
  games.csv            -> moneyline legs
  data/stats_{season}.csv -> player prop legs  (run analysis/fetch_data.py first)

Like grade_predictions.py this is APPEND-ONLY and idempotent: parlay_results is keyed by
parlay_id and written with resolution=ignore-duplicates, so a re-run cannot re-score or
double-count a ticket that is already on the record.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

import odds_client as oc

GAMES_LOCAL = "data/games.csv"

# prop market key -> (nflverse stat column, is_anytime_td). Same mapping analysis/prop_backtest.py
# grades its backtests with; kept identical on purpose so the published record and the research
# agree about what "cleared the line" means.
PROP_STAT = {
    "player_pass_yds": ("passing_yards", False),
    "player_pass_tds": ("passing_tds", False),
    "player_rush_yds": ("rushing_yards", False),
    "player_reception_yds": ("receiving_yards", False),
    "player_receptions": ("receptions", False),
    "player_anytime_td": (None, True),
}


def norm(n):
    """Match prop_backtest.norm: lowercase, letters only."""
    return "".join(c for c in (n or "").lower() if c.isalpha())


def _get(env, table, query):
    """PostgREST read, PAGED — a `limit=` does not raise the server's 1000-row ceiling, and a
    truncated read of the already-graded set would re-grade tickets already on the record."""
    key = env["SUPABASE_SERVICE_KEY"]
    base = f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/{table}{query}"
    out, PAGE, off = [], 1000, 0
    while True:
        req = urllib.request.Request(base, headers={"apikey": key, "Authorization": f"Bearer {key}",
                                                    "Range-Unit": "items",
                                                    "Range": f"{off}-{off + PAGE - 1}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            page = json.loads(r.read())
        out += page
        if len(page) < PAGE:
            return out
        off += PAGE


def load_games():
    """(season, week, home_abbr) -> (home_score, away_score) for FINAL games only."""
    import csv
    if not os.path.exists(GAMES_LOCAL):
        return None
    out = {}
    with open(GAMES_LOCAL, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            hs, aws = r.get("home_score"), r.get("away_score")
            if not hs or not aws or hs == "NA" or aws == "NA":
                continue
            try:
                season, week = int(r["season"]), int(r["week"])
            except (ValueError, KeyError, TypeError):
                continue
            out[(season, week, r.get("home_team"))] = (float(hs), float(aws))
    return out


STATS_URL = ("https://github.com/nflverse/nflverse-data/releases/download"
             "/stats_player/stats_player_week_{season}.csv")


def ensure_stats(season):
    """Download data/stats_{season}.csv if it is not already there.

    Self-sufficient on purpose: this runs inside grade-predictions.yml, which installs no data
    beyond the games.csv grade_predictions.py fetches for itself. Requiring a separate
    `analysis/fetch_data.py` step would mean ~150MB and several minutes of downloads for two
    columns, and — worse — a grading job whose prop legs silently VOID whenever that step was
    forgotten. `data/` is gitignored, so the directory has to be created first; that exact
    omission has broken two other jobs in this repo."""
    path = f"data/stats_{season}.csv"
    if os.path.exists(path):
        return path
    os.makedirs("data", exist_ok=True)
    req = urllib.request.Request(STATS_URL.format(season=season),
                                 headers={"User-Agent": "statseer/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"  stats_{season}.csv unavailable ({e}) — prop legs will stay pending")
        return None
    with open(path, "wb") as fh:
        fh.write(data)
    return path


def load_actuals(season):
    """(week, normalized player) -> stat dict. Same shape as prop_backtest.load_actuals."""
    import csv
    path = ensure_stats(season)
    if not path or not os.path.exists(path):
        return None
    out = {}
    with open(path, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            nm = norm(r.get("player_display_name") or r.get("player_name") or "")
            wk = r.get("week")
            if not nm or not str(wk).isdigit():
                continue
            def num(c):
                try:
                    return float(r.get(c) or 0)
                except ValueError:
                    return 0.0
            out[(int(wk), nm)] = {
                "passing_yards": num("passing_yards"), "passing_tds": num("passing_tds"),
                "rushing_yards": num("rushing_yards"), "rushing_tds": num("rushing_tds"),
                "receiving_yards": num("receiving_yards"), "receiving_tds": num("receiving_tds"),
                "receptions": num("receptions"),
            }
    return out


def grade_leg(leg, season, week, games, actuals):
    """-> (outcome, detail). outcome in WIN/LOSS/PUSH/VOID/PENDING.

    >>> G = {(2026, 11, "SF"): (24.0, 17.0), (2026, 11, "DET"): (20.0, 20.0)}
    >>> A = {(11, "ceedeelamb"): {"receptions": 6.0, "receiving_yards": 71.0,
    ...                           "rushing_yards": 0.0, "rushing_tds": 0.0,
    ...                           "receiving_tds": 1.0, "passing_yards": 0.0, "passing_tds": 0.0}}
    >>> ml = {"marketKey": "h2h", "team": "SF", "home": "SF", "away": "MIN"}
    >>> grade_leg(ml, 2026, 11, G, A)[0]                       # home side won
    'WIN'
    >>> grade_leg({**ml, "team": "MIN"}, 2026, 11, G, A)[0]    # the other side of the same game
    'LOSS'
    >>> grade_leg({**ml, "team": "DET", "home": "DET", "away": "TB"}, 2026, 11, G, A)[0]
    'PUSH'
    >>> grade_leg({**ml, "home": "KC", "away": "ARI"}, 2026, 11, G, A)[0]   # not final yet
    'PENDING'

    A prop settles against the line it was TAKEN at, and lands exactly on it as a push:

    >>> rec = {"marketKey": "player_receptions", "player": "CeeDee Lamb", "home": "SF",
    ...        "side": "Over", "line": 5.5}
    >>> grade_leg(rec, 2026, 11, G, A)[0]
    'WIN'
    >>> grade_leg({**rec, "line": 6.5}, 2026, 11, G, A)[0]
    'LOSS'
    >>> grade_leg({**rec, "line": 6.0}, 2026, 11, G, A)[0]
    'PUSH'
    >>> grade_leg({**rec, "side": "Under", "line": 6.5}, 2026, 11, G, A)[0]
    'WIN'
    >>> grade_leg({"marketKey": "player_anytime_td", "player": "CeeDee Lamb", "home": "SF"},
    ...           2026, 11, G, A)[0]
    'WIN'

    A player who never took the field is VOID, the way a book settles it -- not a loss:

    >>> grade_leg({**rec, "player": "Nobody At All"}, 2026, 11, G, A)[0]
    'VOID'

    But no stats file at all is PENDING, because absence of evidence is not a settlement:

    >>> grade_leg(rec, 2026, 11, G, None)[0]
    'PENDING'
    """
    mk = leg.get("marketKey")

    if mk == "h2h":
        team = leg.get("team")
        home, away = leg.get("home"), leg.get("away")
        res = games.get((season, week, home))
        if res is None:
            return "PENDING", "game not final"
        hs, aws = res
        if hs == aws:
            return "PUSH", f"{away} {aws:.0f}-{hs:.0f} {home} (tie)"
        winner = home if hs > aws else away
        got = "WIN" if team == winner else "LOSS"
        return got, f"{away} {aws:.0f}-{hs:.0f} {home}, {winner} won"

    stat = PROP_STAT.get(mk)
    if stat is None:
        return "VOID", f"no settlement rule for {mk}"
    # The game has to be final before a missing player means "did not play" rather than
    # "the stats file has not caught up yet".
    if games.get((season, week, leg.get("home"))) is None:
        return "PENDING", "game not final"
    # 🚨 NO STATS FILE IS PENDING, NEVER VOID. An earlier version passed `actuals or {}`, which
    # made an unavailable download indistinguishable from "this player did not take the field" —
    # so one failed nflverse fetch would have voided every prop ticket PERMANENTLY, and the
    # append-only results table means there is no taking that back. Absence of evidence is not a
    # settlement.
    if actuals is None:
        return "PENDING", "weekly stats not available yet"
    act = actuals.get((week, norm(leg.get("player"))))
    if act is None:
        return "VOID", f"{leg.get('player')} did not play"

    col, is_td = stat
    if is_td:
        scored = (act["rushing_tds"] + act["receiving_tds"]) >= 1
        # Anytime TD is quoted Yes-only (see lib/propParlay.ts), so a leg is always the Yes.
        return ("WIN" if scored else "LOSS"), f"{act['rushing_tds'] + act['receiving_tds']:.0f} TD"

    line = leg.get("line")
    if line is None:
        return "VOID", "no line to settle against"
    value = act[col]
    if value == float(line):
        return "PUSH", f"{value:.1f} = {line}"
    over = value > float(line)
    side = (leg.get("side") or "Over").lower()
    won = over if side == "over" else (not over)
    return ("WIN" if won else "LOSS"), f"{value:.1f} vs {side} {line}"


def ticket_outcome(leg_outcomes):
    """A parlay is all-or-nothing; pushes and voids drop out. None = still pending.

    Checked by `python -m doctest grade_parlays.py`. These five cases are the whole settlement
    rule, and each one is a way a published record could quietly be made wrong.

    >>> O = lambda *s: [{"outcome": x} for x in s]
    >>> ticket_outcome(O("WIN", "WIN", "WIN"))            # every leg lands
    'WIN'
    >>> ticket_outcome(O("WIN", "LOSS", "WIN"))           # one loss sinks it, however good the rest
    'LOSS'
    >>> ticket_outcome(O("WIN", "PUSH", "WIN"))           # a push DROPS OUT; the rest still had to land
    'WIN'
    >>> ticket_outcome(O("WIN", "PENDING"))               # not settled until every leg is
    >>> ticket_outcome(O("PUSH", "VOID")) == 'VOID'       # nothing was ever at risk
    True
    >>> ticket_outcome(O("LOSS", "VOID"))                 # a void does not rescue a lost ticket
    'LOSS'
    """
    if any(o["outcome"] == "PENDING" for o in leg_outcomes):
        return None
    live = [o for o in leg_outcomes if o["outcome"] in ("WIN", "LOSS")]
    if not live:
        return "VOID"                       # every leg pushed or voided: no stake was at risk
    if any(o["outcome"] == "LOSS" for o in live):
        return "LOSS"
    return "WIN"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="append grades (permanent)")
    ap.add_argument("--season", type=int, default=None)
    args = ap.parse_args(argv)

    env = oc.load_env()
    oc.ensure_ssl_certs()

    try:
        tickets = _get(env, "parlay_ledger",
                       "?select=id,sport,season,week,ticket,american,legs&order=published_at")
        graded = {r["parlay_id"] for r in _get(env, "parlay_results", "?select=parlay_id")}
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        # Transient Supabase read — skip rather than email a FAILURE. Grades land next run.
        print(f"Supabase read failed (transient): {e} — skipping")
        return 0

    if args.season:
        tickets = [t for t in tickets if int(t["season"]) == args.season]
    todo = [t for t in tickets if t["id"] not in graded]
    print(f"{len(tickets)} published tickets, {len(graded)} already graded, {len(todo)} to look at")
    if not todo:
        return 0

    games = load_games()
    if games is None:
        print(f"{GAMES_LOCAL} missing — run analysis/fetch_data.py first", file=sys.stderr)
        return 1
    actuals_by_season = {}

    new_rows, pending = [], 0
    for t in todo:
        season, week = int(t["season"]), int(t["week"])
        if season not in actuals_by_season:
            actuals_by_season[season] = load_actuals(season)    # may be None — see grade_leg
        actuals = actuals_by_season[season]
        legs = t.get("legs") or []
        outs = []
        for leg in legs:
            o, detail = grade_leg(leg, season, week, games, actuals)
            outs.append({"pick": leg.get("pick"), "market": leg.get("market") or "Moneyline",
                         "outcome": o, "detail": detail})
        res = ticket_outcome(outs)
        if res is None:
            pending += 1
            continue
        won = sum(1 for o in outs if o["outcome"] == "WIN")
        print(f"  + wk{week} {t['ticket']} ({t['american']}): {res}  [{won}/{len(outs)} legs]")
        for o in outs:
            print(f"      {o['outcome']:<7} {o['pick']} — {o['detail']}")
        new_rows.append({"parlay_id": t["id"], "outcome": res,
                         "legs_won": won, "legs_total": len(outs),
                         "leg_outcomes": outs})

    print(f"\n{len(new_rows)} newly final, {pending} still pending")
    if not args.write:
        print("DRY RUN — nothing written. Add --write to append grades.")
        return 0
    if not new_rows:
        return 0

    key = env["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(
        f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/parlay_results?on_conflict=parlay_id",
        data=json.dumps(new_rows).encode("utf-8"),
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "Prefer": "return=minimal,resolution=ignore-duplicates"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            print(f"appended {len(new_rows)} grades" if r.getcode() in (200, 201, 204) else "write failed")
    except urllib.error.HTTPError as e:
        print(f"WRITE FAILED {e.code}: {e.read().decode()[:400]}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
