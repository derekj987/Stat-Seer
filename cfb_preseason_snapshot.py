"""
cfb_preseason_snapshot.py -- freeze this season's PRESEASON forward-looking priors
(CFBD SP+ ratings + returning production) into a durable, timestamped record, so a
year from now they can be tested OUT OF SAMPLE as a preseason prior for the CFB card.

WHY this exists (the whole point): CFBD's /ratings/sp?year=Y archives only each PAST
season's FINAL SP+, and it starts updating in-season the moment games are played. So the
*preseason* value -- the one that prices transfers / recruiting / returning starters
before any results exist -- lives ONLY if it is captured on the day, before Week 1. It
cannot be backfilled, exactly like practice trajectory and prop history. The SP+ seed
already ships on the forward card (cfb_export.fetch_preseason_sp), but it was never
frozen, so its preseason ordering could never be graded. This closes that gap.

Bonus: run daily through the early season and the same rows capture the SP+ *convergence
trajectory* -- how fast the preseason number is overtaken by results -- which is the
empirical test of the "SP+ seed washes out by ~week 5-6" claim in cfb_export.

    python cfb_preseason_snapshot.py --dry-run              # fetch + print, write nothing
    python cfb_preseason_snapshot.py                        # local SQLite (data/cfb.db)
    python cfb_preseason_snapshot.py --supabase             # durable Supabase (scheduled/CI)

Storage: one row per (snapshot_date, season, team). SQLite by default; --supabase appends
to the Supabase table cfb_preseason_snapshots (durable across ephemeral CI runners -- a
SQLite file on a GitHub runner is discarded when the job ends). Dedup on
(snapshot_date, season, team), so re-running the same day is idempotent while a new day
appends a fresh snapshot.

Auth: CFBD_API_KEY (+ SUPABASE_URL / SUPABASE_SERVICE_KEY for --supabase) in .env.
Stdlib + cfbd_client + odds_client (env + TLS). CFBD is free/patreon and this is 2 calls
per run, so the cost is negligible -- daily is fine.
"""
import argparse
import datetime as _dt
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request

import cfbd_client as cc
import odds_client as oc


class TransientError(Exception):
    """Network blip / upstream 5xx -> skip the run cleanly (exit 0) rather than fail.
    A genuine problem (bad key, or a Supabase 4xx = schema/permission) still exits non-zero
    so it surfaces -- same contract as cfb_props.py."""


