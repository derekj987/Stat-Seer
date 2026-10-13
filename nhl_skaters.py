"""
nhl_skaters.py -- per-skater game logs from the boxscores nhl_goalies.py already cached.

    python nhl_skaters.py --dry-run
    python nhl_skaters.py                 # data/nhl.db :: nhl_skater_games

This costs NOTHING to run: nhl_goalies.py cached every boxscore it fetched under data/nhl_cache/,
and a boxscore carries the skaters as well as the goalies. 6,646 games are already on disk, so the
whole shot-volume history is a re-parse rather than a crawl. Any game not in the cache is fetched.

WHY SHOTS ON GOAL AND TIME ON ICE, specifically. The project's oldest finding is that VOLUME
persists and EFFICIENCY does not -- carries 0.678 and target share 0.623 against yards-per-carry
0.058 and receiving TDs 0.093. Hockey's analogue is exact: shots on goal are volume, goals are
shots times a shooting percentage. `sog` and `toi` are the two columns a shots-prop projection is
built from; goals and points come along because they are what the other props settle on, but they
are not expected to persist and nothing should be projected from them directly.

Preseason is excluded, like the goalie table, because ice time there is assigned rather than earned.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "analysis"))

CACHE = os.path.join(ROOT, "data", "nhl_cache")
DB = os.path.join(ROOT, "data", "nhl.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS nhl_skater_games (
  game_id     INTEGER NOT NULL,
  season      INTEGER,
  game_date   TEXT,
  team        TEXT NOT NULL,
  opponent    TEXT,
  is_home     INTEGER,
  player_id   INTEGER NOT NULL,
  player_name TEXT,
  position    TEXT,
  toi_seconds INTEGER,
  sog         INTEGER,
  goals       INTEGER,
  assists     INTEGER,
  points      INTEGER,
  blocked     INTEGER,
  hits        INTEGER,
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS ix_nhls_player ON nhl_skater_games(player_id, game_date);
CREATE INDEX IF NOT EXISTS ix_nhls_team   ON nhl_skater_games(team, game_date);
"""

COLS = ("game_id", "season", "game_date", "team", "opponent", "is_home", "player_id",
        "player_name", "position", "toi_seconds", "sog", "goals", "assists", "points",
        "blocked", "hits")


def _sec(t):
    try:
        m, s = str(t).split(":")
        return int(m) * 60 + int(s)
    except Exception:  # noqa: BLE001
        return 0


def rows_from_box(d):
    gid = d.get("id")
    pbg = d.get("playerByGameStats") or {}
    if not gid or not pbg:
        return []
    home = (d.get("homeTeam") or {}).get("abbrev")
    away = (d.get("awayTeam") or {}).get("abbrev")
    date_s = d.get("gameDate")
    season = d.get("season")
    out = []
    for side in ("homeTeam", "awayTeam"):
        team = home if side == "homeTeam" else away
        opp = away if side == "homeTeam" else home
        blk = pbg.get(side) or {}
        # The NHL has called this group both "defense" and "defensemen" across seasons; take
        # whichever is present rather than assuming, or a season silently loses its blue line.
        for grp in ("forwards", "defense", "defensemen"):
            for p in blk.get(grp) or []:
                out.append((
                    int(gid), int(season) if season else None, date_s, team, opp,
                    1 if side == "homeTeam" else 0,
                    int(p.get("playerId")), (p.get("name") or {}).get("default"),
                    p.get("position"), _sec(p.get("toi")),
                    p.get("sog"), p.get("goals"), p.get("assists"), p.get("points"),
                    p.get("blockedShots"), p.get("hits"),
                ))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    files = sorted(glob.glob(os.path.join(CACHE, "box_*.json")))
    print(f"{len(files)} cached boxscores")
    rows, games, skipped = [], 0, 0
    for f in files:
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            skipped += 1
            continue
        # gameType 2 only — the goalie table already excludes preseason and these must match, or a
        # join across the two tables silently covers different populations.
        if d.get("gameType") != 2:
            continue
        r = rows_from_box(d)
        if r:
            rows += r
            games += 1
    print(f"{games} regular-season games -> {len(rows)} skater rows "
          f"({skipped} unreadable cache files)")
    if args.dry_run:
        for r in rows[:3]:
            print("   ", dict(zip(COLS, r)))
        print("DRY RUN — nothing written.")
        return 0
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.executescript(SCHEMA)
    conn.executemany(f"INSERT OR REPLACE INTO nhl_skater_games ({','.join(COLS)}) "
                     f"VALUES ({','.join('?' * len(COLS))})", rows)
    conn.commit()
    conn.close()
    print(f"wrote {len(rows)} rows to {DB}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
