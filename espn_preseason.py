"""
espn_preseason.py

Pull NFL PRESEASON box scores from ESPN's public core API into the ISOLATED
`preseason_team_games` table. nflverse carries no preseason data, so ESPN is the
only source. This feed exists ONLY to power the throwaway preseason "test-run"
model — it is never joined into the real model, calibration, or player pipelines.

    # Dry run (no DB) — print what would be written for the 2026 preseason:
    python espn_preseason.py --season 2026

    # Write to Supabase:
    python espn_preseason.py --season 2026 --write

Why ESPN core API (sports.core.api.espn.com) and not site.api: the friendly
summary endpoint 403s from many IPs; the normalized core API does not. It costs
more requests (each game fans out into $ref hops) so calls are paced.

Reuses odds_client for env loading + SSL cert fixing. Stdlib + certifi only.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

import odds_client as oc  # load_env, ensure_ssl_certs

CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")
SEASONTYPE_PRE = 1
PRESEASON_WEEKS = (1, 2, 3, 4)  # HOF game is week 1; most years run 1-3

# ESPN abbreviation -> nflverse abbreviation (only the two that differ).
ESPN_TO_NFLVERSE = {"LAR": "LA", "WSH": "WAS"}

# Team box-score categories worth keeping for the model. ESPN exposes many.
KEEP_CATEGORIES = {"general", "passing", "rushing", "receiving",
                   "defensive", "scoring", "miscellaneous"}

PACE_SEC = 0.3  # polite pacing between ESPN requests


def fetch_json(url, retries=3):
    """GET + parse JSON with a browser UA. Retries transient failures."""
    oc.ensure_ssl_certs()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"ESPN fetch failed after {retries}: {url} ({last})")


def _abbr(espn_abbr):
    return ESPN_TO_NFLVERSE.get(espn_abbr, espn_abbr)


class TeamCache:
    """event competitor.team is a $ref; resolve id -> nflverse abbr once each."""
    def __init__(self):
        self._by_url = {}

    def abbr(self, team_ref):
        if team_ref not in self._by_url:
            t = fetch_json(team_ref)
            time.sleep(PACE_SEC)
            self._by_url[team_ref] = _abbr(t.get("abbreviation", "")) or "UNK"
        return self._by_url[team_ref]


def list_event_ids(season):
    """All preseason event ids for the season, in (week, id) order."""
    out = []
    for wk in PRESEASON_WEEKS:
        url = f"{CORE}/seasons/{season}/types/{SEASONTYPE_PRE}/weeks/{wk}/events?lang=en&region=us"
        try:
            data = fetch_json(url)
        except RuntimeError:
            continue
        for item in data.get("items", []):
            ref = item.get("$ref", "")
            eid = ref.rstrip("/").split("/events/")[-1].split("?")[0]
            if eid:
                out.append((wk, eid))
        time.sleep(PACE_SEC)
    return out


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def team_stats(stat_ref):
    """Follow a competitor.statistics $ref -> {category: {statName: value}}."""
    try:
        data = fetch_json(stat_ref)
    except RuntimeError:
        return {}
    time.sleep(PACE_SEC)
    out = {}
    for cat in (data.get("splits", {}) or {}).get("categories", []) or []:
        name = cat.get("name")
        if name not in KEEP_CATEGORIES:
            continue
        vals = {}
        for s in cat.get("stats", []) or []:
            n = _num(s.get("value"))
            if s.get("name") and n is not None:
                vals[s["name"]] = n
        if vals:
            out[name] = vals
    return out


def fetch_game(season, week, event_id, teams):
    """One preseason game -> two team rows (home + away). None if not final."""
    comp = fetch_json(f"{CORE}/events/{event_id}/competitions/{event_id}?lang=en&region=us")
    time.sleep(PACE_SEC)
    status = ((comp.get("status") or {}).get("type") or {})
    if not status.get("completed"):
        # status may itself be a $ref on some records — resolve once if so.
        sref = (comp.get("status") or {}).get("$ref")
        if sref:
            st = fetch_json(sref)
            time.sleep(PACE_SEC)
            status = (st.get("type") or {})
        if not status.get("completed"):
            return None  # skip games not yet played

    kickoff = comp.get("date")
    sides = []
    for c in comp.get("competitors", []):
        abbr = teams.abbr(c["team"]["$ref"]) if c.get("team", {}).get("$ref") else "UNK"
        score = None
        if c.get("score", {}).get("$ref"):
            sc = fetch_json(c["score"]["$ref"])
            time.sleep(PACE_SEC)
            score = int(_num(sc.get("value")) or 0)
        stats = team_stats(c["statistics"]["$ref"]) if c.get("statistics", {}).get("$ref") else {}
        sides.append({
            "abbr": abbr, "home": c.get("homeAway") == "home",
            "score": score, "won": c.get("winner"), "stats": stats,
        })

    if len(sides) != 2:
        return None
    a, b = sides
    rows = []
    for me, opp in ((a, b), (b, a)):
        rows.append({
            "season": season, "week": week, "event_id": str(event_id),
            "kickoff": kickoff, "team": me["abbr"], "opponent": opp["abbr"],
            "is_home": me["home"], "points_for": me["score"],
            "points_against": opp["score"], "won": me["won"], "stats": me["stats"],
        })
    return rows


def write_supabase(rows, url, key, batch=200):
    endpoint = (url.rstrip("/") + "/rest/v1/preseason_team_games"
                "?on_conflict=season,event_id,team")
    headers = {
        "apikey": key, "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal,resolution=merge-duplicates",
    }
    written = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        req = urllib.request.Request(
            endpoint, data=json.dumps(chunk).encode("utf-8"), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.getcode() in (200, 201, 204):
                    written += len(chunk)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:400]
            print(f"  ! batch {i//batch} failed: HTTP {e.code} {detail}", file=sys.stderr)
            raise
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--write", action="store_true", help="write to Supabase (else dry run)")
    ap.add_argument("--limit", type=int, default=None, help="cap games (for a quick probe)")
    args = ap.parse_args(argv)

    print(f"ESPN preseason  season={args.season}")
    events = list_event_ids(args.season)
    if args.limit:
        events = events[:args.limit]
    print(f"  preseason events found: {len(events)}")

    teams = TeamCache()
    all_rows = []
    for wk, eid in events:
        try:
            rows = fetch_game(args.season, wk, eid, teams)
        except RuntimeError as e:
            print(f"  wk{wk} {eid}: ERROR {e}", file=sys.stderr)
            continue
        if not rows:
            print(f"  wk{wk} {eid}: not final yet — skipped")
            continue
        all_rows.extend(rows)
        home = next((r for r in rows if r["is_home"]), rows[0])
        away = next((r for r in rows if not r["is_home"]), rows[1])
        print(f"  wk{wk} {away['team']} {away['points_for']} @ "
              f"{home['team']} {home['points_for']}  (stats cats: {len(home['stats'])})")

    print(f"\nPARSED {len(all_rows)} team-game rows from {len(all_rows)//2} games")
    if not args.write:
        print("DRY RUN — nothing written. Add --write to insert into Supabase.")
        return 0

    env = oc.load_env()
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing", file=sys.stderr)
        return 1
    written = write_supabase(all_rows, url, key)
    print(f"WROTE {written} rows to preseason_team_games")
    return 0


if __name__ == "__main__":
    sys.exit(main())
