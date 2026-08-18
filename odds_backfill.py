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

IMPORTANT — event IDs are timestamp-scoped
------------------------------------------
The Odds API RE-KEYS an event's id over time, so an id discovered days earlier is
"invalid" (HTTP 404) when you query odds at a different snapshot. So for every
(game, snapshot) we look up the id from the historical EVENTS endpoint AT THAT
timestamp, then pull odds for that id at the same timestamp. Games are de-duped by
matchup, not by id (a re-keyed game is still one game).

Endpoints & cost
----------------
  * Historical events   /v4/historical/.../events?date=ISO      (cheap; lists games+ids at that time)
  * Historical odds      /v4/historical/.../events/{id}/odds     (10 credits x regions x markets)
The x-requests-last header is the truth; this script sums it and can hard-stop at
--max-credits. Same-kickoff slates share one events call (date-keyed cache).

Usage
-----
    # PREVIEW (safe): discover games + a credit estimate; optional parse sample.
    python odds_backfill.py --seasons 2023,2024,2025
    python odds_backfill.py --seasons 2025 --sample 3 --fetch-sample

    # FULL backfill -> writes to prop_snapshots. Resume is automatic.
    python odds_backfill.py --seasons 2023,2024,2025 --write

Secrets (.env): ODDS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY.
Requires the `prop_snapshots` table + grants from ingest/schema.sql.
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

from odds_client import (
    load_env, ensure_ssl_certs, TEAM_ABBR, derive_season, load_week_map,
)

SPORT = "americanfootball_nfl"
BASE = f"https://api.the-odds-api.com/v4/historical/sports/{SPORT}"
EVENTS_URL = BASE + "/events"
PROGRESS_PATH = ".backfill_progress.json"
GAMES_CACHE = os.path.join("data", "backfill_games_{season}.json")

DEFAULT_MARKETS = [
    "player_pass_yds", "player_pass_tds", "player_pass_attempts",
    "player_pass_completions", "player_pass_interceptions",
    "player_rush_yds", "player_rush_attempts",
    "player_receptions", "player_reception_yds",
    "player_anytime_td",
]
DEFAULT_OFFSETS_MIN = [1440, 240, 10]   # T-24h, T-4h, close
DEFAULT_REGIONS = "us,us2"


# --------------------------------------------------------------------- http
def get_json(url, tries=5):
    """GET -> (status, obj_or_text, x_requests_last, x_requests_remaining).
    Retries 429 / 5xx / dropped connections with capped exponential backoff."""
    ensure_ssl_certs()
    status, body = 0, ""
    for attempt in range(tries):
        try:
            resp = urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=60)
        except urllib.error.HTTPError as e:
            resp = e
        except urllib.error.URLError:
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
    def __init__(self, cap=None):
        self.spent, self.remaining, self.cap = 0, None, cap

    def add(self, last, remaining):
        try:
            self.spent += int(last) if last is not None else 0
        except ValueError:
            pass
        if remaining is not None:
            self.remaining = remaining

    def over_budget(self):
        return self.cap is not None and self.spent >= self.cap


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------ events (id lookup)
def events_at(api_key, date_iso, credits, cache):
    """{(home_abbr, away_abbr): event_id} valid AT this snapshot time. Cached by
    date string so a same-kickoff slate costs one events call, not one per game."""
    if date_iso in cache:
        return cache[date_iso]
    status, obj, last, remaining = get_json(
        EVENTS_URL + "?" + urllib.parse.urlencode({"apiKey": api_key, "date": date_iso}))
    credits.add(last, remaining)
    idmap = {}
    if status == 200 and isinstance(obj, dict):
        for ev in obj.get("data", []) or []:
            h = TEAM_ABBR.get(ev.get("home_team"))
            a = TEAM_ABBR.get(ev.get("away_team"))
            if h and a and ev.get("id"):
                idmap[(h, a)] = ev["id"]
    cache[date_iso] = idmap
    return idmap


