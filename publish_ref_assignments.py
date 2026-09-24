"""
Capture NFL referee (crew chief) assignments per game into ref_assignments.

Source: the nflverse games.csv `referee` field — free, already fetched elsewhere,
no scraping. Assignments appear during game week; scheduled runs then populate the
table, which the Context page reads to show each game's crew as a *factor* (its real
penalty tendency), never fused into a pick.

    python publish_ref_assignments.py --season 2025 --no-fetch   # dry test on history
    python publish_ref_assignments.py --write                    # upsert current season

That caveat came true, so the source is now ESPN, with nflverse as the backfill:

  * MEASURED: nflverse fills `referee` only for games that have been PLAYED. 272 of 272 games
    carry a crew for 2023, 2024 and 2025 — all complete — and 0 of 272 for 2026. A crew known
    only after kickoff is worthless as pre-game context, and this job had been running daily
    and writing nothing while reporting success.
  * ESPN publishes the assigned crew BEFORE kickoff, in the game summary's
    `gameInfo.officials`. Verified on 2026 Week 1 NE @ SEA hours before kick: Adrian Hill.
  * nflverse is still read for COMPLETED seasons, because it is the cleaner source of the
    history that REF_STATS' penalty tendencies are computed from.

Take the official whose position is "Referee" — the crew chief REF_STATS is keyed on. The array
is not ordered by seniority; on the game checked, `officials[0]` was a Field Judge.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request

import pandas as pd

import odds_client as oc

GAMES_LOCAL = "data/games.csv"


def fetch_games():
    """Download the schedule. Returns a DataFrame, or None on a transient fetch
    failure (network / 5xx) so the caller can fall back to a local copy or skip."""
    oc.ensure_ssl_certs()
    req = urllib.request.Request(oc.GAMES_URL, headers={"User-Agent": "statseer/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except (urllib.error.URLError, urllib.error.HTTPError):
        return None
    # `data/` is gitignored, so on a fresh CI checkout the DIRECTORY does not exist and this open()
    # raised FileNotFoundError -- which the transient guard above doesn't catch (it only covers
    # network errors), so the run died with a traceback and emailed a FAILURE even though the
    # download had succeeded. Every other script writing under data/ already does this.
    os.makedirs(os.path.dirname(GAMES_LOCAL) or ".", exist_ok=True)
    with open(GAMES_LOCAL, "wb") as fh:
        fh.write(data)
    return pd.read_csv(GAMES_LOCAL, low_memory=False)


ESPN_BOARD = ("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
              "?year=%d&seasontype=2&week=%d")
ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=%s"
# Second attempt when the summary carries no officials. The core API exposes them as their own
# collection, and it has been populated pre-game on days the summary was not. Cheap: one request
# per game, and only for games whose summary came back empty.
ESPN_OFFICIALS = ("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/%s"
                  "/competitions/%s/officials?lang=en&region=us")
# ESPN abbreviates two clubs differently from nflverse (which is what ref_assignments stores).
ESPN_ALIAS = {"LAR": "LA", "WSH": "WAS"}


def _espn_json(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read().decode())
    except Exception as e:  # noqa: BLE001 — ESPN is a best-effort supplement, never fatal
        print(f"  ESPN unavailable ({e})", file=sys.stderr)
        return None


# How far ahead ESPN actually carries a crew. MEASURED on 2026-09-09: of the 16 week-1 games,
# only the one kicking off that night had officials; the 15 others — including games four days
# out — returned an empty list from both the site API and the core API. So there is no point
# pulling a summary for a game two weeks away, and doing so was ~288 requests a run, twice a day.
LOOKAHEAD_DAYS = 10


def fetch_espn_crews(season, weeks=range(1, 19)):
    """[{season, week, home_team, away_team, referee}] for games ESPN has assigned a crew to."""
    out = []
    now = dt.datetime.now(dt.timezone.utc)
    for wk in weeks:
        board = _espn_json(ESPN_BOARD % (season, wk))
        if not board:
            continue
        for ev in board.get("events", []) or []:
            try:
                when = dt.datetime.fromisoformat((ev.get("date") or "").replace("Z", "+00:00"))
            except ValueError:
                when = None
            # Skip games too far out to have a crew yet; a later run picks them up.
            if when and (when - now).days > LOOKAHEAD_DAYS:
                continue
            comps = (ev.get("competitions") or [{}])[0].get("competitors") or []
            home = next((c for c in comps if c.get("homeAway") == "home"), {})
            away = next((c for c in comps if c.get("homeAway") == "away"), {})
            ha = (home.get("team") or {}).get("abbreviation")
            aa = (away.get("team") or {}).get("abbreviation")
            if not ha or not aa or not ev.get("id"):
                continue
            summary = _espn_json(ESPN_SUMMARY % ev["id"])
            officials = ((summary or {}).get("gameInfo") or {}).get("officials") or []
            ref = next((o.get("fullName") for o in officials
                        if ((o.get("position") or {}).get("name") == "Referee")), None)
            if not ref:
                # The summary endpoint stopped carrying pre-game officials at some point this
                # season: every run from week 2 on printed "+0 pre-game crews from ESPN" while
                # the board sat on "Crew assigned closer to kickoff" for games kicking off that
                # night. A row that can never resolve before kickoff is the placeholder problem
                # this project has a rule about, so try the core API's own officials collection
                # before giving up on the game.
                core = _espn_json(ESPN_OFFICIALS % (ev["id"], ev["id"]))
                for item in (core or {}).get("items", []) or []:
                    pos = (item.get("position") or {}).get("name") or ""
                    if pos != "Referee":
                        continue
                    name = (item.get("official") or {}).get("displayName")
                    if not name:
                        # The official is usually a $ref; follow it once.
                        link = (item.get("official") or {}).get("$ref")
                        if link:
                            name = (_espn_json(link.replace("http://", "https://")) or {}).get("displayName")
                    if name:
                        ref = name
                        break
            if not ref:
                continue
            out.append({"season": int(season), "week": int(wk),
                        "home_team": ESPN_ALIAS.get(ha, ha),
                        "away_team": ESPN_ALIAS.get(aa, aa), "referee": ref})
    return out


# ---- Football Zebras: the PRE-GAME source -----------------------------------------------------
# ESPN stopped carrying officials before kickoff this season (every run from week 2 logged
# "+0 pre-game crews from ESPN"), so the board's Referee row could only ever fill in AFTER a game
# was played -- which is the "placeholder that never resolves" this project has a rule against.
# Derek, on a Thursday game: "Is the referee data for tonight's game not available anywhere?"
#
# It is. Football Zebras publishes the league's weekly assignments days ahead, one post per week,
# listing every game and its referee. Measured on 2026 week 3, fetched the morning of the Thursday
# game: all 16 games present, "Falcons at Packers - Shawn Smith" included.
#
# Nicknames only ("Falcons at Packers"), so they map through NFL_NICK below. A name this scrape
# cannot resolve is SKIPPED and counted, never guessed.
FZ_INDEX = "https://www.footballzebras.com/"
FZ_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
NFL_NICK = {
    "Cardinals": "ARI", "Falcons": "ATL", "Ravens": "BAL", "Bills": "BUF", "Panthers": "CAR",
    "Bears": "CHI", "Bengals": "CIN", "Browns": "CLE", "Cowboys": "DAL", "Broncos": "DEN",
    "Lions": "DET", "Packers": "GB", "Texans": "HOU", "Colts": "IND", "Jaguars": "JAX",
    "Chiefs": "KC", "Raiders": "LV", "Chargers": "LAC", "Rams": "LA", "Dolphins": "MIA",
    "Vikings": "MIN", "Patriots": "NE", "Saints": "NO", "Giants": "NYG", "Jets": "NYJ",
    "Eagles": "PHI", "Steelers": "PIT", "49ers": "SF", "Seahawks": "SEA", "Buccaneers": "TB",
    "Titans": "TEN", "Commanders": "WAS",
}


def _fz_html(url):
    try:
        req = urllib.request.Request(url, headers=FZ_UA)
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:                      # noqa: BLE001 — a supplement, never fatal
        print(f"  Football Zebras unavailable ({e})", file=sys.stderr)
        return None


def fetch_zebras_crews(season, week):
    """[{season, week, home_team, away_team, referee}] from Football Zebras' weekly post.

    The post is found from the site index rather than by guessing a slug: the URL carries the
    publication month, which moves through the season. Entries read
    "<Away> at <Home>" (or "vs" for a neutral site) followed by the referee's name."""
    home = _fz_html(FZ_INDEX)
    if not home:
        return []
    m = re.search(r'href="(https://www\.footballzebras\.com/[^"]*week-%d-referee-assignments-%d/)"'
                  % (week, season), home)
    if not m:
        print(f"  Football Zebras: no week-{week} post linked from the index yet")
        return []
    page = _fz_html(m.group(1))
    if not page:
        return []
    body = re.sub(r"<script.*?</script>", "", page, flags=re.S)
    text = re.sub(r"<[^>]+>", "\n", body)
    text = re.sub(r"[ \t]+", " ", text)
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    out, unmapped = [], []
    for i, ln in enumerate(lines):
        mm = re.fullmatch(r"([A-Za-z0-9'. ]+?) (?:at|vs\.?) ([A-Za-z0-9'. ]+)", ln)
        if not mm:
            continue
        away_nick, home_nick = mm.group(1).strip(), mm.group(2).strip()
        away, hometm = NFL_NICK.get(away_nick), NFL_NICK.get(home_nick)
        if not away or not hometm:
            if away_nick in NFL_NICK or home_nick in NFL_NICK:
                unmapped.append(ln)
            continue
        # The referee's name is the next non-empty line; anything else means the layout moved.
        ref = lines[i + 1] if i + 1 < len(lines) else ""
        if not re.fullmatch(r"[A-Z][A-Za-z'.\-]+(?: [A-Z][A-Za-z'.\-]+){1,2}", ref):
            unmapped.append(f"{ln} -> {ref!r}")
            continue
        out.append({"season": int(season), "week": int(week),
                    "home_team": hometm, "away_team": away, "referee": ref})
    if unmapped:
        print(f"  Football Zebras: {len(unmapped)} line(s) not parsed: {unmapped[:3]}")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--no-fetch", action="store_true", help="use local games.csv (don't download)")
    args = ap.parse_args(argv)

    env = oc.load_env()
    if args.no_fetch:
        g = pd.read_csv(GAMES_LOCAL, low_memory=False)
    else:
        g = fetch_games()
        if g is None:   # transient fetch failure — use the local copy, or skip today
            if os.path.exists(GAMES_LOCAL):
                print("games.csv fetch failed (transient) — using local copy")
                g = pd.read_csv(GAMES_LOCAL, low_memory=False)
            else:
                print("games.csv fetch failed (transient) and no local copy — skipping today")
                return 0
    s = g[(g.season == args.season) & (g.game_type == "REG") & g.referee.notna()]
    rows = [{"season": int(r.season), "week": int(r.week), "home_team": r.home_team,
             "away_team": r.away_team, "referee": r.referee} for _, r in s.iterrows()]
    print(f"{args.season}: {len(rows)} games with a crew from nflverse (played games only)")

    # Anything nflverse has not filled is either unplayed or missing — ask ESPN, which assigns
    # pre-game. Keyed on (week, home_team) so an ESPN row never overwrites a played-game record.
    have = {(r["week"], r["home_team"]) for r in rows}
    espn_rows = fetch_espn_crews(args.season)
    added = [r for r in espn_rows if (r["week"], r["home_team"]) not in have]
    rows += added
    have |= {(r["week"], r["home_team"]) for r in added}
    print(f"{args.season}: +{len(added)} pre-game crews from ESPN")

    # Football Zebras for the weeks still uncovered — this is the source that actually carries an
    # assignment BEFORE kickoff (see fetch_zebras_crews). Only the current and next week are
    # fetched: the league posts one week at a time and every earlier week is already filled by
    # nflverse once played.
    upcoming = sorted({int(w) for w in g[(g.season == args.season) & (g.game_type == "REG")
                                         & g.home_score.isna()].week.unique()})[:2]
    zeb_added = []
    for wk in upcoming:
        for r in fetch_zebras_crews(args.season, wk):
            if (r["week"], r["home_team"]) not in have:
                zeb_added.append(r)
                have.add((r["week"], r["home_team"]))
    rows += zeb_added
    print(f"{args.season}: +{len(zeb_added)} pre-game crews from Football Zebras "
          f"(weeks {upcoming or '—'})")

    print(f"{args.season}: {len(rows)} games with an assigned crew")
    for r in rows[:5]:
        print(f"  W{r['week']} {r['away_team']}@{r['home_team']}: {r['referee']}")

    if not args.write:
        print("\nDRY RUN — add --write to upsert.")
        return 0
    if not rows:
        print("\nnothing to write (no assignments yet).")
        return 0

    endpoint = (f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/ref_assignments"
                "?on_conflict=season,week,home_team")
    key = env["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(
        endpoint, data=json.dumps(rows).encode("utf-8"),
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            ok = r.getcode() in (200, 201, 204)
        print(f"\nupserted {len(rows)} assignments" if ok else "\nwrite failed")
    except urllib.error.HTTPError as e:
        print(f"\nWRITE FAILED {e.code}: {e.read().decode()[:300]}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