# One column order shared by the SQLite tuple insert and the Supabase dict rows.
COLS = [
    "snapshot_at", "snapshot_date", "season", "team", "conference",
    "sp_rating", "sp_ranking", "sp_offense", "sp_defense", "sp_special_teams",
    "sp_sos", "sp_second_order_wins",
    "ret_total_ppa", "ret_percent_ppa", "ret_usage",
    "ret_passing_usage", "ret_receiving_usage", "ret_rushing_usage",
    "ret_percent_passing_ppa", "ret_percent_receiving_ppa", "ret_percent_rushing_ppa",
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS cfb_preseason_snapshots (
  snapshot_at            TEXT NOT NULL,
  snapshot_date          TEXT NOT NULL,
  season                 INTEGER NOT NULL,
  team                   TEXT NOT NULL,
  conference             TEXT,
  sp_rating              REAL,
  sp_ranking             INTEGER,
  sp_offense             REAL,
  sp_defense             REAL,
  sp_special_teams       REAL,
  sp_sos                 REAL,
  sp_second_order_wins   REAL,
  ret_total_ppa          REAL,
  ret_percent_ppa        REAL,
  ret_usage              REAL,
  ret_passing_usage      REAL,
  ret_receiving_usage    REAL,
  ret_rushing_usage      REAL,
  ret_percent_passing_ppa   REAL,
  ret_percent_receiving_ppa REAL,
  ret_percent_rushing_ppa   REAL,
  PRIMARY KEY (snapshot_date, season, team)
);
CREATE INDEX IF NOT EXISTS ix_cfbpre_season ON cfb_preseason_snapshots(season, team);
"""


def _sub(d, key):
    """A nested SP+ sub-rating (offense/defense/specialTeams) -> its .rating float or None."""
    v = d.get(key)
    if isinstance(v, dict):
        r = v.get("rating")
        return float(r) if r is not None else None
    return None


def fetch_sp(season, key):
    """Preseason SP+ -> {team: {...}}. Raises on a genuine failure; TransientError on 5xx."""
    st, data = cc.cfbd_get("/ratings/sp", {"year": season}, key)
    if st != 200 or not isinstance(data, list):
        if st == 0 or (isinstance(st, int) and 500 <= st < 600):
            raise TransientError(f"SP+ HTTP {st}")
        raise RuntimeError(f"SP+ HTTP {st}: {str(data)[:200]}")
    out = {}
    for d in data:
        t = d.get("team")
        if not t or t == "nationalAverages":
            continue
        out[t] = {
            "conference": d.get("conference"),
            "sp_rating": _f(d.get("rating")),
            "sp_ranking": d.get("ranking"),
            "sp_offense": _sub(d, "offense"),
            "sp_defense": _sub(d, "defense"),
            "sp_special_teams": _sub(d, "specialTeams"),
            "sp_sos": _f(d.get("sos")),
            "sp_second_order_wins": _f(d.get("secondOrderWins")),
        }
    return out


def fetch_returning(season, key):
    """Returning production -> {team: {...}}. Same error contract as fetch_sp."""
    st, data = cc.cfbd_get("/player/returning", {"year": season}, key)
    if st != 200 or not isinstance(data, list):
        if st == 0 or (isinstance(st, int) and 500 <= st < 600):
            raise TransientError(f"returning HTTP {st}")
        raise RuntimeError(f"returning HTTP {st}: {str(data)[:200]}")
    out = {}
    for d in data:
        t = d.get("team")
        if not t:
            continue
        out[t] = {
            "ret_total_ppa": _f(d.get("totalPPA")),
            "ret_percent_ppa": _f(d.get("percentPPA")),
            "ret_usage": _f(d.get("usage")),
            "ret_passing_usage": _f(d.get("passingUsage")),
            "ret_receiving_usage": _f(d.get("receivingUsage")),
            "ret_rushing_usage": _f(d.get("rushingUsage")),
            "ret_percent_passing_ppa": _f(d.get("percentPassingPPA")),
            "ret_percent_receiving_ppa": _f(d.get("percentReceivingPPA")),
            "ret_percent_rushing_ppa": _f(d.get("percentRushingPPA")),
        }
    return out


def _f(v):
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def build_rows(sp, ret, snapshot_at, snapshot_date, season):
    """One row per team present in SP+ (the rating we actually seed the card with),
    left-joined to returning production. A team SP+ covers but returning production
    doesn't simply gets null ret_* -- the SP+ prior is still worth freezing."""
    rows = []
    for team, s in sp.items():
        r = ret.get(team, {})
        rec = {"snapshot_at": snapshot_at, "snapshot_date": snapshot_date,
               "season": season, "team": team, "conference": s.get("conference")}
        for k in COLS:
            if k in rec:
                continue
            rec[k] = s.get(k, r.get(k))
        rows.append(tuple(rec[k] for k in COLS))
    return rows


def write_supabase(rows, env, batch=500):
    """Append rows to Supabase cfb_preseason_snapshots (durable, unlike an ephemeral CI
    SQLite file). Idempotent upsert on (snapshot_date,season,team). Transient 5xx/network
    -> TransientError (skip); a 4xx (schema/permission) raises so a real problem surfaces.
    Mirrors cfb_props.write_supabase."""
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY missing (needed for --supabase)")
    endpoint = (url.rstrip("/") + "/rest/v1/cfb_preseason_snapshots"
                "?on_conflict=snapshot_date,season,team")
    headers = {"apikey": key, "Authorization": f"Bearer {key}",
               "Content-Type": "application/json",
               "Prefer": "return=minimal,resolution=ignore-duplicates"}
    dict_rows = [dict(zip(COLS, r)) for r in rows]
    written = 0
    for i in range(0, len(dict_rows), batch):
        chunk = dict_rows[i:i + batch]
        req = urllib.request.Request(endpoint, data=json.dumps(chunk).encode("utf-8"),
                                     headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.getcode() in (200, 201, 204):
                    written += len(chunk)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            print(f"  ! preseason batch {i // batch}: HTTP {e.code} {detail}", file=sys.stderr)
            if e.code < 500:
                raise   # 4xx = genuine schema/permission problem
            raise TransientError(f"Supabase write HTTP {e.code} (transient)")
        except urllib.error.URLError as e:
            raise TransientError(f"Supabase write network error ({e.reason})")
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="data/cfb.db")
    ap.add_argument("--season", type=int, default=None,
                    help="season year (default: current calendar year)")
    ap.add_argument("--dry-run", action="store_true", help="fetch + report, write nothing")
    ap.add_argument("--supabase", action="store_true",
                    help="write to the Supabase cfb_preseason_snapshots table instead of "
                         "SQLite (use this for scheduled/CI runs -- a runner's SQLite is ephemeral)")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    env = oc.load_env()
    key = env.get("CFBD_API_KEY")
    if not key:
        print("ERROR: CFBD_API_KEY missing in .env", file=sys.stderr)
        return 1

    now = _dt.datetime.now(_dt.timezone.utc)
    snapshot_at = now.replace(microsecond=0).isoformat()
    snapshot_date = now.date().isoformat()
    season = args.season or now.year

    try:
        sp = fetch_sp(season, key)
        ret = fetch_returning(season, key)
    except TransientError as e:
        print(f"transient: {e}; skipping this run (no failure)", file=sys.stderr)
        return 0

    if not sp:
        print(f"No preseason SP+ for {season} yet (endpoint returned an empty list). "
              f"SP+ posts in the offseason; nothing to freeze.", file=sys.stderr)
        return 0

    rows = build_rows(sp, ret, snapshot_at, snapshot_date, season)
    with_ret = sum(1 for r in rows if r[COLS.index("ret_total_ppa")] is not None)
    print(f"[{snapshot_at}] {season}: {len(sp)} teams with preseason SP+, "
          f"{len(ret)} with returning production; {with_ret}/{len(rows)} rows have both.")

    # Sanity print: the SP+ top 5 (proves the fetch is the forward-looking ordering).
    top = sorted(sp.items(), key=lambda kv: -(kv[1]["sp_rating"] or -99))[:5]
    print("  SP+ top 5: " + ", ".join(f"{t} {v['sp_rating']:.1f}" for t, v in top))

    if args.dry_run:
        print(f"  (dry-run) {len(rows)} rows NOT written.")
        return 0

    if args.supabase:
        try:
            n = write_supabase(rows, env)
            print(f"  stored to Supabase ({n} rows) for snapshot_date {snapshot_date}.")
        except TransientError as e:
            print(f"transient: {e}; skipping write this run (no failure)", file=sys.stderr)
            return 0
    else:
        os.makedirs(os.path.dirname(os.path.abspath(args.db)), exist_ok=True)
        conn = sqlite3.connect(args.db)
        conn.executescript(SCHEMA)
        conn.executemany(
            "INSERT OR REPLACE INTO cfb_preseason_snapshots VALUES "
            "(" + ",".join("?" * len(COLS)) + ")", rows)
        conn.commit()
        conn.close()
        print(f"  stored to {args.db} ({len(rows)} rows) for snapshot_date {snapshot_date}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