# ------------------------------------------------------------------ discovery
def discover_games(api_key, season, cadence_days, week_map, credits, sleep_s, use_cache=True):
    """Sweep the events endpoint across a season -> {game_key: {season, week, home,
    away, commence}}, ONE entry per matchup (re-keyed ids collapse)."""
    cache_path = GAMES_CACHE.format(season=season)
    if use_cache and os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as fh:
            games = json.load(fh)
        print(f"  season {season}: {len(games)} games from cache ({cache_path})")
        return games

    games = {}
    d, end = date(season, 9, 1), date(season + 1, 2, 15)
    while d <= end:
        when = iso(datetime(d.year, d.month, d.day, 16, tzinfo=timezone.utc))
        status, obj, last, remaining = get_json(
            EVENTS_URL + "?" + urllib.parse.urlencode({"apiKey": api_key, "date": when}))
        credits.add(last, remaining)
        if status == 200 and isinstance(obj, dict):
            for ev in obj.get("data", []) or []:
                commence = ev.get("commence_time")
                h = TEAM_ABBR.get(ev.get("home_team"))
                a = TEAM_ABBR.get(ev.get("away_team"))
                if not (commence and h and a):
                    continue
                s = derive_season(commence)
                wk = week_map.get((s, h, a))
                if wk is None:
                    continue  # preseason / pro bowl / unmapped — skip
                gk = f"{s}-{wk}-{a}-{h}"
                if gk not in games:
                    games[gk] = {"season": s, "week": wk, "home": h, "away": a, "commence": commence}
        elif status != 200:
            print(f"  ! events {d}: HTTP {status} {str(obj)[:120]}", file=sys.stderr)
        d += timedelta(days=cadence_days)
        time.sleep(sleep_s)

    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as fh:
        json.dump(games, fh)
    print(f"  season {season}: {len(games)} games discovered (cached -> {cache_path})")
    return games


# -------------------------------------------------------------------- parsing
def parse_prop_odds(env_obj, week_map):
    """Historical odds envelope {timestamp, data:{event}} -> prop_snapshots rows."""
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
                    "snapshot_at": ts, "capture_reason": "BACKFILL",
                    "season": season, "week": week,
                    "event_id": eid, "commence_time": commence,
                    "home_team": home, "away_team": away,
                    "book": bkey, "market": mkey,
                    "player_name": player, "side": side,
                    "line": None if line is None else float(line),
                    "price_american": None if oc.get("price") is None else int(oc["price"]),
                })
    return rows


def fetch_event_snapshot(api_key, event_id, date_iso, regions, markets):
    url = BASE + f"/events/{event_id}/odds?" + urllib.parse.urlencode({
        "apiKey": api_key, "date": date_iso, "regions": regions,
        "markets": markets, "oddsFormat": "american",
    })
    return get_json(url)


# ------------------------------------------------------------------- supabase
def write_props(rows, url, service_key, batch=500, tries=5):
    """Idempotent upsert into prop_snapshots, with retries on transient network /
    5xx errors so a dropped connection doesn't kill a long backfill."""
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
        data = json.dumps(chunk).encode("utf-8")
        for attempt in range(tries):
            try:
                req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=60) as r:
                    if r.getcode() in (200, 201, 204):
                        written += len(chunk)
                break
            except urllib.error.HTTPError as e:
                if 500 <= e.code < 600 and attempt < tries - 1:
                    time.sleep(min(30, 2 ** attempt)); continue
                raise RuntimeError(f"write HTTP {e.code}: {e.read().decode('utf-8','replace')[:300]}")
            except urllib.error.URLError:
                if attempt < tries - 1:
                    time.sleep(min(30, 2 ** attempt)); continue
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


# ------------------------------------------------------------------ one game
def pull_game(api_key, meta, offsets, regions, markets, week_map, credits, ev_cache, sleep_s, done):
    """Fetch every not-yet-done snapshot for one game. Returns (rows, fetched_keys,
    settled_keys): rows to write; fetched_keys mark done ONLY after a good write;
    settled_keys (empty/too-early/404) can be marked done immediately."""
    kickoff = datetime.fromisoformat(meta["commence"].replace("Z", "+00:00"))
    gk = f"{meta['season']}-{meta['week']}-{meta['away']}-{meta['home']}"
    rows, fetched_keys, settled_keys = [], [], []
    for off in offsets:
        key = f"{gk}|{off}"
        if key in done:
            continue
        if credits.over_budget():
            raise KeyboardInterrupt(f"hit --max-credits")
        snap = iso(kickoff - timedelta(minutes=off))
        idmap = events_at(api_key, snap, credits, ev_cache)
        eid = idmap.get((meta["home"], meta["away"]))
        if not eid:                      # game not listed yet at this snapshot (too early)
            settled_keys.append(key); continue
        status, obj, last, remaining = fetch_event_snapshot(api_key, eid, snap, regions, markets)
        credits.add(last, remaining)
        if status == 200:
            got = parse_prop_odds(obj, week_map)
            if got:
                rows.extend(got); fetched_keys.append(key)
            else:
                settled_keys.append(key)   # posted no props at this time
        elif status == 429:
            raise KeyboardInterrupt("rate limited")
        else:                              # 404/other, definitive — don't spin on it
            print(f"  ! {meta['away']}@{meta['home']} off={off}: HTTP {status} "
                  f"{str(obj)[:80]}", file=sys.stderr)
            settled_keys.append(key)
        time.sleep(sleep_s)
    return rows, fetched_keys, settled_keys


