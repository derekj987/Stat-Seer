"""
nhl_goalies.py -- backfill who STARTED in goal, and how they did, from the NHL public API.

    python nhl_goalies.py --season 20262027 --dry-run
    python nhl_goalies.py --season 20262027 20252026          # local SQLite (data/nhl.db)
    python nhl_goalies.py --season 20262027 --supabase        # durable, for CI

🚨 READ THIS BEFORE ASSUMING THIS FEED CAN DO WHAT YOU WANT. The NHL's public API does NOT publish
a projected or confirmed starting goalie before a game. Checked endpoint by endpoint on a PRE-state
game: `schedule/now` has no goalie field at all, and `gamecenter/{id}/landing.matchup` carries
`goalieComparison` and `goalieSeasonStats` which list EVERY goalie on both rosters with season
numbers and name no starter -- the strings "start", "probable", "confirmed", "expected" and
"projected" appear zero times anywhere in that payload.

So this file answers "who started, and how did it go", which IS fully backfillable, and it cannot
answer "who is starting tonight", which is not in this feed at all and needs a third-party source.
That distinction matters for planning: the historical record here has no deadline, while the
pre-game announcement is the perishable half.

🚨 THE STARTER IS NOT THE FIRST ONE LISTED, AND NOT THE ONE WITH THE MOST ICE TIME. There is no
`starter` flag in the boxscore. Both obvious heuristics were measured on regular-season games where
both goalies played, and both were coin flips -- boxscore order 3/6, max TOI 3/6. Max TOI is
actively wrong whenever a starter is pulled early, which is the single case that most matters,
because that is a goalie who was announced, started, and got yanked.

The reliable answer is in the play-by-play: the goalie in net for that team's first event. That is
one extra request, so it is only made when BOTH goalies have ice time -- about 18% of games. When
one goalie played the whole way there is nothing to disambiguate.

Preseason (gameType 1) is EXCLUDED. Clubs split those by plan rather than by who is better, so
"the starter" is not a meaningful label there and including them would poison any rest/workload
model built on this table.

Responses are cached under data/nhl_cache/ because a season is ~1,300 boxscores; a re-run after the
first is nearly free, which matters when the fetch is the slow part and the parsing is what changes.

Stdlib + odds_client (TLS). The NHL API needs no key and costs nothing.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "analysis"))

import odds_client as oc  # noqa: E402

API = "https://api-web.nhle.com/v1"
DB = os.path.join(ROOT, "data", "nhl.db")
CACHE = os.path.join(ROOT, "data", "nhl_cache")
REGULAR_SEASON = 2          # gameType: 1 preseason, 2 regular, 3 playoffs

SCHEMA = """
CREATE TABLE IF NOT EXISTS nhl_goalie_starts (
  game_id        INTEGER NOT NULL,
  season         INTEGER NOT NULL,
  game_date      TEXT,
  start_utc      TEXT,
  team           TEXT NOT NULL,
  opponent       TEXT,
  is_home        INTEGER,
  goalie_id      INTEGER NOT NULL,
  goalie_name    TEXT,
  is_starter     INTEGER NOT NULL,
  toi_seconds    INTEGER,
  shots_against  INTEGER,
  saves          INTEGER,
  goals_against  INTEGER,
  save_pct       REAL,
  decision       TEXT,
  rest_days      INTEGER,
  is_back_to_back INTEGER,
  PRIMARY KEY (game_id, goalie_id)
);
CREATE INDEX IF NOT EXISTS ix_nhlg_team   ON nhl_goalie_starts(team, game_date);
CREATE INDEX IF NOT EXISTS ix_nhlg_goalie ON nhl_goalie_starts(goalie_id, game_date);
CREATE INDEX IF NOT EXISTS ix_nhlg_start  ON nhl_goalie_starts(is_starter, game_date);
"""


def _get(url, cache_key=None, tries=3):
    """GET with an on-disk cache. A completed game's boxscore never changes, so re-reads are free."""
    if cache_key:
        os.makedirs(CACHE, exist_ok=True)
        path = os.path.join(CACHE, cache_key + ".json")
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    return json.load(fh)
            except Exception:  # noqa: BLE001 — a truncated cache file is refetched, not fatal
                pass
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "statseer/1.0"})
            with urllib.request.urlopen(req, timeout=45) as r:
                data = json.loads(r.read())
            if cache_key:
                with open(os.path.join(CACHE, cache_key + ".json"), "w", encoding="utf-8") as fh:
                    json.dump(data, fh)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = e
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(1.5 * (i + 1))
    print(f"    give up on {url}: {last}", file=sys.stderr)
    return None


