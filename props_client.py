"""
props_client.py

Capture NFL player props from The Odds API into prop_snapshots.

Props are per-event on v4 (/events/{id}/odds), so: list events (free), then one
call per event for the prop markets. Cost = markets-with-data x regions per event,
so this is the priciest capture — run it game-week, not year-round.

    python props_client.py --fixture                       # parse a saved event body
    python props_client.py --live                          # capture, dry-run (no write)
    python props_client.py --live --write --reason SCHEDULED
    python props_client.py --live --write --commence-within 4320   # games <= 3 days out

Player identity is stored as the book posts it (player_name); gsis_id is left null
and resolved later. Reads keys/creds from .env (or env vars). Reuses odds_client.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

import odds_client as oc


class TransientError(Exception):
    """A network blip or upstream 5xx that should make the run skip cleanly
    (exit 0) rather than email a FAILURE. Genuine problems (bad key -> 401,
    quota -> 429, schema/permission 4xx) are NOT transient and still surface."""

BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl"
DEFAULT_MARKETS = (
    "player_pass_yds,player_pass_tds,player_pass_completions,player_pass_attempts,"
    "player_pass_interceptions,player_pass_longest_completion,"
    "player_rush_yds,player_rush_attempts,player_rush_longest,"
    "player_reception_yds,player_receptions,player_reception_longest,"
    "player_rush_reception_yds,player_pass_rush_reception_yds,player_pass_rush_reception_tds,"
    "player_anytime_td,player_1st_td,player_last_td,"
    "player_kicking_points,player_field_goals,player_pats,"
    "player_tackles_assists,player_sacks,player_solo_tackles,player_defensive_interceptions"
)
FIXTURE = os.path.join("fixtures", "props_event_raw.json")


def _get(url, tries=3):
    """GET with transient-retry. Returns (status, headers, body). A 5xx or a
    network error is retried with backoff; if it still fails, a network error
    surfaces as status 0 (callers treat 0 and 5xx as transient). 4xx bodies are
    returned as-is so the caller can tell a genuine 401/429 from a blip."""
    for attempt in range(tries):
        try:
            r = urllib.request.urlopen(
                urllib.request.Request(url, headers={"User-Agent": "statseer/1.0"}), timeout=60)
            return r.getcode(), r.headers, r.read()
        except urllib.error.HTTPError as e:
            if 500 <= e.code < 600 and attempt < tries - 1:
                time.sleep(2 * (attempt + 1)); continue
            return e.code, e.headers, e.read()
        except urllib.error.URLError as e:   # timeout / DNS / connection reset
            if attempt < tries - 1:
                time.sleep(2 * (attempt + 1)); continue
            return 0, {}, str(e).encode()
    return 0, {}, b"unreachable"


def fetch_events(key):
    status, hdr, body = _get(f"{BASE}/events?apiKey={key}")
    if status == 200:
        return json.loads(body)
    # 0 (network) or 5xx = transient -> skip the run, don't email.
    if status == 0 or 500 <= status <= 599:
        raise TransientError(f"events list HTTP {status} (transient)")
    raise RuntimeError(f"events HTTP {status}: {body[:200]!r}")  # 401/429 = genuine


def fetch_event_props(key, event_id, markets, regions):
    url = (f"{BASE}/events/{event_id}/odds?apiKey={key}&regions={regions}"
           f"&markets={markets}&oddsFormat=american")
    status, hdr, body = _get(url)
    credit = hdr.get("x-requests-last")
    data = json.loads(body) if status == 200 else body.decode("utf-8", "replace")
    return status, data, credit, hdr.get("x-requests-remaining")


def event_snapshot_at(event):
    stamps = [b.get("last_update") for b in event.get("bookmakers", []) if b.get("last_update")]
    return max(stamps) if stamps else None


def parse_event_props(event, snapshot_at, reason, week_map):
    """One /events/{id}/odds body -> (rows, skip_reason|None). Skips (with a reason)
    if the game's teams don't resolve to a season/week."""
    home = oc.TEAM_ABBR.get(event.get("home_team"))
    away = oc.TEAM_ABBR.get(event.get("away_team"))
    if not home or not away:
        return [], f"unmapped teams: {event.get('away_team')} @ {event.get('home_team')}"
    season = oc.derive_season(event["commence_time"])
    week = week_map.get((season, home, away))
    if week is None:
        return [], f"no {season} schedule row for {away}@{home}"

    rows = []
    for book in event.get("bookmakers", []):
        bkey = book.get("key")
        for market in book.get("markets", []):
            mkey = market.get("key")
            for oc_ in market.get("outcomes", []):
                name = oc_.get("name")           # Over / Under / Yes / No
                player = oc_.get("description")  # player name
                if not player or not name:
                    continue
                point = oc_.get("point")
                rows.append({
                    "snapshot_at": snapshot_at, "capture_reason": reason,
                    "season": season, "week": week, "event_id": event["id"],
                    "commence_time": event["commence_time"], "home_team": home,
                    "away_team": away, "book": bkey, "market": mkey,
                    "player_name": player, "gsis_id": None, "side": name,
                    "line": None if point is None else float(point),
                    "price_american": None if oc_.get("price") is None else int(oc_["price"]),
                })
    return rows, None


def write_props(rows, env, batch=500):
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY missing")
    # Name the dedupe index as the ON CONFLICT target — otherwise ignore-duplicates
    # only catches the primary key and unique-index dupes 409.
    endpoint = (url.rstrip("/") + "/rest/v1/prop_snapshots"
                "?on_conflict=snapshot_at,event_id,book,market,player_name,side,line")
    headers = {"apikey": key, "Authorization": f"Bearer {key}",
               "Content-Type": "application/json",
               "Prefer": "return=minimal,resolution=ignore-duplicates"}
    oc.ensure_ssl_certs()
    written = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        req = urllib.request.Request(endpoint, data=json.dumps(chunk).encode("utf-8"),
                                     headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.getcode() in (200, 201, 204):
                    written += len(chunk)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            print(f"  ! props batch {i // batch}: HTTP {e.code} {detail}", file=sys.stderr)
            if e.code < 500:
                raise   # 4xx = genuine schema/permission problem, owner must fix
            raise TransientError(f"Supabase write HTTP {e.code} (transient)")
        except urllib.error.URLError as e:
            raise TransientError(f"Supabase write network error ({e.reason})")
    return written


def within_window(commence_iso, minutes):
    now = datetime.now(timezone.utc)
    kickoff = datetime.fromisoformat(commence_iso.replace("Z", "+00:00"))
    return now <= kickoff <= now + timedelta(minutes=minutes)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--fixture", nargs="?", const=FIXTURE, metavar="PATH")
    src.add_argument("--live", action="store_true")
    ap.add_argument("--markets", default=DEFAULT_MARKETS)
    ap.add_argument("--regions", default="us,us2")
    ap.add_argument("--reason", default="MANUAL",
                    choices=["SCHEDULED", "PRE_KICKOFF", "BACKFILL", "MANUAL"])
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--commence-within", type=int, default=None, metavar="MIN",
                    help="only events kicking off within MIN minutes (cost control)")
    ap.add_argument("--max-events", type=int, default=None, help="cap events per run")
    args = ap.parse_args(argv)

    env = oc.load_env()
    week_map = oc.load_week_map()

    all_rows, skipped, total_credits, remaining = [], [], 0, None

    if args.fixture:
        with open(args.fixture, "r", encoding="utf-8") as fh:
            event = json.load(fh)
        rows, skip = parse_event_props(event, event_snapshot_at(event), args.reason, week_map)
        if skip:
            skipped.append(skip)
        all_rows += rows
        print(f"FIXTURE {args.fixture}  ->  {len(rows)} prop rows")
    else:
        key = env.get("ODDS_API_KEY")
        if not key:
            print("ERROR: ODDS_API_KEY missing", file=sys.stderr); return 1
        oc.ensure_ssl_certs()
        try:
            events = fetch_events(key)
        except TransientError as e:
            print(f"transient: {e}; skipping this run (no email)", file=sys.stderr)
            return 0
        # Never a game that has already kicked off. The events list keeps a game while it is in
        # play, and /events/{id}/odds then returns the books' LIVE props — which this capture wrote
        # as if they were pregame lines (Jalen Coker "130.5" receiving yards, captured three hours
        # into the Panthers game, published as the market). It also spent credits on games nobody
        # can bet pregame. And sort by kickoff BEFORE the cap, so the cap spends itself on the
        # nearest slate rather than on whatever order the feed returned.
        n_all = len(events)
        now = datetime.now(timezone.utc)
        events = [e for e in events
                  if datetime.fromisoformat(e["commence_time"].replace("Z", "+00:00")) > now]
        if n_all - len(events):
            print(f"  skipped {n_all - len(events)} event(s) already in play")
        if args.commence_within is not None:
            events = [e for e in events if within_window(e["commence_time"], args.commence_within)]
        events.sort(key=lambda e: e.get("commence_time") or "9999")
        if args.max_events:
            events = events[:args.max_events]
        print(f"LIVE  {len(events)} event(s) to query  markets={args.markets}")
        # ONE capture timestamp for the whole sweep, used whenever the API omits bookmaker
        # `last_update`. This used to fall back to the game's KICKOFF time, which was wrong twice
        # over: it stamped rows with a capture time in the future, and because snapshot_at is the
        # first column of the dedupe key, every later capture of the same game collapsed onto the
        # same key. Price moves at an unchanged line were silently dropped (price_american is not
        # in the key), so 2026 kept ~14k prop rows where the game-line table kept 648k.
        # A snapshot time answers "when did we LOOK", never "when does the game start".
        run_captured_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        for e in events:
            status, data, credit, remaining = fetch_event_props(key, e["id"], args.markets, args.regions)
            total_credits += int(credit) if credit and credit.isdigit() else 0
            if status != 200:
                skipped.append(f"{e.get('away_team')}@{e.get('home_team')}: HTTP {status}")
                continue
            rows, skip = parse_event_props(data, event_snapshot_at(data) or run_captured_at,
                                           args.reason, week_map)
            if skip:
                skipped.append(skip)
            all_rows += rows
        print(f"  credits spent this run: {total_credits}  remaining: {remaining}")

    # summary
    players = len({r["player_name"] for r in all_rows})
    markets = sorted({r["market"] for r in all_rows})
    books = sorted({r["book"] for r in all_rows})
    print("PARSED")
    print(f"  prop rows : {len(all_rows)}")
    print(f"  players   : {players}")
    print(f"  markets   : {markets}")
    print(f"  books ({len(books)}) : {books}")
    if all_rows:
        r = all_rows[0]
        print(f"  sample    : {r['player_name']} {r['market']} {r['side']} "
              f"line={r['line']} price={r['price_american']} @ {r['book']}")
    if skipped:
        print(f"  skipped ({len(skipped)}): {skipped[:6]}")

    # A capture time in the future is impossible, so it means snapshot_at got something that is
    # not a capture time -- which is exactly how the kickoff-time fallback went unnoticed for a
    # whole season while silently deduping away every price move. Refuse to write rather than
    # append more rows that look fine and quietly corrupt CLV. Small clock skew is tolerated.
    now = datetime.now(timezone.utc)
    future = [r for r in all_rows
              if datetime.fromisoformat(r["snapshot_at"].replace("Z", "+00:00")) > now + timedelta(minutes=5)]
    if future:
        bad = future[0]
        print(f"ERROR: {len(future)} of {len(all_rows)} rows have snapshot_at in the FUTURE "
              f"(e.g. {bad['snapshot_at']} for a game at {bad['commence_time']}). "
              f"snapshot_at must be when we LOOKED, not when the game starts. Refusing to write.",
              file=sys.stderr)
        return 1

    if not args.write:
        print("\nDRY RUN — nothing written. Add --write to insert into prop_snapshots.")
        return 0
    try:
        n = write_props(all_rows, env)
    except TransientError as e:
        print(f"transient: {e}; skipping this run (no email)", file=sys.stderr)
        return 0
    print(f"\nwrote {n} rows to prop_snapshots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