# ------------------------------------------------------------------------ main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seasons", default="2023,2024,2025")
    ap.add_argument("--markets", default=",".join(DEFAULT_MARKETS))
    ap.add_argument("--regions", default=DEFAULT_REGIONS)
    ap.add_argument("--offsets", default=",".join(str(m) for m in DEFAULT_OFFSETS_MIN),
                    help="minutes before kickoff per snapshot, e.g. 1440,240,10")
    ap.add_argument("--cadence-days", type=int, default=3)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--fetch-sample", action="store_true")
    ap.add_argument("--sample", type=int, default=2)
    ap.add_argument("--max-events", type=int, default=None)
    ap.add_argument("--max-credits", type=int, default=None)
    ap.add_argument("--sleep", type=float, default=0.2)
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--no-cache", action="store_true")
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
    ev_cache = {}

    print(f"Backfill NFL props | seasons={seasons} | {n_markets} markets x {n_regions} regions "
          f"= {per_call} credits/odds-call | {len(offsets)} snapshots/game")
    week_map = load_week_map()

    all_games = {}
    for season in seasons:
        games = discover_games(api_key, season, args.cadence_days, week_map, credits,
                               args.sleep, use_cache=not args.no_cache)
        if args.max_events:
            games = dict(list(games.items())[:args.max_events])
        all_games[season] = games

    total_games = sum(len(v) for v in all_games.values())
    est = total_games * len(offsets) * per_call
    print(f"\nPLAN: {total_games} games x {len(offsets)} snapshots x {per_call} credits "
          f"= ~{est:,} odds credits (+ {credits.spent} discovery credits so far)")

    if not args.write:
        if args.fetch_sample:
            print(f"\nPARSE TEST — fetching {args.sample} game(s) at the closing snapshot, not writing:")
            flat = [meta for evs in all_games.values() for meta in evs.values()]
            for meta in flat[:args.sample]:
                kickoff = datetime.fromisoformat(meta["commence"].replace("Z", "+00:00"))
                snap = iso(kickoff - timedelta(minutes=offsets[-1]))
                idmap = events_at(api_key, snap, credits, ev_cache)
                eid = idmap.get((meta["home"], meta["away"]))
                if not eid:
                    print(f"  {meta['away']}@{meta['home']} wk{meta['week']}: no id at snapshot"); continue
                status, obj, last, remaining = fetch_event_snapshot(api_key, eid, snap, args.regions, args.markets)
                credits.add(last, remaining)
                rows = parse_prop_odds(obj, week_map) if status == 200 else []
                print(f"  {meta['away']}@{meta['home']} wk{meta['week']} close: HTTP {status}, "
                      f"{len(rows)} rows, credit={last}")
                for r in rows[:4]:
                    print(f"     {r['book']:>10} {r['market']:<22} {r['player_name']:<20} "
                          f"{r['side']:<5} line={r['line']} price={r['price_american']}")
            print(f"\nsample credits spent: {credits.spent}  remaining: {credits.remaining}")
        print("\nPREVIEW ONLY — add --write to run the full backfill into prop_snapshots.")
        return 0

    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env", file=sys.stderr)
        return 1
    done = load_progress(args.fresh)
    print(f"\nWRITING to prop_snapshots (resume set: {len(done)} pulls already done)\n")

    written_total, games_done = 0, 0
    try:
        for season in seasons:
            for meta in all_games[season].values():
                rows, fetched_keys, settled_keys = pull_game(
                    api_key, meta, offsets, args.regions, args.markets, week_map,
                    credits, ev_cache, args.sleep, done)
                done.update(settled_keys)                 # nothing to write for these
                if rows:
                    try:
                        written_total += write_props(rows, url, key)
                        done.update(fetched_keys)          # mark done ONLY after a good write
                    except Exception as e:                 # noqa: BLE001 — keep the run alive
                        print(f"  ! write failed ({e}); leaving those pulls for a resume", file=sys.stderr)
                else:
                    done.update(fetched_keys)
                games_done += 1
                if games_done % 20 == 0:
                    save_progress(done)
                    print(f"  {games_done}/{total_games} games | {written_total} rows | "
                          f"{credits.spent} credits | ~{credits.remaining} remaining")
    except KeyboardInterrupt as e:
        print(f"\nStopping: {e}. Progress saved — re-run to resume.", file=sys.stderr)
    finally:
        save_progress(done)

    print(f"\nDONE: {games_done}/{total_games} games, {written_total} rows written, "
          f"{credits.spent} credits spent, ~{credits.remaining} remaining.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