def _sec(toi):
    try:
        m, s = str(toi).split(":")
        return int(m) * 60 + int(s)
    except Exception:  # noqa: BLE001
        return 0


def season_games(season):
    """Completed REGULAR-SEASON games for a season, deduped across the 32 club schedules."""
    st = _get(f"{API}/standings/now")
    abbrevs = sorted({t["teamAbbrev"]["default"] for t in (st or {}).get("standings", [])})
    if not abbrevs:
        raise SystemExit("standings/now returned no teams — cannot enumerate the league")
    games, sched = {}, {}
    for ab in abbrevs:
        d = _get(f"{API}/club-schedule-season/{ab}/{season}", cache_key=f"sched_{ab}_{season}")
        rows = (d or {}).get("games", [])
        # A club's own ordered schedule is what rest days are computed from, so keep it per team
        # and keep EVERY game in it — a team's rest before game N depends on game N-1 whether or
        # not we are recording a goalie row for that one.
        sched[ab] = sorted((g.get("gameDate"), g.get("id")) for g in rows if g.get("gameDate"))
        for g in rows:
            if g.get("gameType") == REGULAR_SEASON and g.get("gameState") in ("OFF", "FINAL"):
                games[g["id"]] = g
    return games, sched


def rest_map(sched):
    """{(team, game_id): (rest_days, back_to_back)} from each club's own ordered schedule."""
    out = {}
    for ab, rows in sched.items():
        prev = None
        for date_s, gid in rows:
            try:
                d = dt.date.fromisoformat(date_s)
            except Exception:  # noqa: BLE001
                prev = None
                continue
            if prev is None:
                out[(ab, gid)] = (None, 0)
            else:
                gap = (d - prev).days
                # Rest days = clear days between games. Back-to-back is a gap of exactly 1 day,
                # which in hockey is the scheduling fact that most often decides a backup start.
                out[(ab, gid)] = (max(0, gap - 1), 1 if gap == 1 else 0)
            prev = d
    return out


def starters_from_pbp(gid):
    """{team_id: goalie_id} — the goalie in net for that team's first event. The only reliable
    answer when both goalies played; see the module docstring for why the heuristics are not."""
    pbp = _get(f"{API}/gamecenter/{gid}/play-by-play", cache_key=f"pbp_{gid}")
    if not pbp:
        return {}
    spot = {r["playerId"]: r.get("teamId") for r in pbp.get("rosterSpots", [])}
    first = {}
    for p in pbp.get("plays", []):
        g = (p.get("details") or {}).get("goalieInNetId")
        if not g:
            continue
        t = spot.get(g)
        if t and t not in first:
            first[t] = g
    return first


