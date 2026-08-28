"""
cfb_tailgate_reddit.py -- live CFB "Fan Stock" scan (the college analog of tailgate_reddit.py).

Scans college fan chatter -- r/CFB (national, covers every team) plus a curated set of team
subreddits -- for players whose fan stock is moving this week, maps each take onto a real
sportsbook prop market, distills it with Claude (Sonnet, thinking-off), and writes `Buzz`
rows into Supabase `cfb_tailgate_buzz` -- the exact shape /ncaaf/tailgate renders. FAN
SENTIMENT, not a pick and not model output; never graded, never feeds The Model.

Bounded + relevant: the team universe is the schools that CURRENTLY have posted props
(cfb_prop_snapshots) -- the games the app shows buzz for -- so the scan scales with the
board, not all 136 FBS teams. The per-team mention filter uses the scraped depth charts
(cfb_depth.json), cutting each team's raw text before Claude sees it.

  python cfb_tailgate_reddit.py --current                    # dry run, prop-slate teams
  python cfb_tailgate_reddit.py --current --teams USC,TCU     # dry run, two schools
  python cfb_tailgate_reddit.py --current --no-extract        # ingest only (snippet counts)
  python cfb_tailgate_reddit.py --current --write             # extract + write to Supabase
  python cfb_tailgate_reddit.py --season 2026 --week 1 --write

Secrets (env or .env): ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, CFBD_API_KEY.
Reuses the NFL pipeline's Reddit/RSS + extraction plumbing (tailgate_reddit.py).
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import odds_client as oc
import tailgate_reddit as tr   # reuse the low-level RSS + extraction plumbing

# National feeds — fetched once, pooled across every team, roster-filtered per team. Both are
# Atom (the shared fetch_feed parses Atom); WordPress/RSS-2.0 news feeds return nothing here.
# r/CFB is the backbone (works from sharded runner IPs, throttles a single local IP).
NATIONAL_FEEDS = [
    ("r/CFB", "https://www.reddit.com/r/CFB/top/.rss?t=week"),
    ("SB Nation CFB", "https://www.sbnation.com/rss/college-football/index.xml"),
    # Conference-wide SB Nation blogs (Atom) — pooled + roster-filtered per team, so they
    # cover the G5/mid-major schools that have no team blog of their own.
    ("Mountain West Connection", "https://www.mwcconnection.com/rss/index.xml"),  # MWC
    ("Hustle Belt", "https://www.hustlebelt.com/rss/index.xml"),                  # MAC
    ("Underdog Dynasty", "https://www.underdogdynasty.com/rss/index.xml"),        # AAC/CUSA/G5
]

# PRIMARY per-team source: each program's SB Nation team blog (Atom /rss/index.xml — the same
# rock-solid feed the NFL pipeline uses). CFBD school name -> (blog name, domain). A dead/404
# feed just logs and is skipped; teams without a blog fall back to the subreddit + r/CFB.
CFB_BLOGS = {
    "Alabama": ("Roll Bama Roll", "rollbamaroll.com"),
    "Ohio State": ("Land-Grant Holy Land", "landgrantholyland.com"),
    "Michigan": ("Maize n Brew", "maizenbrew.com"),
    "Georgia": ("Dawg Sports", "dawgsports.com"),
    "LSU": ("And The Valley Shook", "andthevalleyshook.com"),
    "Texas": ("Burnt Orange Nation", "burntorangenation.com"),
    "Notre Dame": ("One Foot Down", "onefootdown.com"),
    "Penn State": ("Black Shoe Diaries", "blackshoediaries.com"),
    "Tennessee": ("Rocky Top Talk", "rockytoptalk.com"),
    "Florida State": ("Tomahawk Nation", "tomahawknation.com"),
    "Miami": ("State of The U", "stateoftheu.com"),
    "Clemson": ("Shakin The Southland", "shakinthesouthland.com"),
    "Wisconsin": ("Bucky's 5th Quarter", "buckys5thquarter.com"),
    "Nebraska": ("Corn Nation", "cornnation.com"),
    "Iowa": ("Black Heart Gold Pants", "blackheartgoldpants.com"),
    "Virginia Tech": ("Gobbler Country", "gobblercountry.com"),
    "TCU": ("Frogs O' War", "frogsowar.com"),
    "North Carolina": ("Tar Heel Blog", "tarheelblog.com"),
    "NC State": ("Backing The Pack", "backingthepack.com"),
    "Auburn": ("College and Magnolia", "collegeandmagnolia.com"),
    "Texas A&M": ("Good Bull Hunting", "goodbullhunting.com"),
    "Ole Miss": ("Red Cup Rebellion", "redcuprebellion.com"),
    "South Carolina": ("Garnet And Black Attack", "garnetandblackattack.com"),
    "Kentucky": ("A Sea Of Blue", "aseaofblue.com"),
    "Missouri": ("Rock M Nation", "rockmnation.com"),
    "Arkansas": ("Arkansas Fight", "arkansasfight.com"),
    "Mississippi State": ("For Whom the Cowbell Tolls", "forwhomthecowbelltolls.com"),
    "Vanderbilt": ("Anchor Of Gold", "anchorofgold.com"),
    "Oregon": ("Addicted To Quack", "addictedtoquack.com"),
    "Washington": ("UW Dawg Pound", "uwdawgpound.com"),
    "Arizona State": ("House of Sparky", "houseofsparky.com"),
    "Arizona": ("Arizona Desert Swarm", "azdesertswarm.com"),
    "Colorado": ("The Ralphie Report", "ralphiereport.com"),
    "Oregon State": ("Building The Dam", "buildingthedam.com"),
    "California": ("Write For California", "writeforcalifornia.com"),
    "Michigan State": ("The Only Colors", "theonlycolors.com"),
    "Purdue": ("Hammer and Rails", "hammerandrails.com"),
    "Indiana": ("The Crimson Quarry", "crimsonquarry.com"),
    "Minnesota": ("The Daily Gopher", "thedailygopher.com"),
    "Maryland": ("Testudo Times", "testudotimes.com"),
    "Rutgers": ("On The Banks", "onthebanks.com"),
    "Pittsburgh": ("Cardiac Hill", "cardiachill.com"),
    "Louisville": ("Card Chronicle", "cardchronicle.com"),
    "Syracuse": ("Nunes Magician", "nunesmagician.com"),
    "Boston College": ("BC Interruption", "bcinterruption.com"),
    "Virginia": ("Streaking The Lawn", "streakingthelawn.com"),
    "Georgia Tech": ("From The Rumble Seat", "fromtherumbleseat.com"),
    "BYU": ("Vanquish The Foe", "vanquishthefoe.com"),
    "UCF": ("Black And Gold Banneret", "blackandgoldbanneret.com"),
    "Cincinnati": ("Down The Drive", "downthedrive.com"),
    "Iowa State": ("Wide Right & Natty Lite", "widerightnattylite.com"),
    "Kansas": ("Rock Chalk Talk", "rockchalktalk.com"),
    "Kansas State": ("Bring On The Cats", "bringonthecats.com"),
    "Oklahoma State": ("Cowboys Ride For Free", "cowboysrideforfree.com"),
    "Texas Tech": ("Viva The Matadors", "vivethematadors.com"),
    "Baylor": ("Our Daily Bears", "ourdailybears.com"),
}

# Secondary: team subreddits (Reddit works from sharded runners; throttles a single local IP).
# The workhorse for schools without a team blog is their conference blog in NATIONAL_FEEDS.
CFB_SUBS = {
    "USC": "uscfootball", "Stanford": "gostanford", "North Carolina": "tarheels",
    "NC State": "NCSU", "Virginia": "UVA", "UNLV": "UNLV", "Memphis": "memphistigers",
    "Alabama": "rolltide", "Georgia": "georgiabulldogs", "Ohio State": "OhioStateFootball",
    "Michigan": "MichiganWolverines", "Texas": "LonghornNation", "Notre Dame": "notredamefootball",
    "Oregon": "ducks", "Tennessee": "Volunteers", "Penn State": "PennStateFootball",
}


# ---- CFB Claude system prompt: identical prop-market job, college framing ------------------
SYSTEM = tr.SYSTEM.replace("NFL fan message-board", "college-football fan message-board").replace(
    "You read NFL", "You read college-football")


def load_roster_from_depth():
    """CFBD school -> {"full": {names}, "last": {last names}} from the scraped depth charts
    (cfb_depth.json). None if it's missing (mention filter degrades to none)."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cfb_depth.json")
    if not os.path.exists(path):
        print("  cfb_depth.json missing; skipping mention pre-filter", file=sys.stderr)
        return None
    with open(path, encoding="utf-8") as f:
        depth = json.load(f)
    idx = {}
    for school, groups in depth.items():
        d = idx.setdefault(school, {"full": set(), "last": set()})
        for names in groups.values():
            for name in names:
                nn = tr.norm(name)
                if not nn:
                    continue
                d["full"].add(nn)
                toks = nn.split()
                if toks:
                    d["last"].add(toks[-1])
    return idx or None


