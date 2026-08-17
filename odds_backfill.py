"""
odds_backfill.py

One-time historical backfill of NFL PLAYER-PROP odds from The Odds API into the
`prop_snapshots` table, so the player pipeline can finally be scored against the
market (beat-the-close, CLV, line movement). See TODO / the prop-odds scope.

Why this exists
---------------
Historical odds can't be recreated after the fact — you either recorded a line at
the time or you buy the archive. The Odds API sells it: player props back to
2023-05-03 at 5-minute snapshot granularity. This script pulls, per game, a few
snapshots (default T-24h, T-4h, and the closing line ~10 min before kickoff),
across every book in the requested regions, and stores them append-only.

Endpoints & cost
----------------
  * Historical events   /v4/historical/.../events?date=ISO      (cheap — lists games)
  * Historical odds      /v4/historical/.../events/{id}/odds     (10 credits x regions x markets)
Per game per snapshot the odds call costs 10 x regions x markets. The x-requests-last
header is the truth; this script sums it and can hard-stop at --max-credits.

Usage
-----
    # 1. PREVIEW (safe): discover games + a 2-event parse sample + a credit estimate.
    #    Spends only the cheap events-endpoint credits, never the big odds pulls.
    python odds_backfill.py --seasons 2023,2024,2025

    # 2. Small live test — fetch + parse a few events, print rows, DO NOT write:
    python odds_backfill.py --seasons 2025 --sample 3 --fetch-sample

    # 3. Full backfill — fetch every game/snapshot and WRITE to prop_snapshots:
    python odds_backfill.py --seasons 2023,2024,2025 --write

    # Resume is automatic: completed (event, offset) pulls are recorded in
    # .backfill_progress.json and skipped, so a re-run never re-spends credits.

Secrets (.env): ODDS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY.
Requires the `prop_snapshots` table + grants from ingest/schema.sql to exist.
Stdlib only (certifi via odds_client for local TLS).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

# Reuse the proven helpers so this stays consistent with the live ingester.
from odds_client import (
    load_env, ensure_ssl_certs, TEAM_ABBR, derive_season, load_week_map,
)

SPORT = "americanfootball_nfl"
BASE = f"https://api.the-odds-api.com/v4/historical/sports/{SPORT}"
EVENTS_URL = BASE + "/events"
PROGRESS_PATH = ".backfill_progress.json"
EVENTS_CACHE = os.path.join("data", "backfill_events_{season}.json")

# The prop markets the player pipeline projects. Books return whichever they post.
DEFAULT_MARKETS = [
    "player_pass_yds", "player_pass_tds", "player_pass_attempts",
    "player_pass_completions", "player_pass_interceptions",
    "player_rush_yds", "player_rush_attempts",
    "player_receptions", "player_reception_yds",
    "player_anytime_td",
]
# Snapshots per game, in MINUTES BEFORE kickoff. Close (~10 min) is the CLV anchor;
# the earlier two give intra-week movement. Props rarely exist >2 days out, so we
# don't waste pulls there by default.
DEFAULT_OFFSETS_MIN = [1440, 240, 10]   # T-24h, T-4h, close
DEFAULT_REGIONS = "us,us2"


# --------------------------------------------------------------------- http
def get_json(url, tries=5):
    """GET -> (status, obj_or_text, x_requests_last, x_requests_remaining).
    Retries 429 / 5xx with capped exponential backoff."""
    ensure_ssl_certs()
    status, body = 0, ""
    for attempt in range(tries):
        try:
            resp = urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=60)
        except urllib.error.HTTPError as e:
            resp = e
        except urllib.error.URLError as e:
            if attempt < tries - 1:
                time.sleep(min(30, 2 ** attempt)); continue
            raise
        status = resp.getcode()
        headers = resp.headers
        body = resp.read().decode("utf-8", "replace")
        last = headers.get("x-requests-last")
        remaining = headers.get("x-requests-remaining")
        if status == 429 or 500 <= status < 600:
            if attempt < tries - 1:
                time.sleep(min(30, 2 ** attempt)); continue
        obj = json.loads(body) if status == 200 else body
        return status, obj, last, remaining
    return status, body, None, None


class Credits:
    """Running tally from x-requests-last, with an optional hard ceiling."""
    def __init__(self, cap=None):
        self.spent = 0
        self.remaining = None
        self.cap = cap

    def add(self, last, remaining):
        try:
            self.spent += int(last) if last is not None else 0
        except ValueError:
            pass
        if remaining is not None:
            self.remaining = remaining

    def over_budget(self):
        return self.cap is not None and self.spent >= self.cap


# ------------------------------------------------------------------ discovery
def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def discover_events(api_key, season, cadence_days, week_map, credits, sleep_s, use_cache=True):
    """Sweep the historical events endpoint across a season and return
    {event_id: {commence, home, away, week}} for REGULAR-season games only."""
    cache = EVENTS_CACHE.format(season=season)
    if use_cache and os.path.exists(cache):
        with open(cache, "r", encoding="utf-8") as fh:
            found = json.load(fh)
        print(f"  season {season}: {len(found)} games from cache ({cache})")
        return found

    found = {}
    d = date(season, 9, 1)
    end = date(season + 1, 2, 15)
    while d <= end:
        status, obj, last, remaining = get_json(
            EVENTS_URL + "?" + urllib.parse.urlencode({"apiKey": api_key, "date": iso(datetime(d.year, d.month, d.day, 16, tzinfo=timezone.utc))}))
        credits.add(last, remaining)
        if status == 200 and isinstance(obj, dict):
            for ev in obj.get("data", []) or []:
                eid = ev.get("id")
                commence = ev.get("commence_time")
                home = TEAM_ABBR.get(ev.get("home_team"))
                away = TEAM_ABBR.get(ev.get("away_team"))
                if not (eid and commence and home and away) or eid in found:
                    continue
                wk = week_map.get((derive_season(commence), home, away))
                if wk is None:
                    continue  # preseason / pro bowl / unmapped — not a regular-season game
                found[eid] = {"commence": commence, "home": home, "away": away, "week": wk}
        elif status != 200:
            print(f"  ! events {d}: HTTP {status} {str(obj)[:120]}", file=sys.stderr)
        d += timedelta(days=cadence_days)
        time.sleep(sleep_s)

    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, "w", encoding="utf-8") as fh:
        json.dump(found, fh)
    print(f"  season {season}: {len(found)} regular-season games discovered "
          f"(credits so far {credits.spent}, cached -> {cache})")
    return found


# -------------------------------------------------------------------- parsing
def parse_prop_odds(env_obj, week_map):
    """Historical odds envelope {timestamp, data:{event}} -> prop_snapshots rows.
    Player identity is in outcome.description for over/under markets; anytime-TD
    style markets carry the player in outcome.name with no point."""
    if not isinstance(env_obj, dict):
        return []
    ts = env_obj.get("timestamp")
    data = env_obj.get("data") or {}
    eid = data.get("id")
    commence = data.get("commence_time")
    home = TEAM_ABBR.get(data.get("home_team"))
    away = TEAM_ABBR.get(data.get("away_team"))
    if not (ts and eid and commence and home and away):
        return []
    season = derive_season(commence)
    week = week_map.get((season, home, away))
    if week is None:
        return []
    rows = []
    for book in data.get("bookmakers", []):
        bkey = book.get("key")
        for market in book.get("markets", []):
            mkey = market.get("key")
            for oc in market.get("outcomes", []):
                desc = oc.get("description")
                if desc:                       # over/under prop: description = player
                    player, side, line = desc, oc.get("name"), oc.get("point")
                else:                          # anytime-TD etc.: name = player, no point
                    player, side, line = oc.get("name"), "Yes", oc.get("point")
                if not player:
                    continue
                rows.append({
                    "snapshot_at": ts,
                    "capture_reason": "BACKFILL",
                    "season": season, "week": week,
                    "event_id": eid, "commence_time": commence,
                    "home_team": home, "away_team": away,
                    "book": bkey, "market": mkey,
                    "player_name": player,
                    "side": side,
                    "line": None if line is None else float(line),
                    "price_american": None if oc.get("price") is None else int(oc["price"]),
                })
    return rows


def fetch_event_snapshot(api_key, event_id, date_iso, regions, markets):
    """One historical odds pull for a game at a snapshot time. Returns
    (status, env_obj, last, remaining)."""
    url = BASE + f"/events/{event_id}/odds?" + urllib.parse.urlencode({
        "apiKey": api_key, "date": date_iso, "regions": regions,
        "markets": markets, "oddsFormat": "american",
    })
    return get_json(url)


# ------------------------------------------------------------------- supabase
def write_props(rows, url, service_key, batch=500):
    endpoint = (url.rstrip("/") + "/rest/v1/prop_snapshots"
                "?on_conflict=snapshot_at,event_id,book,market,player_name,side,line")
    headers = {
        "apikey": service_key, "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal,resolution=ignore-duplicates",
    }
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
            detail = e.read().decode("utf-8", "replace")[:400]
            print(f"  ! write batch {i//batch} failed: HTTP {e.code} {detail}", file=sys.stderr)
            raise
    return written


# ------------------------------------------------------------------- progress
def load_progress(fresh):
    if fresh or not os.path.exists(PROGRESS_PATH):
        return set()
    with open(PROGRESS_PATH, "r", encoding="utf-8") as fh:
        return set(json.load(fh))


def save_progress(done):
    with open(PROGRESS_PATH, "w", encoding="utf-8") as fh:
        json.dump(sorted(done), fh)


# ------------------------------------------------------------------------ main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seasons", default="2023,2024,2025", help="comma-separated, e.g. 2023,2024,2025")
    ap.add_argument("--markets", default=",".join(DEFAULT_MARKETS))
    ap.add_argument("--regions", default=DEFAULT_REGIONS, help="e.g. us or us,us2")
    ap.add_argument("--offsets", default=",".join(str(m) for m in DEFAULT_OFFSETS_MIN),
                    help="minutes before kickoff per snapshot, e.g. 1440,240,10")
    ap.add_argument("--cadence-days", type=int, default=3, help="event-discovery sweep step")
    ap.add_argument("--write", action="store_true", help="fetch ALL games and write to prop_snapshots")
    ap.add_argument("--fetch-sample", action="store_true",
                    help="in preview mode, actually fetch --sample events (parse-test, no write)")
    ap.add_argument("--sample", type=int, default=2, help="events to fetch in a preview/parse test")
    ap.add_argument("--max-events", type=int, default=None, help="cap events per season (testing)")
    ap.add_argument("--max-credits", type=int, default=None, help="hard stop when credits spent reaches this")
    ap.add_argument("--sleep", type=float, default=0.2, help="seconds between API calls")
    ap.add_argument("--fresh", action="store_true", help="ignore .backfill_progress.json and start over")
    ap.add_argument("--no-cache", action="store_true", help="re-discover events instead of using the cache")
    args = ap.parse_args(argv)

    env = load_env()
    api_key = env.get("ODDS_API_KEY")
    if not api_key:
        print("ERROR: ODDS_API_KEY missing in .env", file=sys.stderr)
        return 1
    seasons = [int(s) for s in args.seasons.split(",") if s.strip()]
    offsets = [int(m) for m in args.offsets.split(",") if m.strip()]
    n_markets = len([m for m in args.markets.split(",") if m.strip()])
    n_regions = len([r for r in args.regions.split(",") if r.strip()])
    per_call = 10 * n_regions * n_markets
    credits = Credits(cap=args.max_credits)

    print(f"Backfill NFL props | seasons={seasons} | {n_markets} markets x {n_regions} regions "
          f"= {per_call} credits/call | {len(offsets)} snapshots/game")
    week_map = load_week_map()

    # ---- discovery (cheap) + plan ----
    all_events = {}
    for season in seasons:
        found = discover_events(api_key, season, args.cadence_days, week_map, credits,
                                args.sleep, use_cache=not args.no_cache)
        if args.max_events:
            found = dict(list(found.items())[:args.max_events])
        all_events[season] = found

    total_games = sum(len(v) for v in all_events.values())
    est = total_games * len(offsets) * per_call
    print(f"\nPLAN: {total_games} games x {len(offsets)} snapshots x {per_call} credits "
          f"= ~{est:,} odds credits (+ {credits.spent} discovery credits already spent)")

    # ---- preview mode: no --write ----
    if not args.write:
        if args.fetch_sample:
            print(f"\nPARSE TEST — fetching {args.sample} event(s), not writing:")
            flat = [(s, eid, meta) for s, evs in all_events.items() for eid, meta in evs.items()]
            for season, eid, meta in flat[:args.sample]:
                kickoff = datetime.fromisoformat(meta["commence"].replace("Z", "+00:00"))
                snap = kickoff - timedelta(minutes=offsets[-1])   # closing snapshot
                status, obj, last, remaining = fetch_event_snapshot(
                    api_key, eid, iso(snap), args.regions, args.markets)
                credits.add(last, remaining)
                rows = parse_prop_odds(obj, week_map) if status == 200 else []
                print(f"  {meta['away']}@{meta['home']} wk{meta['week']} close-snap: "
                      f"HTTP {status}, {len(rows)} rows, credit={last}")
                for r in rows[:4]:
                    print(f"     {r['book']:>10} {r['market']:<22} {r['player_name']:<20} "
                          f"{r['side']:<5} line={r['line']} price={r['price_american']}")
            print(f"\nsample credits spent: {credits.spent}  remaining: {credits.remaining}")
        print("\nPREVIEW ONLY — add --write to run the full backfill into prop_snapshots.")
        return 0

    # ---- full backfill + write ----
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env", file=sys.stderr)
        return 1
    done = load_progress(args.fresh)
    print(f"\nWRITING to prop_snapshots (resume set: {len(done)} pulls already done)\n")

    written_total, games_done = 0, 0
    try:
        for season in seasons:
            for eid, meta in all_events[season].items():
                kickoff = datetime.fromisoformat(meta["commence"].replace("Z", "+00:00"))
                batch = []
                for off in offsets:
                    pull_key = f"{eid}|{off}"
                    if pull_key in done:
                        continue
                    if credits.over_budget():
                        raise KeyboardInterrupt(f"hit --max-credits {args.max_credits}")
                    snap = kickoff - timedelta(minutes=off)
                    status, obj, last, remaining = fetch_event_snapshot(
                        api_key, eid, iso(snap), args.regions, args.markets)
                    credits.add(last, remaining)
                    if status == 200:
                        batch.extend(parse_prop_odds(obj, week_map))
                        done.add(pull_key)
                    elif status == 429:
                        print("  ! rate-limited after retries; stopping cleanly (resume later)", file=sys.stderr)
                        raise KeyboardInterrupt("rate limited")
                    else:
                        print(f"  ! {meta['away']}@{meta['home']} off={off}: HTTP {status} "
                              f"{str(obj)[:100]}", file=sys.stderr)
                    time.sleep(args.sleep)
                if batch:
                    written_total += write_props(batch, url, key)
                games_done += 1
                if games_done % 20 == 0:
                    save_progress(done)
                    print(f"  {games_done}/{total_games} games | {written_total} rows written | "
                          f"{credits.spent} credits spent | ~{credits.remaining} remaining")
    except KeyboardInterrupt as e:
        print(f"\nStopping: {e}. Progress saved — re-run to resume.", file=sys.stderr)
    finally:
        save_progress(done)

    print(f"\nDONE: {games_done}/{total_games} games, {written_total} rows written, "
          f"{credits.spent} credits spent, ~{credits.remaining} remaining.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
