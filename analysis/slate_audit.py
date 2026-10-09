"""
slate_audit.py -- is every game that is being PLAYED and PRICED actually on our board,
on the right day, at the right time?

Derek, after Montana State @ Idaho was on the book at -14.5 and missing from the NCAAF board:
"let's check all dates/times are being played and compare them to fanduel ... last week we had a
game being played on a thursday that did not show up on our site."

WHAT IT COMPARES, AND WHY NOT FANDUEL DIRECTLY
  FanDuel's site is not scraped -- their terms. The licensed Odds API feed carries FanDuel's own
  prices, so "what FanDuel lists" is read from the feed instead. Three sets per sport:

    SCHEDULE  what is actually being played   (cfb.db for NCAAF, data/games.csv for NFL)
    MARKET    what a book has priced          (the Odds API; NCAAF needs BOTH sport keys)
    BOARD     what we publish

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
        warn(f"{sport}: a source is unavailable (schedule={sched is not None}, "
             f"market={market is not None}, board={board is not None}) — cannot audit")
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
    ap.add_argument("--sport", choices=["nfl", "ncaaf", "both"], default="both")
    args = ap.parse_args(argv)

    say(f"# Slate audit — {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC")
    if args.sport in ("ncaaf", "both"):
        nsched = ncaaf_schedule(args.days)
        # Every school in the season, not just the ones playing in the window: canonicalisation
        # must not depend on whether a team happens to have a game in the next 8 days, or a
        # mascot-suffixed feed name has nothing to match and reads as a missing game.
        schools = all_schools() or set()
        compare("NCAAF", nsched, ncaaf_market(args.days, schools),
                ncaaf_board(args.days), args.days)
    if args.sport in ("nfl", "both"):
        compare("NFL", nfl_schedule(args.days), nfl_market(args.days),
                nfl_board(args.days), args.days)

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


if __name__ == "__main__":
    raise SystemExit(main())
