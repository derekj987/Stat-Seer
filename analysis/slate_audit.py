"""
slate_audit.py -- is every game that is being PLAYED and PRICED actually on our board,
on the right day, at the right time?

Derek, after Montana State @ Idaho was on the book at -14.5 and missing from the NCAAF board:
"let's check all dates/times are being played and compare them to fanduel ... last week we had a
game being played on a thursday that did not show up on our site."

WHAT IT COMPARES, AND WHY NOT FANDUEL DIRECTLY
  FanDuel's site is not scraped -- their terms. The licensed Odds API feed carries FanDuel's own
  prices, so "what FanDuel lists" is read from the feed instead. Three sets per sport:

    SCHEDULE  what is actually being played   (cfb.db for NCAAF, data/games.csv for NFL,
                                               nhl_results for NHL, statsapi for MLB,
                                               ESPN's scoreboard for NBA)
    MARKET    what a book has priced          (the Odds API; NCAAF needs BOTH sport keys)
    BOARD     what we publish

  🚨 THE SCHEDULE MUST NOT COME FROM OUR OWN CAPTURE. Each source above is independent of the
  table the board is built from, and that is the whole design: a guardrail that shares a dependency
  with its subject is an echo, not a check. NBA shipped without an audit for exactly this reason —
  the only NBA schedule in the project was nba_odds_snapshots, so the audit would have agreed with
  itself by construction and printed "every priced game is on the board" even if the capture had
  dropped half the slate. ESPN broke the dependency; see nba_schedule().

  A game priced but not on the board is the Montana State class and the one that matters: the
  market says members can bet it and we are silent. A game whose kickoff disagrees with the
  schedule is the Thursday class -- present, but filed under the wrong day, which reads as missing.

    python analysis/slate_audit.py                # next 8 days, both sports
    python analysis/slate_audit.py --days 3 --sport ncaaf
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sqlite3
import sys
import unicodedata
import urllib.request
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "analysis"))

import odds_client as oc  # noqa: E402
from cfb_export import (_toks as _ce_toks, _norm as _ce_norm,  # noqa: E402
                        _TEAM_ALIASES as _ce_alias)            # one tokeniser + alias table, not two

ET = dt.timezone(dt.timedelta(hours=-4))
TIME_TOL_MIN = 45          # kickoffs inside this agree; beyond it the board is on the wrong slot
FAILS: list[str] = []
WARNS: list[str] = []


def say(s=""):
    print(s)


def fail(m):
    FAILS.append(m)
    say(f"  [FAIL] {m}")


def warn(m):
    WARNS.append(m)
    say(f"  [warn] {m}")


def ok(m):
    say(f"  [ok]   {m}")


def norm(s):
    # Decompose accents BEFORE stripping non-alphanumerics, or the letter is lost rather than
    # folded: "San Jose State" with an accent became "sanjosstate" (no 'e') and never matched the
    # feed's "sanjosestatespartans". ncaaf_guardrail already does this for the same reason.
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s.lower())


# 🚨 THREE SOURCES, THREE NAMING CONVENTIONS — canonicalise before comparing or the audit invents
# failures. The first run of this script reported 26 missing games, every one of them real and on
# the board: the schedule and board say `airforce` / `bal`, the odds feed says `airforcefalcons` /
# `baltimoreravens`. A set difference across conventions is not a finding, it is a bug, and a
# coverage checker that cries wolf is worse than none.
def nfl_key(name):
    """Odds-feed full name -> nflverse abbreviation, via the map odds_client already verifies."""
    return norm(oc.TEAM_ABBR.get(name, name))


def ncaaf_key(name, schools):
    """Odds-feed name carries the mascot ('Air Force Falcons'); CFBD does not ('Air Force').

    🚨 USES PRODUCTION'S TOKENISER, deliberately. A plain prefix match of my own got "The Citadel"
    vs "citadel bulldogs" and "Youngstown State" vs "youngstown st penguins" wrong — the same three
    gaps cfb_export._toks exists to close — so the audit reported games as missing that the board
    had just started carrying. An auditor with its own private idea of what two names mean will
    disagree with the thing it audits and the disagreement will read as a finding.

    Longest match wins so 'Miami' never claims a row belonging to 'Miami (OH)'.
    """
    nt = _ce_toks(name)
    best, bestlen = None, -1
    for s in schools:
        for cand in (s, _ce_alias.get(_ce_norm(s))):
            if not cand:
                continue
            st = _ce_toks(cand)
            if st and nt[:len(st)] == st and len(st) > bestlen:
                best, bestlen = s, len(st)
    return norm(best) if best else norm(name)


def within(iso, days):
    """True if `iso` kicks off between now and `days` from now."""
    try:
        t = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return False
    now = dt.datetime.now(dt.timezone.utc)
    return now - dt.timedelta(hours=6) <= t <= now + dt.timedelta(days=days)


# ---------------- NCAAF ----------------

def ncaaf_schedule(days):
    db = os.path.join(ROOT, "data", "cfb.db")
    if not os.path.exists(db):
        return None
    conn = sqlite3.connect(db)
    out = {}
    for away, home, sd, hc, ac in conn.execute(
            "SELECT away_team, home_team, start_date, home_class, away_class "
            "FROM games WHERE season=?", (oc_season(),)):
        if not within(sd, days):
            continue
        if hc not in ("fbs", "fcs") or ac not in ("fbs", "fcs"):
            continue            # D-II/D-III are not a board gap; no book prices them
        out[(norm(away), norm(home))] = sd
    conn.close()
    return out


def all_schools():
    """Every school in cfb.db for the season, normalised — the canonicalisation target."""
    db = os.path.join(ROOT, "data", "cfb.db")
    if not os.path.exists(db):
        return None
    conn = sqlite3.connect(db)
    # RAW names, not normalised: _toks has to see the word boundaries. Pre-normalising collapsed
    # "Air Force" to "airforce", which tokenises as one blob and matches nothing.
    out = set()
    for (t,) in conn.execute("SELECT DISTINCT home_team FROM games WHERE season=?", (oc_season(),)):
        out.add(t)
    for (t,) in conn.execute("SELECT DISTINCT away_team FROM games WHERE season=?", (oc_season(),)):
        out.add(t)
    conn.close()
    return out


def oc_season():
    return 2026


def ncaaf_market(days, schools):
    """Every NCAAF game a book has priced, across BOTH sport keys. FCS lives behind its own."""
    key = oc.load_env().get("ODDS_API_KEY")
    if not key:
        return None
    oc.ensure_ssl_certs()
    out = {}
    for sport in ("americanfootball_ncaaf", "americanfootball_ncaaf_fcs"):
        url = (f"https://api.the-odds-api.com/v4/sports/{sport}/odds"
               f"?apiKey={key}&regions=us&markets=spreads&oddsFormat=american")
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            warn(f"NCAAF odds fetch failed for {sport}: {e}")
            continue
        for g in data:
            if within(g.get("commence_time"), days):
                out[(ncaaf_key(g["away_team"], schools),
                     ncaaf_key(g["home_team"], schools))] = g["commence_time"]
    return out


def ncaaf_board(days):
    path = os.path.join(ROOT, "web/app/ncaaf/model-data.ts")
    if not os.path.exists(path):
        return None
    txt = open(path, encoding="utf-8").read()
    i = txt.index("export const NCAAF_MODEL = ")
    d, _ = json.JSONDecoder().raw_decode(txt[txt.index("{", i):])
    # The card serves EVERY scheduled week (card.weeks), not just card.games for the current one.
    # Reading only the current week made an 8-day window look like a coverage gap the moment it
    # crossed into next week's slate.
    out = {}
    buckets = [d["card"]["games"]] + [w.get("games") or [] for w in (d["card"].get("weeks") or [])]
    for games in buckets:
        for g in games:
            if g.get("commence") and within(g["commence"], days):
                out[(norm(g["away"]), norm(g["home"]))] = g["commence"]
    return out


# ---------------- NFL ----------------

def nfl_schedule(days):
    import pandas as pd
    path = os.path.join(ROOT, "data", "games.csv")
    if not os.path.exists(path):
        return None
    g = pd.read_csv(path, low_memory=False)
    g = g[(g.season == oc_season()) & (g.game_type == "REG")]
    out = {}
    for _, r in g.iterrows():
        try:
            t = dt.datetime.strptime(f"{r.gameday} {r.gametime}", "%Y-%m-%d %H:%M").replace(tzinfo=ET)
        except Exception:  # noqa: BLE001
            continue
        iso = t.astimezone(dt.timezone.utc).isoformat()
        if within(iso, days):
            out[(norm(r.away_team), norm(r.home_team))] = iso
    return out


def _sb(table, query):
    env = oc.load_env()
    key = env["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(
        f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/{table}{query}",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Range-Unit": "items", "Range": "0-4999"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def nfl_board(days):
    """Games our odds capture has recorded pregame — which is what /model can show.

    NOT a reimplementation of board.ts fetchWeek. That takes the newest SCHEDULED sweep for the
    week and then back-fills any event missing from it with that event's last pregame sweep, so a
    game absent from the newest sweep is still on the board. Mirroring half of it (newest sweep
    only, no week filter) reported 7 of 15 games missing that were all present. The coverage
    question is simply whether the capture ever saw the game before kickoff, so ask that.
    """
    # One row per (event, sweep): FanDuel's total Over, the same narrowing board.ts uses for its
    # marks lookup. Without it odds_snapshots returns a row per book x market x outcome x sweep and
    # any limit truncates mid-slate -- which is how this reported 7 real games as missing.
    lo = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=6)).isoformat()
    hi = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)).isoformat()
    rows = _sb("odds_snapshots",
               "?book=eq.fanduel&market=eq.totals&outcome_name=eq.Over"
               f"&commence_time=gte.{quote(lo)}&commence_time=lte.{quote(hi)}"
               "&select=commence_time,home_team,away_team,snapshot_at&limit=5000")
    out = {}
    for r in rows:
        if within(r.get("commence_time"), days) and r.get("snapshot_at", "") < r["commence_time"]:
            out[(norm(r["away_team"]), norm(r["home_team"]))] = r["commence_time"]
    return out


# ---------------- compare ----------------

def drift_minutes(a, b):
    ta = dt.datetime.fromisoformat(str(a).replace("Z", "+00:00"))
    tb = dt.datetime.fromisoformat(str(b).replace("Z", "+00:00"))
    return abs((ta - tb).total_seconds()) / 60.0


def compare(sport, sched, market, board, days):
    say(f"\n## {sport} — next {days} days")
    say()
    if sched is None or market is None or board is None:
        # 🚨 A MISSING SOURCE IS A FAILURE, NOT A WARNING. This used to warn and return, and the
        # run then ended "**All clear.** 2 warning(s)" having compared nothing against nothing —
        # a false all-clear in the tool whose entire job is catching missing games. It happens
        # the moment this is run from a git worktree, because `data/` is gitignored and neither
        # data/games.csv nor data/cfb.db exists there.
        fail(f"{sport}: a source is unavailable (schedule={sched is not None}, "
             f"market={market is not None}, board={board is not None}) — NOTHING WAS AUDITED. "
             f"If this is a worktree, link the data in: "
             f"mklink /J <worktree>\\data <repo>\\data")
        return
    say(f"  schedule {len(sched)}   priced by a book {len(market)}   on our board {len(board)}")

    # 1. PRICED but not on the board — the Montana State class.
    # Separate OUR gap from the schedule source's. A priced game absent from our own schedule
    # cannot be boarded at all, and calling that the same defect as one we dropped sends the next
    # reader looking in the wrong file.
    missing = [k for k in market if k not in board]
    if missing:
        for k in sorted(missing)[:12]:
            when = dt.datetime.fromisoformat(market[k].replace("Z", "+00:00")).astimezone(ET)
            why = ("not in our schedule source either — upstream gap, not the board"
                   if k not in sched else "IN our schedule but dropped from the board")
            fail(f"{sport}: priced but NOT on our board — {k[0]} @ {k[1]}  "
                 f"{when:%a %b %d %I:%M %p ET}  ({why})")
        if len(missing) > 12:
            fail(f"{sport}: ...and {len(missing)-12} more priced games absent from the board")
    else:
        ok(f"{sport}: every priced game is on the board")

    # 2. On the board at the WRONG TIME — the Thursday class.
    # CFBD writes 04:00:00.000Z -- midnight ET -- when a kickoff has not been ANNOUNCED yet
    # (0% of week 5-6 games, 13% of week 9). That is a placeholder, not a disagreement, so it is
    # reported separately: the board should not publish a fake midnight when the market knows the
    # real time, but it is not the same defect as a game filed on the wrong day.
    drift, tbd = [], []
    for k, when in board.items():
        ref = market.get(k) or sched.get(k)
        if not ref:
            continue
        if str(when).endswith("T04:00:00.000Z"):
            if drift_minutes(when, ref) > TIME_TOL_MIN:
                tbd.append((k, when, ref))
            continue
        if drift_minutes(when, ref) > TIME_TOL_MIN:
            drift.append((k, when, ref))
    if drift:
        for k, ours, ref in sorted(drift, key=lambda x: -drift_minutes(x[1], x[2]))[:10]:
            o = dt.datetime.fromisoformat(ours.replace("Z", "+00:00")).astimezone(ET)
            r = dt.datetime.fromisoformat(str(ref).replace("Z", "+00:00")).astimezone(ET)
            fail(f"{sport}: kickoff disagrees — {k[0]} @ {k[1]}  ours {o:%a %I:%M %p} vs "
                 f"{r:%a %I:%M %p} ET ({drift_minutes(ours, ref):.0f} min)")
    else:
        ok(f"{sport}: every board kickoff agrees with the schedule/market to within {TIME_TOL_MIN} min")
    if tbd:
        warn(f"{sport}: {len(tbd)} game(s) published at a fake midnight (CFBD kickoff not announced) "
             f"while a book already has a time — e.g. "
             + ", ".join(f"{a}@{h}" for (a, h), _, _ in sorted(tbd)[:3]))

    # 3. Scheduled and priced but missing — already covered by (1); report the reverse as info.
    extra = [k for k in board if k not in sched and k not in market]
    if extra:
        warn(f"{sport}: {len(extra)} board game(s) in neither the schedule nor the market "
             f"(name-matching, most likely): {', '.join(f'{a}@{h}' for a, h in sorted(extra)[:4])}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=8)
    ap.add_argument("--sport", choices=["nfl", "ncaaf", "mlb", "nhl", "nba", "both", "all"],
                    default="all", help='"both" is football only, kept for existing callers')
    args = ap.parse_args(argv)

    say(f"# Slate audit — {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC")
    if args.sport in ("ncaaf", "both", "all"):
        nsched = ncaaf_schedule(args.days)
        # Every school in the season, not just the ones playing in the window: canonicalisation
        # must not depend on whether a team happens to have a game in the next 8 days, or a
        # mascot-suffixed feed name has nothing to match and reads as a missing game.
        schools = all_schools() or set()
        compare("NCAAF", nsched, ncaaf_market(args.days, schools),
                ncaaf_board(args.days), args.days)
    if args.sport in ("nfl", "both", "all"):
        compare("NFL", nfl_schedule(args.days), nfl_market(args.days),
                nfl_board(args.days), args.days)
    if args.sport in ("nhl", "all"):
        compare("NHL", nhl_schedule(args.days),
                _odds_events("icehockey_nhl", args.days, "NHL"),
                _snapshot_board("nhl_odds_snapshots", args.days, "NHL"), args.days)
    if args.sport in ("mlb", "all"):
        compare("MLB", mlb_schedule(args.days),
                _odds_events("baseball_mlb", args.days, "MLB"),
                _snapshot_board("mlb_odds_snapshots", args.days, "MLB"), args.days)
    if args.sport in ("nba", "all"):
        compare("NBA", nba_schedule(args.days),
                _odds_events("basketball_nba", args.days, "NBA"),
                _snapshot_board("nba_odds_snapshots", args.days, "NBA"), args.days)

    say("\n---")
    if FAILS:
        say(f"**{len(FAILS)} FAILURE(S)** — a game is missing from the board or filed on the wrong day.")
        return 1
    say(f"**All clear.** {len(WARNS)} warning(s)." if WARNS else "**All clear.**")
    return 0


def nfl_market(days):
    key = oc.load_env().get("ODDS_API_KEY")
    if not key:
        return None
    oc.ensure_ssl_certs()
    url = ("https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds"
           f"?apiKey={key}&regions=us&markets=spreads&oddsFormat=american")
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = json.loads(r.read())
    except Exception as e:  # noqa: BLE001
        warn(f"NFL odds fetch failed: {e}")
        return None
    return {(nfl_key(g["away_team"]), nfl_key(g["home_team"])): g["commence_time"]
            for g in data if within(g.get("commence_time"), days)}


# ---------------- MLB and NHL ----------------
#
# 🚨 THESE TWO KEY ON (away, home, DATE), not on the team pair alone. Football's key is the pair,
# which is safe when two teams meet once a season. Baseball and hockey play SERIES: over an 8-day
# window the same pair meets two, three or four times, and a pair-only key collapses them into one
# game — so a slate with three Rays-at-Guardians games would audit as one and the other two would
# read as neither missing nor present. The ET calendar date separates them.
#
# WHAT THAT STILL CANNOT SEPARATE is a doubleheader: two games, one date, one pair. statsapi gives
# a gamePk that survives it (mlb_availability.py already keys on that), but the odds feed carries no
# such id, so there is nothing to join them on. Rather than silently merge the pair, `mlb_schedule`
# COUNTS the doubleheaders it saw and the audit reports them as a known blind spot. Same shape as
# the lesson in the visual-audit skill: a board keyed on day + matchup lost one game of a
# doubleheader, and the fix there was nearest-first-pitch pairing on a board that HAD both rows.

def _daykey(away, home, iso):
    """Key a game by both clubs and its ET calendar date — see the note above."""
    try:
        d = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(ET).date()
    except Exception:  # noqa: BLE001
        return (norm(away), norm(home), "?")
    return (norm(away), norm(home), d.isoformat())


def _odds_events(sport_key, days, label):
    """Upcoming events for a sport key. `/events` rather than `/odds`: it costs no credits and the
    question here is which games exist on the book, never what they are priced at."""
    key = oc.load_env().get("ODDS_API_KEY")
    if not key:
        return None
    oc.ensure_ssl_certs()
    url = f"https://api.the-odds-api.com/v4/sports/{sport_key}/events?apiKey={key}"
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = json.loads(r.read())
    except Exception as e:  # noqa: BLE001
        warn(f"{label} odds fetch failed: {e}")
        return None
    return {_daykey(g["away_team"], g["home_team"], g["commence_time"]): g["commence_time"]
            for g in data if within(g.get("commence_time"), days)}


def _snapshot_board(table, days, label):
    """Games our capture recorded PREGAME, which is what the page can show.

    Narrowed to one row per (event, sweep) the way nfl_board is: these tables hold a row per
    book x market x outcome x sweep, so an unnarrowed read truncates mid-slate and reports real
    games as missing — the exact failure documented on nfl_board above.
    """
    lo = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=6)).isoformat()
    hi = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)).isoformat()
    try:
        rows = _sb(table,
                   "?book=eq.fanduel&market=eq.totals&outcome_name=eq.Over"
                   f"&commence_time=gte.{quote(lo)}&commence_time=lte.{quote(hi)}"
                   "&select=commence_time,home_team,away_team,snapshot_at&limit=5000")
    except Exception as e:  # noqa: BLE001
        warn(f"{label} board read failed: {e}")
        return None
    out = {}
    for r in rows:
        if within(r.get("commence_time"), days) and r.get("snapshot_at", "") < r["commence_time"]:
            out[_daykey(r["away_team"], r["home_team"], r["commence_time"])] = r["commence_time"]
    # 🚨 SAY HOW OLD THE NEWEST SWEEP IS, because for these two sports that is usually the answer.
    # A game can be priced on the book right now and absent from this table purely because the
    # capture has not run since the book posted it — which is a CADENCE fact, not a board defect,
    # and without this line the audit reports it as "dropped from the board" and cries wolf.
    # Measured 2026-10-24: capture-nhl-odds declares every 30 min (cron "14,44") and delivered
    # 3 runs in the 14 hours before this audit, so the newest sweep was 2.4 h old and the five
    # games the books had just priced for Sunday were legitimately not in it yet.
    if rows:
        newest = max(r.get("snapshot_at", "") for r in rows)
        try:
            age = (dt.datetime.now(dt.timezone.utc)
                   - dt.datetime.fromisoformat(newest.replace("Z", "+00:00"))).total_seconds() / 3600
            say(f"  [info] {label}: newest capture sweep is {age:.1f} h old ({newest[:16]}Z) — "
                f"anything the books priced since then cannot be on the board yet")
        except Exception:  # noqa: BLE001
            pass
    return out


def nhl_schedule(days):
    """The NHL's own schedule, as nhl_results holds it — it carries future games (its forward
    schedule runs to the end of the season), so it is a schedule source and not only a results
    table."""
    lo = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=6)).isoformat()
    hi = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)).isoformat()
    try:
        rows = _sb("nhl_results",
                   f"?start_time_utc=gte.{quote(lo)}&start_time_utc=lte.{quote(hi)}"
                   "&select=start_time_utc,home_team,away_team&limit=5000")
    except Exception as e:  # noqa: BLE001
        warn(f"NHL schedule read failed: {e}")
        return None
    return {_daykey(r["away_team"], r["home_team"], r["start_time_utc"]): r["start_time_utc"]
            for r in rows if within(r.get("start_time_utc"), days)}


def mlb_schedule(days):
    """statsapi.mlb.com — public, no key, and the same source mlb_availability.py uses."""
    lo = dt.datetime.now(ET).date()
    hi = lo + dt.timedelta(days=days)
    url = ("https://statsapi.mlb.com/api/v1/schedule?sportId=1"
           f"&startDate={lo:%Y-%m-%d}&endDate={hi:%Y-%m-%d}")
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = json.loads(r.read())
    except Exception as e:  # noqa: BLE001
        warn(f"MLB schedule fetch failed: {e}")
        return None
    out, seen, dh = {}, set(), 0
    for day in data.get("dates", []):
        for g in day.get("games", []):
            iso = g.get("gameDate")
            a = (g.get("teams", {}).get("away", {}).get("team", {}) or {}).get("name")
            h = (g.get("teams", {}).get("home", {}).get("team", {}) or {}).get("name")
            if not (iso and a and h) or not within(iso, days):
                continue
            k = _daykey(a, h, iso)
            if k in seen:
                dh += 1                      # second game of a doubleheader — see the note above
                continue
            seen.add(k)
            out[k] = iso
    if dh:
        warn(f"MLB: {dh} doubleheader game(s) in the window cannot be told apart from their "
             f"first game — the odds feed carries no gamePk, so they are a known blind spot")
    return out


def nba_schedule(days):
    """ESPN's scoreboard — public, no key, and the same host nba_rosters.py already reads.

    🚨 THE WHOLE POINT OF THIS FUNCTION IS THAT IT IS NOT OUR OWN CAPTURE. When the NBA module
    shipped, this audit deliberately skipped the sport rather than check it, because the only NBA
    schedule in the project was nba_odds_snapshots — the very table the board is built from.
    Comparing a capture against a board built from that capture is an ECHO, not a check: it agrees
    by construction and would have printed "every priced game is on the board" even if the capture
    had silently dropped half the slate. That is the guardrail-shares-a-dependency-with-its-subject
    failure the visual-audit skill already has a section about. ESPN breaks the dependency.

    ONE REQUEST PER ET DAY, which is not a style choice: this endpoint rejects a date RANGE with a
    400 (`?dates=20261026-20261030` fails, `?dates=20261026` works). `dates=` means the ET GAME
    date, and the games it returns straddle two UTC dates — a 7:10 PM ET tip is 23:10Z the same day
    while a 10:10 PM ET tip is 02:10Z the next. That is exactly what _daykey keys on, so the two
    agree without any special handling.

    Team names need no aliasing: ESPN and the odds feed both write "Washington Wizards".
    """
    out = {}
    failed = []
    today = dt.datetime.now(ET).date()
    for i in range(days + 1):
        d = today + dt.timedelta(days=i)
        url = ("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
               f"?dates={d:%Y%m%d}")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "statseer/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            failed.append(f"{d:%Y-%m-%d} ({e})")
            continue
        for ev in data.get("events", []):
            iso = ev.get("date")
            comp = ((ev.get("competitions") or [{}])[0].get("competitors")) or []
            h = next((((c.get("team") or {}).get("displayName"))
                      for c in comp if c.get("homeAway") == "home"), None)
            a = next((((c.get("team") or {}).get("displayName"))
                      for c in comp if c.get("homeAway") == "away"), None)
            if not (iso and h and a) or not within(iso, days):
                continue
            out[_daykey(a, h, iso)] = iso
    # A PARTIAL SCHEDULE IS NOT A SILENT DEGRADATION. It cannot invent a missing-game failure —
    # check 1 compares the market against the board and uses the schedule only to attribute the
    # gap — but it does make that attribution wrong, and it can hide check 3. Say so, and treat a
    # total failure as no source at all so compare() fails loudly rather than auditing nothing.
    if failed and len(failed) == days + 1:
        warn(f"NBA schedule fetch failed for every day in the window: {failed[0]}")
        return None
    if failed:
        warn(f"NBA: {len(failed)} of {days + 1} schedule day(s) could not be fetched "
             f"({failed[0]}) — a priced game missing from the board will still be caught, but "
             f"the reason it gives may be wrong")
    return out


if __name__ == "__main__":
    raise SystemExit(main())
