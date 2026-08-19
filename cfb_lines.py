"""
cfb_lines.py -- pull historical CFB betting lines from the CFBD /lines endpoint into
data/cfb.db, so the power rating can be tested against the ONLY bar that matters: the
closing spread. Without this, "we match Elo" is just trivia -- Elo doesn't beat the
market either.

Stores one row per (game, provider). The rating backtest (cfb_ats.py) builds a
per-game consensus by averaging the providers. `spread` is the CFBD convention: the
HOME team's number, negative = home favored (e.g. "Auburn -2" at home => spread -2).

    python cfb_lines.py                 # 2020-2024, regular + postseason
    python cfb_lines.py --start 2021 --end 2024

Auth: CFBD_API_KEY in .env. Stdlib + cfbd_client. Cheap: ~2 calls per season.
"""
import argparse
import os
import sqlite3
import sys

import cfbd_client as cc
import odds_client as oc

SCHEMA = """
CREATE TABLE IF NOT EXISTS lines (
  game_id     INTEGER NOT NULL,
  provider    TEXT NOT NULL,
  spread      REAL,
  spread_open REAL,
  over_under  REAL,
  home_ml     INTEGER,
  away_ml     INTEGER,
  PRIMARY KEY (game_id, provider)
);
CREATE INDEX IF NOT EXISTS ix_lines_game ON lines(game_id);
"""


def fetch_lines(api_key, year, season_type):
    return cc.cfbd_get("/lines", {"year": year, "seasonType": season_type}, api_key)


def rows_for(game):
    gid = cc._g(game, "id")
    out = []
    for ln in (game.get("lines") or []):
        out.append((
            gid,
            ln.get("provider"),
            ln.get("spread"),
            ln.get("spreadOpen"),
            ln.get("overUnder"),
            ln.get("homeMoneyline"),
            ln.get("awayMoneyline"),
        ))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", type=int, default=2020)
    ap.add_argument("--end", type=int, default=2024)
    ap.add_argument("--db", default="data/cfb.db")
    args = ap.parse_args(argv)

    env = oc.load_env()
    api_key = env.get("CFBD_API_KEY")
    if not api_key:
        print("ERROR: CFBD_API_KEY missing in .env", file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(os.path.abspath(args.db)), exist_ok=True)
    conn = sqlite3.connect(args.db)
    conn.executescript(SCHEMA)

    total = 0
    for year in range(args.start, args.end + 1):
        year_rows = 0
        for stype in ("regular", "postseason"):
            status, data = fetch_lines(api_key, year, stype)
            if status != 200 or not isinstance(data, list):
                print(f"  {year} {stype}: CFBD HTTP {status} -- {str(data)[:160]}", file=sys.stderr)
                continue
            batch = [r for g in data for r in rows_for(g) if r[1]]  # provider present
            conn.executemany(
                "INSERT OR REPLACE INTO lines "
                "(game_id,provider,spread,spread_open,over_under,home_ml,away_ml) "
                "VALUES (?,?,?,?,?,?,?)", batch)
            year_rows += len(batch)
        conn.commit()
        total += year_rows
        print(f"  {year}: {year_rows} provider lines")

    n_games = conn.execute("SELECT COUNT(DISTINCT game_id) FROM lines").fetchone()[0]
    # how many FBS-vs-FBS games now have at least one spread
    covered = conn.execute("""
        SELECT COUNT(*) FROM games g
        WHERE g.home_class='fbs' AND g.away_class='fbs' AND g.home_points IS NOT NULL
          AND EXISTS (SELECT 1 FROM lines l WHERE l.game_id=g.id AND l.spread IS NOT NULL)
    """).fetchone()[0]
    fbs_total = conn.execute("""
        SELECT COUNT(*) FROM games
        WHERE home_class='fbs' AND away_class='fbs' AND home_points IS NOT NULL
    """).fetchone()[0]
    conn.close()

    print(f"\nLines stored -> {args.db}: {total} provider rows across {n_games} games.")
    print(f"  {covered}/{fbs_total} completed FBS-vs-FBS games have a spread "
          f"({100.0*covered/fbs_total:.1f}% coverage).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