def game_rows(gid, meta, rest):
    bx = _get(f"{API}/gamecenter/{gid}/boxscore", cache_key=f"box_{gid}")
    if not bx:
        return [], False
    pbg = bx.get("playerByGameStats") or {}
    if not pbg:
        return [], False
    home_ab = (bx.get("homeTeam") or {}).get("abbrev")
    away_ab = (bx.get("awayTeam") or {}).get("abbrev")
    home_id = (bx.get("homeTeam") or {}).get("id")
    away_id = (bx.get("awayTeam") or {}).get("id")
    date_s = bx.get("gameDate") or meta.get("gameDate")
    season = meta.get("season") or bx.get("season")

    # Only reach for the play-by-play when a side actually needs disambiguating.
    needs_pbp = any(len([g for g in (pbg.get(s) or {}).get("goalies", []) if _sec(g.get("toi")) > 0]) > 1
                    for s in ("homeTeam", "awayTeam"))
    first_in_net = starters_from_pbp(gid) if needs_pbp else {}

    rows, resolved = [], True
    for side in ("homeTeam", "awayTeam"):
        gl = (pbg.get(side) or {}).get("goalies", []) or []
        if not gl:
            continue
        team = home_ab if side == "homeTeam" else away_ab
        opp = away_ab if side == "homeTeam" else home_ab
        tid = home_id if side == "homeTeam" else away_id
        played = [g for g in gl if _sec(g.get("toi")) > 0]
        if len(played) == 1:
            starter_id = played[0].get("playerId")
        elif len(played) > 1:
            starter_id = first_in_net.get(tid)
            if starter_id is None:
                # Unresolvable rather than guessed. A guessed starter is worse than a missing one:
                # it is indistinguishable from a real one downstream.
                resolved = False
                continue
        else:
            continue
        rd, b2b = rest.get((team, gid), (None, 0))
        for g in gl:
            toi = _sec(g.get("toi"))
            if toi <= 0 and g.get("playerId") != starter_id:
                continue   # dressed but never played and not the starter — not a row worth keeping
            sa = g.get("shotsAgainst")
            sv = g.get("saves")
            if sv is None and sa is not None and g.get("goalsAgainst") is not None:
                sv = sa - g["goalsAgainst"]
            rows.append((
                int(gid), int(season) if season else None, date_s,
                meta.get("startTimeUTC"), team, opp, 1 if side == "homeTeam" else 0,
                int(g.get("playerId")), (g.get("name") or {}).get("default"),
                1 if g.get("playerId") == starter_id else 0,
                toi, sa, sv, g.get("goalsAgainst"),
                float(g["savePctg"]) if g.get("savePctg") is not None else None,
                g.get("decision"), rd, b2b,
            ))
    return rows, resolved


COLS = ("game_id", "season", "game_date", "start_utc", "team", "opponent", "is_home",
        "goalie_id", "goalie_name", "is_starter", "toi_seconds", "shots_against", "saves",
        "goals_against", "save_pct", "decision", "rest_days", "is_back_to_back")


def write_sqlite(rows):
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.executescript(SCHEMA)
    conn.executemany(
        f"INSERT OR REPLACE INTO nhl_goalie_starts ({','.join(COLS)}) "
        f"VALUES ({','.join('?' * len(COLS))})", rows)
    conn.commit()
    n = conn.total_changes
    conn.close()
    return n


def write_supabase(rows):
    env = oc.load_env()
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise SystemExit("--supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY in .env")
    payload = [dict(zip(COLS, r)) for r in rows]
    endpoint = url.rstrip("/") + "/rest/v1/nhl_goalie_starts"
    sent = 0
    for i in range(0, len(payload), 500):
        chunk = payload[i:i + 500]
        req = urllib.request.Request(
            endpoint, data=json.dumps(chunk).encode("utf-8"),
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Content-Type": "application/json",
                     "Prefer": "return=minimal,resolution=merge-duplicates"},
            method="POST")
        with urllib.request.urlopen(req, timeout=90) as r:
            if r.getcode() not in (200, 201, 204):
                raise SystemExit(f"Supabase write failed: {r.getcode()}")
        sent += len(chunk)
    return sent


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", nargs="+", default=["20262027"],
                    help="NHL season ids, e.g. 20262027 20252026")
    ap.add_argument("--limit", type=int, default=0, help="stop after N games (smoke tests)")
    ap.add_argument("--supabase", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    all_rows, unresolved = [], 0
    for season in args.season:
        games, sched = season_games(season)
        rest = rest_map(sched)
        ids = sorted(games)
        if args.limit:
            ids = ids[:args.limit]
        print(f"{season}: {len(ids)} completed regular-season games")
        for i, gid in enumerate(ids, 1):
            rows, ok = game_rows(gid, games[gid], rest)
            if not ok:
                unresolved += 1
            all_rows += rows
            if i % 100 == 0 or i == len(ids):
                print(f"  {i}/{len(ids)}  rows={len(all_rows)}")

    starters = sum(1 for r in all_rows if r[9] == 1)
    print(f"\n{len(all_rows)} goalie rows, {starters} of them starters "
          f"({unresolved} game-side(s) left unresolved rather than guessed)")
    if args.dry_run:
        print("DRY RUN — nothing written.")
        for r in all_rows[:4]:
            print("   ", dict(zip(COLS, r)))
        return 0
    if not all_rows:
        print("nothing to write")
        return 0
    n = write_supabase(all_rows) if args.supabase else write_sqlite(all_rows)
    print(f"wrote {n} rows to {'Supabase nhl_goalie_starts' if args.supabase else DB}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
