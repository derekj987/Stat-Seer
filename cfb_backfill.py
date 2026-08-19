"""
cfb_backfill.py -- pull five seasons of College Football games from the CFBD API and
land them in a local SQLite store (cfb.db) that the CFB power-rating model reads.

Why store, not recompute on the fly: the model iterates (fit -> score vs the closing
line -> refit), and re-pulling thousands of games each pass burns API credits for no
reason. One backfill, many model runs. Re-running is safe -- games upsert by id, so a
finished season is stable and a current season refreshes its scores.

    python cfb_backfill.py                 # default: 2020-2024, regular + postseason
    python cfb_backfill.py --start 2019 --end 2024
    python cfb_backfill.py --db cfb.db      # override the default data/cfb.db

Captures every game the API returns (all divisions), tagging each side's
classification so the model can scope to FBS (and FBS-vs-FCS guarantee games) itself.
CFBD's own pre/postgame Elo is stored too -- a ready-made benchmark for our rating.

Auth: CFBD_API_KEY in .env (same key cfbd_client.py uses).
Stdlib only (sqlite3 + cfbd_client for the fetch).
"""
import argparse
import os
import sqlite3
import sys

import cfbd_client as cc
import odds_client as oc

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
  id               INTEGER PRIMARY KEY,
  season           INTEGER NOT NULL,
  week             INTEGER,
  season_type      TEXT,
  start_date       TEXT,
  completed        INTEGER,
  neutral_site     INTEGER,
  conference_game  INTEGER,
  home_id          INTEGER,
  home_team        TEXT,
  home_class       TEXT,
  home_conf        TEXT,
  home_points      INTEGER,
  away_id          INTEGER,
  away_team        TEXT,
  away_class       TEXT,
  away_conf        TEXT,
  away_points      INTEGER,
  home_pregame_elo  INTEGER,
  home_postgame_elo INTEGER,
  away_pregame_elo  INTEGER,
  away_postgame_elo INTEGER
);
CREATE INDEX IF NOT EXISTS ix_games_season ON games(season, week);
CREATE INDEX IF NOT EXISTS ix_games_class  ON games(home_class, away_class);
"""

COLS = [
    "id", "season", "week", "season_type", "start_date", "completed",
    "neutral_site", "conference_game",
    "home_id", "home_team", "home_class", "home_conf", "home_points",
    "away_id", "away_team", "away_class", "away_conf", "away_points",
    "home_pregame_elo", "home_postgame_elo", "away_pregame_elo", "away_postgame_elo",
]


def _bool(v):
    return None if v is None else (1 if v else 0)


def row_of(g):
    """Map one CFBD game object to our column tuple (handles v2 camelCase)."""
    g_ = cc._g
    return (
        g_(g, "id"),
        g_(g, "season"),
        g_(g, "week"),
        g_(g, "seasonType", "season_type"),
        g_(g, "startDate", "start_date"),
        _bool(g_(g, "completed")),
        _bool(g_(g, "neutralSite", "neutral_site")),
        _bool(g_(g, "conferenceGame", "conference_game")),
        g_(g, "homeId", "home_id"),
        g_(g, "homeTeam", "home_team"),
        g_(g, "homeClassification", "home_classification"),
        g_(g, "homeConference", "home_conference"),
        g_(g, "homePoints", "home_points"),
        g_(g, "awayId", "away_id"),
        g_(g, "awayTeam", "away_team"),
        g_(g, "awayClassification", "away_classification"),
        g_(g, "awayConference", "away_conference"),
        g_(g, "awayPoints", "away_points"),
        g_(g, "homePregameElo", "home_pregame_elo"),
        g_(g, "homePostgameElo", "home_postgame_elo"),
        g_(g, "awayPregameElo", "away_pregame_elo"),
        g_(g, "awayPostgameElo", "away_postgame_elo"),
    )


def upsert(conn, games):
    placeholders = ",".join("?" * len(COLS))
    conn.executemany(
        f"INSERT OR REPLACE INTO games ({','.join(COLS)}) VALUES ({placeholders})",
        [row_of(g) for g in games],
    )


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", type=int, default=2020, help="first season (inclusive)")
    ap.add_argument("--end", type=int, default=2024, help="last season (inclusive)")
    ap.add_argument("--db", default="data/cfb.db",
                    help="SQLite path (default: data/cfb.db -- gitignored)")
    args = ap.parse_args(argv)

    env = oc.load_env()
    api_key = env.get("CFBD_API_KEY")
    if not api_key:
        print("ERROR: CFBD_API_KEY missing in .env -- get one at "
              "https://collegefootballdata.com/key", file=sys.stderr)
        return 1

    db_dir = os.path.dirname(os.path.abspath(args.db))
    os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(args.db)
    conn.executescript(SCHEMA)

    grand_total = 0
    for year in range(args.start, args.end + 1):
        status, games = cc.fetch_games(api_key, year, "both")
        if status != 200 or not isinstance(games, list):
            print(f"  {year}: CFBD HTTP {status} -- {str(games)[:200]}", file=sys.stderr)
            conn.rollback()
            return 1
        upsert(conn, games)
        conn.commit()
        fbs = sum(1 for g in games
                  if cc._g(g, "homeClassification") == "fbs"
                  or cc._g(g, "awayClassification") == "fbs")
        played = sum(1 for g in games if cc._g(g, "homePoints", "home_points") is not None)
        grand_total += len(games)
        print(f"  {year}: {len(games):4d} games  ({fbs} FBS-involving, {played} with a final)")

    total_rows = conn.execute("SELECT COUNT(*) FROM games").fetchone()[0]
    fbs_rows = conn.execute(
        "SELECT COUNT(*) FROM games WHERE home_class='fbs' OR away_class='fbs'").fetchone()[0]
    fbs_vs_fbs = conn.execute(
        "SELECT COUNT(*) FROM games WHERE home_class='fbs' AND away_class='fbs'").fetchone()[0]
    conn.close()

    print(f"\nBackfill complete -> {args.db}")
    print(f"  {total_rows} games stored across {args.start}-{args.end} "
          f"({grand_total} fetched this run)")
    print(f"  {fbs_rows} involve an FBS team; {fbs_vs_fbs} are FBS-vs-FBS "
          f"(the core rating set).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