def sb_get(path):
    env = oc.load_env()
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_KEY missing")
    req = urllib.request.Request(url.rstrip("/") + "/rest/v1/" + path,
                                 headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def _alpha(s):
    return "".join(c for c in tr.norm(s) if c.isalnum())


def _snap_to_depth(name, depth_keys):
    """Snap a team name to the canonical CFBD school key (the roster/depth key), for the few
    Odds names the prefix map misses, e.g. 'Hawaii Rainbow Warriors' -> 'Hawai\\'i'."""
    if name in depth_keys:
        return name
    a = _alpha(name)
    best, bl = None, 0
    for k in depth_keys:
        ka = _alpha(k)
        if ka and (a.startswith(ka) or ka.startswith(a) or ka in a) and len(ka) > bl:
            best, bl = k, len(ka)
    return best or name


def prop_slate_teams(key):
    """CFBD school names for every team with a posted prop in the latest snapshot — the games
    the app shows buzz for. Maps Odds full names ('USC Trojans') -> CFBD ('USC'), then snaps
    any leftover to the canonical depth-chart key so the roster filter + display line up."""
    import cfb_player_proj as cpp
    latest = sb_get("cfb_prop_snapshots?select=snapshot_at&order=snapshot_at.desc&limit=1")
    if not latest:
        return []
    snap = urllib.parse.quote(latest[0]["snapshot_at"])
    rows = sb_get(f"cfb_prop_snapshots?snapshot_at=eq.{snap}&select=home_team,away_team")
    odds_names = sorted({t for r in rows for t in (r.get("home_team"), r.get("away_team")) if t})
    cmap = cpp.cfbd_team_map(odds_names, key)
    depth = load_roster_from_depth() or {}
    keys = list(depth.keys())
    return sorted({_snap_to_depth(cmap.get(n, n), keys) for n in odds_names})


def fetch_team_feeds(school):
    """A school's own community feeds — its SB Nation team blog (primary, Atom) plus its
    subreddit when we have one — as [{text, permalink, score, board}]."""
    out = []
    if school in CFB_BLOGS:
        name, dom = CFB_BLOGS[school]
        out += tr.fetch_feed(name, f"https://www.{dom}/rss/index.xml")
    sub = CFB_SUBS.get(school)
    if sub:
        out += tr.fetch_feed(f"r/{sub}", f"https://www.reddit.com/r/{sub}/top/.rss?t=week")
    return out


def extract(school, snippets, env):
    """Claude call -> list of buzz dicts, using the CFB system prompt + the shared schema."""
    import anthropic
    lines, total = [], 0
    for i, s in enumerate(sorted(snippets, key=lambda x: -x["score"]), 1):
        block = f"[{i}] ({s.get('board', 'fans')}) {s['text']}"
        if total + len(block) > tr.MAX_INPUT_CHARS:
            break
        lines.append(block)
        total += len(block)
    user = (f"Team: {school}\nFan-community snippets (r/CFB + team board) this week:\n\n"
            + "\n\n".join(lines))
    client = anthropic.Anthropic(api_key=env["ANTHROPIC_API_KEY"])
    resp = client.messages.create(
        model=tr.MODEL, max_tokens=4000, thinking={"type": "disabled"},
        system=SYSTEM, messages=[{"role": "user", "content": user}],
        output_config={"format": {"type": "json_schema", "schema": tr.BUZZ_SCHEMA}},
    )
    if resp.stop_reason in ("refusal", "max_tokens"):
        print(f"  {school}: extraction {resp.stop_reason}; skipping", file=sys.stderr)
        return []
    text = next((b.text for b in resp.content if b.type == "text"), "{}")
    try:
        return json.loads(text).get("buzz", [])
    except (json.JSONDecodeError, AttributeError) as e:
        print(f"  {school}: unparseable extraction ({e}); skipping", file=sys.stderr)
        return []


def sb_write(env, season, week, school, rows):
    if not (env.get("SUPABASE_URL") and env.get("SUPABASE_SERVICE_KEY")):
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY missing")
    oc.ensure_ssl_certs()
    base = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/cfb_tailgate_buzz"
    q = f"?season=eq.{season}&week=eq.{week}&team=eq.{urllib.parse.quote(school)}"
    urllib.request.urlopen(urllib.request.Request(
        base + q, headers=tr.sb_headers(env), method="DELETE"), timeout=60).read()
    if rows:
        urllib.request.urlopen(urllib.request.Request(
            base, data=json.dumps(rows).encode("utf-8"),
            headers=tr.sb_headers(env), method="POST"), timeout=60).read()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--current", action="store_true", help="infer season, week 1 default")
    g.add_argument("--season", type=int, help="explicit season (needs --week)")
    ap.add_argument("--week", type=int)
    ap.add_argument("--teams", help="comma-separated CFBD school names (default: prop-slate teams)")
    ap.add_argument("--shard", metavar="i/n", help="process only shard i of n of the team list")
    ap.add_argument("--no-extract", action="store_true", help="ingest + filter only; no Claude call")
    ap.add_argument("--write", action="store_true", help="write to Supabase (else dry run)")
    ap.add_argument("--max-minutes", type=float, default=16.0, help="stop starting new teams after this long")
    args = ap.parse_args(argv)

    env = oc.load_env()
    oc.ensure_ssl_certs()
    key = env.get("CFBD_API_KEY")
    if args.current:
        season = tr.current_season()
        week = args.week or 1
    else:
        if args.week is None:
            print("ERROR: --season needs --week (or use --current)", file=sys.stderr); return 2
        season, week = args.season, args.week

    if args.teams:
        which = [t.strip() for t in args.teams.split(",") if t.strip()]
    else:
        which = prop_slate_teams(key)
        if not which:
            print("No posted CFB props yet — nothing to scan.", file=sys.stderr); return 0
    if args.shard:
        i, n = (int(x) for x in args.shard.split("/"))
        size = -(-len(which) // n)
        which = which[(i - 1) * size:i * size]

    roster = load_roster_from_depth()
    print(f"CFB tailgate scan — season {season}, week {week}, {len(which)} team(s)"
          f"{' [WRITE]' if args.write else ' [dry run]'} — r/CFB + team subs + national feeds")
    national = []
    for name, url in NATIONAL_FEEDS:                      # r/CFB + news, fetched once
        national += tr.fetch_feed(name, url)
    print(f"  national feeds -> {len(national)} snippets pooled across all teams")

    start = time.monotonic()
    total_rows, extracted, errored, done = 0, 0, 0, 0
    for school in which:
        if time.monotonic() - start > args.max_minutes * 60:
            print(f"\nTime budget hit — {len(which) - done} team(s) left for next run.", file=sys.stderr)
            break
        done += 1
        raw = fetch_team_feeds(school)
        rk = roster.get(school) if roster else None
        pool = raw + national
        kept = [s for s in pool if tr.mentions(s["text"], rk)] if rk else raw
        print(f"  {school:<20} {len(raw):>3} team + {len(national):>3} natl -> {len(kept):>3} on-topic")
        if args.no_extract or not kept:
            continue
        extracted += 1
        try:
            buzz = extract(school, kept, env)
            rows = tr.build_rows(tr.slug(school), school, buzz, kept, season, week)
            for r in rows:
                tick = f"[{'UP' if r['direction'] == 'up' else 'DN'} x{r['heat']}]"
                print(f"       {tick:<8} {r['player']} — {r['angle']}")
            if args.write:
                sb_write(env, season, week, school, rows)
            total_rows += len(rows)
        except Exception as e:                            # noqa: BLE001 — one team never kills the run
            errored += 1
            print(f"  {school}: extract/write failed ({type(e).__name__}: {e}); skipping", file=sys.stderr)

    print(f"\n{total_rows} buzz row(s) {'written' if args.write else 'found (dry run)'} across {done} team(s).")
    if extracted and errored == extracted:
        print(f"\nERROR: all {extracted} extract/write attempt(s) failed — systemic outage.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
