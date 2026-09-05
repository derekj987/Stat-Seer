"""
cfb_depth_capture.py -- record a weekly snapshot of the NCAAF depth chart.

College football has no injury report (EMPIRICAL_REFERENCE 9e), so the only availability-shaped
signal this project can build is a CHANGE HISTORY of the scraped depth chart: a starter who drops
off or down the chart between weeks probably had something happen to him.

That history only exists if it is recorded as it happens. Today's cfb_depth.json says nothing about
who was listed last week, and no later effort reconstructs it — the same reason the practice
trajectory in CLAUDE.md has a hard season-opener deadline. This script is the recording step. It
models nothing, and nothing should be modelled on it until there are enough weeks to validate.

    python cfb_depth_capture.py                 # dry run — show what would be written
    python cfb_depth_capture.py --write         # capture this week
    python cfb_depth_capture.py --backfill-git --write   # seed from committed cfb_depth.json history

Auth: SUPABASE_URL / SUPABASE_SERVICE_KEY in .env. Requires ingest/cfb_depth_snapshots.sql.
"""
import argparse
import json
import os
import re
import subprocess
import sqlite3
import sys
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone

import odds_client as oc

HERE = os.path.dirname(os.path.abspath(__file__))
DEPTH_JSON = os.path.join(HERE, "cfb_depth.json")
DB = os.path.join(HERE, "data", "cfb.db")
CUR_SEASON = 2026
TABLE = "cfb_depth_snapshots"
# Only the positions the player model actually uses. Capturing the offensive line as well would
# roughly double the row count for data nothing downstream reads.
POSITIONS = ("QB", "RB", "WR", "TE", "FB")


def norm(name):
    """Same key as cfb_player_proj.norm, so snapshots join to projections without a second rule."""
    a = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z]", "", a.lower())


def current_week(default=1, at=None):
    """The week the slate upcoming AS OF `at` belongs to — the same rule the board uses.

    Parameterised by time so a backfilled snapshot is filed under the week it was actually taken
    in, not the week it happens to be imported in.

    Falls back to `default` rather than failing: a snapshot filed under a slightly wrong week is
    far better than no snapshot, because the missing week can never be recovered."""
    try:
        c = sqlite3.connect(DB)
        when = at or datetime.now(timezone.utc).isoformat()
        row = c.execute(
            "select week from games where season=? and season_type='regular' and start_date > ?"
            " order by start_date limit 1", (CUR_SEASON, when)).fetchone()
        c.close()
        if row:
            return int(row[0])
    except Exception:                            # noqa: BLE001 — never block a capture on this
        pass
    return default


def rows_from(depth, season, week, snapshot_at):
    out = []
    for team, groups in (depth or {}).items():
        for pos, names in (groups or {}).items():
            if pos not in POSITIONS:
                continue
            for i, player in enumerate(names or [], start=1):
                if not player:
                    continue
                out.append({"snapshot_at": snapshot_at, "snapshot_day": snapshot_at[:10],
                        "season": season, "week": week,
                            "team": team, "pos": pos, "rank": i,
                            "player": player, "player_norm": norm(player), "source": "ourlads"})
    return out


def write(rows, env):
    """Upsert on the natural key, so a retried workflow cannot inflate the history."""
    url, key = env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_KEY"]
    endpoint = (f"{url}/rest/v1/{TABLE}"
                "?on_conflict=snapshot_day,team,pos,rank,source")
    sent = 0
    for i in range(0, len(rows), 500):          # chunked: one 2.5k-row body can time out
        chunk = rows[i:i + 500]
        req = urllib.request.Request(
            endpoint, data=json.dumps(chunk).encode("utf-8"),
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Content-Type": "application/json",
                     "Prefer": "resolution=merge-duplicates,return=minimal"},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                if r.getcode() in (200, 201, 204):
                    sent += len(chunk)
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:300]
            if e.code == 404 or "does not exist" in body:
                print("\nTable missing — run ingest/cfb_depth_snapshots.sql first.", file=sys.stderr)
                return -1
            print(f"\nWRITE FAILED {e.code}: {body}", file=sys.stderr)
            return -1
    return sent


def git_history():
    """Every committed version of cfb_depth.json, oldest first.

    The daily refresh workflow has been committing this file for a while, so a real change-history
    already exists in git — just in a form nothing can query. Seeding from it means the clock
    started when that workflow did rather than today."""
    try:
        out = subprocess.run(["git", "log", "--format=%H %cI", "--follow", "--", "cfb_depth.json"],
                             cwd=HERE, capture_output=True, text=True, timeout=60)
        commits = [l.split(None, 1) for l in out.stdout.strip().splitlines() if l.strip()]
    except Exception as e:                       # noqa: BLE001
        print(f"  git history unavailable ({e})")
        return []
    seen, versions = set(), []
    for sha, when in reversed(commits):          # oldest first
        try:
            blob = subprocess.run(["git", "show", f"{sha}:cfb_depth.json"],
                                  cwd=HERE, capture_output=True, text=True, timeout=60).stdout
            d = json.loads(blob)
        except Exception:                        # noqa: BLE001 — a commit may predate the file
            continue
        fp = hash(json.dumps(d, sort_keys=True))
        if fp in seen:                           # identical to the previous version — no new info
            continue
        seen.add(fp)
        versions.append((when, d))
    return versions


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, default=CUR_SEASON)
    ap.add_argument("--week", type=int, default=None, help="default: the upcoming week")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--backfill-git", action="store_true",
                    help="also seed from every committed version of cfb_depth.json")
    args = ap.parse_args(argv)

    env = oc.load_env()
    if not env.get("SUPABASE_URL") or not env.get("SUPABASE_SERVICE_KEY"):
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env", file=sys.stderr)
        return 1

    batches = []
    if args.backfill_git:
        vers = git_history()
        print(f"git history: {len(vers)} distinct committed versions of cfb_depth.json")
        for when, d in vers:
            # Week derived from the COMMIT date, so a backfilled snapshot lands on the week it was
            # actually taken rather than the week it is being imported in.
            wk = args.week if args.week is not None else current_week(at=when)
            batches.append((when, d, wk))

    if not os.path.exists(DEPTH_JSON):
        print(f"ERROR: {DEPTH_JSON} not found — run cfb_depth.py first", file=sys.stderr)
        return 1
    with open(DEPTH_JSON, encoding="utf-8") as f:
        depth = json.load(f)
    now = datetime.now(timezone.utc).isoformat()
    week = args.week if args.week is not None else current_week()
    batches.append((now, depth, week))

    total = 0
    for when, d, wk in batches:
        rows = rows_from(d, args.season, wk, when)
        total += len(rows)
        teams = len({r["team"] for r in rows})
        print(f"  {when[:19]}  season {args.season} week {wk}: {len(rows)} rows across {teams} teams")
        if args.write:
            n = write(rows, env)
            if n < 0:
                return 1
            print(f"      wrote {n}")
    if not args.write:
        print(f"\nDRY RUN — {total} rows would be written. Add --write.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
