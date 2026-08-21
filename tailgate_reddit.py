"""
tailgate_reddit.py -- Phase 2 of the Tailgate feature (see docs/TAILGATE_PIPELINE.md).

Scans each team's fan community -- its subreddit (Reddit RSS) AND its SB Nation team
blog (RSS) -- for players whose fan stock is moving this week, maps each take onto a
real sportsbook prop market (receptions, rush/pass attempts, yards, TDs, INTs, ...),
distills the chatter with Claude (Sonnet, thinking-off), and writes `Buzz` rows into
Supabase `tailgate_buzz` -- the exact shape the /tailgate page already renders. This
is FAN SENTIMENT, not a pick and not model output; never graded, never feeds The Model.

Pipeline per team:
  Reddit (top?t=week + hot + top comments)  ->  roster mention pre-filter
    ->  Claude extraction (structured Buzz)  ->  quotes matched back to thread links
    ->  Supabase upsert (delete-then-insert per team)

Cost lever: the roster pre-filter keeps only snippets that name a rostered skill
player, cutting a team's raw ~40k tokens to ~10-15k before Claude sees them. If the
nflverse roster is unavailable it degrades gracefully to no filter (Claude still
extracts, just on more text).

Reddit is read via its public ATOM/RSS feed -- no app, no credentials. The JSON
Data API is now 403 even from residential IPs and new app creation is gated, but
the RSS feed (/r/<sub>/top/.rss) is an openly published syndication format and is
still served. RSS gives post TITLES and self-post text (no comments or scores),
which is thinner than the API but enough to surface buzz. Claude is ~$2/run at Sonnet.

  python tailgate_reddit.py --current                       # dry run, all teams
  python tailgate_reddit.py --current --teams BUF,BAL        # dry run, two teams
  python tailgate_reddit.py --current --no-extract           # ingest only (snippet counts)
  python tailgate_reddit.py --current --write                # extract + write to Supabase
  python tailgate_reddit.py --season 2026 --week 3 --write   # explicit week

Secrets (env or .env): ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY.
(No Reddit credentials -- public JSON is unauthenticated.)
"""
import argparse
import csv
import html
import io
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import odds_client as oc  # reuse load_env() + ensure_ssl_certs()

UA = "statseer-tailgate/0.2"   # plain UA; Reddit RSS 200s this, 429s browser UAs
MODEL = "claude-sonnet-5"
SKILL_POS = {"QB", "RB", "WR", "TE", "FB"}
ROSTER_URL = ("https://github.com/nflverse/nflverse-data/releases/download/"
              "rosters/roster_{season}.csv")
INJURIES_URL = ("https://github.com/nflverse/nflverse-data/releases/download/"
                "injuries/injuries_{season}.csv")
# nflverse team abbreviations that differ from ours, normalised to canonical.
TEAM_ALIAS = {"LA": "LAR", "SD": "LAC", "OAK": "LV", "STL": "LAR", "WSH": "WAS"}

# team abbrev -> (subreddit, display nickname)
TEAMS = {
    "ARI": ("AZCardinals", "Cardinals"), "ATL": ("falcons", "Falcons"),
    "BAL": ("ravens", "Ravens"),        "BUF": ("buffalobills", "Bills"),
    "CAR": ("panthers", "Panthers"),    "CHI": ("CHIBears", "Bears"),
    "CIN": ("bengals", "Bengals"),      "CLE": ("Browns", "Browns"),
    "DAL": ("cowboys", "Cowboys"),      "DEN": ("DenverBroncos", "Broncos"),
    "DET": ("detroitlions", "Lions"),   "GB":  ("GreenBayPackers", "Packers"),
    "HOU": ("Texans", "Texans"),        "IND": ("Colts", "Colts"),
    "JAX": ("Jaguars", "Jaguars"),      "KC":  ("KansasCityChiefs", "Chiefs"),
    "LAC": ("Chargers", "Chargers"),    "LAR": ("LosAngelesRams", "Rams"),
    "LV":  ("raiders", "Raiders"),      "MIA": ("miamidolphins", "Dolphins"),
    "MIN": ("minnesotavikings", "Vikings"), "NE": ("Patriots", "Patriots"),
    "NO":  ("Saints", "Saints"),        "NYG": ("NYGiants", "Giants"),
    "NYJ": ("nyjets", "Jets"),          "PHI": ("eagles", "Eagles"),
    "PIT": ("steelers", "Steelers"),    "SEA": ("Seahawks", "Seahawks"),
    "SF":  ("49ers", "49ers"),          "TB":  ("buccaneers", "Buccaneers"),
    "TEN": ("Tennesseetitans", "Titans"), "WAS": ("Commanders", "Commanders"),
}

# Second source: each team's SB Nation blog (all 32 publish an Atom feed at
# https://www.<domain>/rss/index.xml -- verified live). Fan-run team communities;
# more editorial than raw board chatter, but the same player-buzz territory and
# rock-solid RSS. team -> (display name, domain).
BLOGS = {
    "ARI": ("Revenge of the Birds", "revengeofthebirds.com"),
    "ATL": ("The Falcoholic", "thefalcoholic.com"),
    "BAL": ("Baltimore Beatdown", "baltimorebeatdown.com"),
    "BUF": ("Buffalo Rumblings", "buffalorumblings.com"),
    "CAR": ("Cat Scratch Reader", "catscratchreader.com"),
    "CHI": ("Windy City Gridiron", "windycitygridiron.com"),
    "CIN": ("Cincy Jungle", "cincyjungle.com"),
    "CLE": ("Dawgs By Nature", "dawgsbynature.com"),
    "DAL": ("Blogging The Boys", "bloggingtheboys.com"),
    "DEN": ("Mile High Report", "milehighreport.com"),
    "DET": ("Pride Of Detroit", "prideofdetroit.com"),
    "GB": ("Acme Packing Company", "acmepackingcompany.com"),
    "HOU": ("Battle Red Blog", "battleredblog.com"),
    "IND": ("Stampede Blue", "stampedeblue.com"),
    "JAX": ("Big Cat Country", "bigcatcountry.com"),
    "KC": ("Arrowhead Pride", "arrowheadpride.com"),
    "LAC": ("Bolts From The Blue", "boltsfromtheblue.com"),
    "LAR": ("Turf Show Times", "turfshowtimes.com"),
    "LV": ("Silver And Black Pride", "silverandblackpride.com"),
    "MIA": ("The Phinsider", "thephinsider.com"),
    "MIN": ("Daily Norseman", "dailynorseman.com"),
    "NE": ("Pats Pulpit", "patspulpit.com"),
    "NO": ("Canal Street Chronicles", "canalstreetchronicles.com"),
    "NYG": ("Big Blue View", "bigblueview.com"),
    "NYJ": ("Gang Green Nation", "ganggreennation.com"),
    "PHI": ("Bleeding Green Nation", "bleedinggreennation.com"),
    "PIT": ("Behind The Steel Curtain", "behindthesteelcurtain.com"),
    "SEA": ("Field Gulls", "fieldgulls.com"),
    "SF": ("Niners Nation", "ninersnation.com"),
    "TB": ("Bucs Nation", "bucsnation.com"),
    "TEN": ("Music City Miracles", "musiccitymiracles.com"),
    "WAS": ("Hogs Haven", "hogshaven.com"),
}

# National NFL player-news RSS. Fetched ONCE per run and pooled across all teams,
# filtered per team by roster mention -- a wider net than Reddit + team blogs, and
# free (public RSS, no scraping). Beat-writer/insider signal without the paid X API.
NATIONAL_FEEDS = [
    ("ProFootballTalk", "https://profootballtalk.nbcsports.com/feed/"),
    ("ESPN NFL", "https://www.espn.com/espn/rss/nfl/news"),
    ("CBS Sports NFL", "https://www.cbssports.com/rss/headlines/nfl/"),
    ("Yahoo Sports NFL", "https://sports.yahoo.com/nfl/rss/"),
    ("NFL.com", "https://www.nfl.com/feeds/rss/news"),
]

MAX_INPUT_CHARS = 14000   # per-team cap on text handed to Claude
SNIPPET_CAP = 500         # per-snippet char cap
MIN_INTERVAL = 5.0        # seconds between Reddit requests (RSS rate-limits hard)

SYSTEM = (
    "You read NFL fan message-board chatter for ONE team and surface players whose "
    "'fan stock' is MOVING this week -- in either direction -- and translate each take "
    "into a REAL sportsbook prop market. You are NOT predicting anything and NOT giving "
    "picks; you summarize what fans are saying, mapped to a bettable angle, as ammo for "
    "someone doing their own research.\n\n"
    "THE KEY JOB: every angle must be a bet a book actually offers. Fans rarely say "
    "'take the over on 4.5 receptions' -- they say things like 'he's going to eat this "
    "week', 'workhorse role', 'they'll be throwing all game', 'red-zone back now', "
    "'shadowed by their #1 corner'. Your job is to convert that sentiment into the "
    "matching market and side. Cover the WHOLE prop board, not just TDs and yards:\n"
    "  QB  -> passing yards | pass attempts | completions | passing TDs | interceptions "
    "| (mobile QB) rushing yards\n"
    "  RB  -> rush attempts (carries) | rushing yards | receptions | rush+rec yards | "
    "anytime TD\n"
    "  WR/TE -> receptions | receiving yards | longest reception | anytime TD | first TD\n"
    "  Any -> anytime TD (ATTD)\n\n"
    "Sentiment -> market mapping (examples):\n"
    "  'huge volume / featured / bell-cow / workhorse' -> OVER rush attempts (RB) or "
    "OVER receptions (WR/TE)\n"
    "  'they'll be trailing / shootout / pass-heavy script' -> OVER pass attempts, OVER "
    "passing yards\n"
    "  'goal-line / red-zone role / gets the rock inside the 5' -> anytime TD\n"
    "  'target hog / sees 8+ looks / safety blanket' -> OVER receptions\n"
    "  'deep threat / boom game / matchup to exploit' -> OVER receiving yards\n"
    "  'committee now / losing snaps / timeshare' -> UNDER rush attempts / UNDER receptions\n"
    "  'shadowed by elite CB / tough front / grind-it-out' -> UNDER receiving yards / "
    "UNDER passing yards\n"
    "  'turnover-prone / pressure all day' -> OVER interceptions\n\n"
    "Rules:\n"
    "- Only report players and takes ACTUALLY present in the snippets. Never invent a "
    "player or a stat line.\n"
    "- direction: 'up' when the bet is an OVER / anytime-TD (fans bullish), 'down' when "
    "the bet is an UNDER (fans bearish/souring). Report BOTH -- an UNDER is as useful as "
    "an OVER. Read the actual tone; do not force one side.\n"
    "- angle is a SHORT prop tag (max 6 words) naming the SIDE + MARKET, e.g. 'OVER "
    "receptions', 'OVER 62.5 rec yds', 'OVER rush attempts', 'UNDER passing yards', "
    "'anytime TD', 'first TD', 'OVER interceptions'. Include a NUMBER only if fans cite "
    "one; otherwise give the market direction without a number (the book sets the line). "
    "Never a sentence, never starting with 'Fans'. Put the narrative in take, not angle.\n"
    "- Every angle MUST be one of the markets above. If a take doesn't map to a real "
    "prop (pure narrative like 'breakout season', 'named the starter', 'looked good in "
    "camp'), DROP it -- do not emit a row for it.\n"
    "- heat: magnitude of the move, SAME scale for up and down. 3 = loud/repeated across "
    "multiple snippets; 2 = a few fans, a real thread; 1 = a one-off mention. Be "
    "conservative -- most weeks have few 3s.\n"
    "- take is 1-2 plain sentences capturing the sentiment (and, briefly, why it points "
    "to that market), not a specific poster.\n"
    "- Include 1-3 short verbatim quotes (each under 15 words) copied from the snippets "
    "that back the buzz, so we can link to the thread.\n"
    "- If nothing rises above noise or nothing maps to a real market, return an empty "
    "buzz array. That is a valid answer."
)

BUZZ_SCHEMA = {
    "type": "object",
    "properties": {
        "buzz": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "player": {"type": "string"},
                "direction": {"type": "string", "enum": ["up", "down"], "description":
                              "'up' = fans bullish/excited; 'down' = fans "
                              "bearish/souring/production trending down"},
                "angle": {"type": "string", "description":
                          "SIDE + real prop MARKET, max 6 words. e.g. 'OVER "
                          "receptions', 'OVER 62.5 rec yds', 'OVER rush attempts', "
                          "'UNDER passing yards', 'anytime TD', 'first TD', 'OVER "
                          "interceptions'. Number only if fans cite one. MUST be a "
                          "market a book offers (pass/rush/rec yards & attempts, "
                          "receptions, completions, TDs, INTs) -- never pure narrative "
                          "like 'breakout season'; drop those. No sentences, no 'Fans'"},
                "heat": {"type": "integer", "enum": [1, 2, 3]},
                "take": {"type": "string"},
                "quotes": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["player", "direction", "angle", "heat", "take"],
            "additionalProperties": False,
        }},
    },
    "required": ["buzz"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------- small helpers
def norm(s):
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("'", "")
    s = re.sub(r"[^a-z0-9]+", " ", s)   # all punctuation -> space
    return " ".join(s.split())


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "player"


def current_season(today=None):
    today = today or datetime.now(timezone.utc).date()
    return today.year if today.month >= 3 else today.year - 1


# ---------------------------------------------------------------- nflverse data
def _get_csv(url):
    oc.ensure_ssl_certs()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return list(csv.DictReader(io.StringIO(r.read().decode("utf-8", "replace"))))


def latest_week(season):
    """Current NFL week via the injuries release's max week (free, same source the
    injury collector uses). Defaults to 1 pre-Week-1 (404)."""
    try:
        rows = _get_csv(INJURIES_URL.format(season=season))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return 1
        raise
    weeks = [int(r["week"]) for r in rows if str(r.get("week", "")).isdigit()]
    return max(weeks) if weeks else 1


def load_roster(season):
    """team abbrev -> {"full": {normalised full names}, "last": {last names}} for
    skill-position players. None if the release is unavailable (filter is skipped)."""
    try:
        rows = _get_csv(ROSTER_URL.format(season=season))
    except Exception as e:  # noqa: BLE001 -- any failure = degrade to no filter
        print(f"  roster unavailable ({e}); skipping mention pre-filter", file=sys.stderr)
        return None
    idx = {}
    for row in rows:
        if (row.get("position") or "").upper() not in SKILL_POS:
            continue
        team = (row.get("team") or "").upper().strip()
        team = TEAM_ALIAS.get(team, team)
        name = (row.get("full_name") or row.get("player_name")
                or f"{row.get('first_name', '')} {row.get('last_name', '')}").strip()
        if not team or not name:
            continue
        d = idx.setdefault(team, {"full": set(), "last": set()})
        nn = norm(name)
        d["full"].add(nn)
        toks = nn.split()
        if toks:
            d["last"].add(toks[-1])
    return idx or None


def mentions(text, team_idx):
    n = norm(text)
    if not n:
        return False
    for full in team_idx["full"]:
        if full and full in n:
            return True
    toks = set(n.split())
    return any(len(last) >= 4 and last in toks for last in team_idx["last"])


# ------------------------------------------------------------------------ reddit
# No app / credentials: read Reddit's public ATOM/RSS feed (/r/<sub>/top/.rss).
# Reddit locked the JSON Data API (403 even from residential IPs) and gated new
# app creation, but the RSS feed -- an openly published syndication format -- is
# still served (200) to a polite, plainly-identified client. RSS gives post
# TITLES and any self-post text, but NOT comments or scores; the feed is already
# "top of week", so we keep its order. Rate limits are tight -- pace + retry 429.
ATOM = "{http://www.w3.org/2005/Atom}"
_last_req = [0.0]
_rate_limited = [False]   # set by the last fetch_snippets if it 403/429'd


def _http_get(url, tries=4):
    for attempt in range(tries):
        wait = MIN_INTERVAL - (time.monotonic() - _last_req[0])
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                _last_req[0] = time.monotonic()
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            _last_req[0] = time.monotonic()
            if e.code == 429 and attempt < tries - 1:
                ra = e.headers.get("Retry-After")
                back = (float(ra) if (ra and ra.replace(".", "", 1).isdigit())
                        else min(15.0, 5.0 * (2 ** attempt)))  # 5, 10, 15s (capped)
                time.sleep(back)
                continue
            raise


def _clean_content(raw):
    """Reddit RSS <content> is double-escaped HTML ending in a 'submitted by ...
    [link] [comments]' footer. Return just the self-post text (empty for link posts)."""
    if not raw:
        return ""
    t = html.unescape(html.unescape(raw))
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"submitted by\s*/u/\S+.*", " ", t, flags=re.I | re.S)  # drop footer
    t = re.sub(r"\[link\]|\[comments\]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def fetch_feed(board, url):
    """Parse one Atom feed -> [{text, permalink, score, board}]. A 403/429 (Reddit)
    trips the rate-limit flag; any other feed error just logs and skips (one bad
    blog feed must not kill the team)."""
    try:
        raw = _http_get(url)
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            _rate_limited[0] = True
        hint = " (rate-limited/blocked)" if e.code in (403, 429) else ""
        print(f"  {board} -> HTTP {e.code}{hint}", file=sys.stderr)
        return []
    except Exception as e:  # noqa: BLE001 -- network/decoding hiccup on one feed
        print(f"  {board} -> error: {e}", file=sys.stderr)
        return []
    try:
        feed = ET.fromstring(raw)
    except ET.ParseError as e:
        print(f"  {board} -> parse error: {e}", file=sys.stderr)
        return []
    entries = feed.findall(f"{ATOM}entry")
    out = []
    for i, entry in enumerate(entries):
        title = (entry.findtext(f"{ATOM}title") or "").strip()
        if not title:
            continue
        link_el = entry.find(f"{ATOM}link")
        permalink = link_el.get("href") if link_el is not None else url
        body = _clean_content(entry.findtext(f"{ATOM}content") or "")
        text = (title + (" -- " + body if body else ""))[:SNIPPET_CAP]
        out.append({"text": text, "permalink": permalink,
                    "score": len(entries) - i, "board": board})  # keep feed order
    return out


def fetch_snippets(abbrev):
    """All of a team's community feeds -- its subreddit (Reddit RSS) plus its SB
    Nation team blog (RSS) -- aggregated into [{text, permalink, score, board}]."""
    oc.ensure_ssl_certs()
    _rate_limited[0] = False
    sub, _ = TEAMS[abbrev]
    feeds = [(f"r/{sub}", f"https://www.reddit.com/r/{sub}/top/.rss?t=week")]
    if abbrev in BLOGS:
        name, dom = BLOGS[abbrev]
        feeds.append((name, f"https://www.{dom}/rss/index.xml"))
    snippets = []
    for board, url in feeds:
        snippets += fetch_feed(board, url)
    return snippets


def fetch_national():
    """National NFL player-news feeds, fetched once and shared across every team.
    Returns [{text, permalink, score, board}]; the per-team roster filter keeps only
    the items that name that team's players."""
    oc.ensure_ssl_certs()
    snippets = []
    for name, url in NATIONAL_FEEDS:
        snippets += fetch_feed(name, url)
    return snippets


# --------------------------------------------------------------------- extract
def extract(nickname, snippets, env):
    """Claude call -> list of buzz dicts (player, angle, heat, take, quotes)."""
    import anthropic  # lazy: only needed when extracting

    lines, total = [], 0
    for i, s in enumerate(sorted(snippets, key=lambda x: -x["score"]), 1):
        block = f"[{i}] ({s.get('board', 'fans')}) {s['text']}"
        if total + len(block) > MAX_INPUT_CHARS:
            break
        lines.append(block)
        total += len(block)
    user = (f"Team: {nickname}\nFan-community snippets (subreddit + team blog) this "
            f"week:\n\n" + "\n\n".join(lines))

    client = anthropic.Anthropic(api_key=env["ANTHROPIC_API_KEY"])
    resp = client.messages.create(
        model=MODEL, max_tokens=4000, thinking={"type": "disabled"},
        system=SYSTEM, messages=[{"role": "user", "content": user}],
        output_config={"format": {"type": "json_schema", "schema": BUZZ_SCHEMA}},
    )
    if resp.stop_reason == "refusal":
        print(f"  {nickname}: extraction refused; skipping", file=sys.stderr)
        return []
    # A response cut off at the token cap leaves the JSON truncated -- don't let that
    # one team's bad parse crash the whole shard (and email a failure). Log + skip.
    if resp.stop_reason == "max_tokens":
        print(f"  {nickname}: extraction hit max_tokens (truncated); skipping",
              file=sys.stderr)
        return []
    text = next((b.text for b in resp.content if b.type == "text"), "{}")
    try:
        return json.loads(text).get("buzz", [])
    except (json.JSONDecodeError, AttributeError) as e:
        print(f"  {nickname}: unparseable extraction ({e}); skipping", file=sys.stderr)
        return []


def build_rows(abbrev, nickname, buzz, snippets, season, week):
    # boards this team's snippets came from, for a generic fallback attribution
    boards = list(dict.fromkeys(s.get("board") for s in snippets if s.get("board")))
    rows = []
    for b in buzz:
        player = (b.get("player") or "").strip()
        if not player:
            continue
        srcs, seen = [], set()
        for q in b.get("quotes", []) or []:
            qn = norm(q)[:60]
            if not qn:
                continue
            for s in snippets:
                if qn in norm(s["text"]) and s["permalink"] not in seen:
                    seen.add(s["permalink"])
                    srcs.append({"board": s.get("board", "fan boards"), "url": s["permalink"]})
                    break
        if not srcs:
            srcs = [{"board": boards[0] if boards else "fan boards"}]
        rows.append({
            "season": season, "week": week,
            "id": f"w{week}-{abbrev}-{slug(player)}",
            "player": player, "team": nickname,
            "angle": (b.get("angle") or "").strip(),
            "direction": "down" if str(b.get("direction", "up")).lower() == "down" else "up",
            "heat": int(b.get("heat", 1)),
            "take": (b.get("take") or "").strip(),
            "sources": srcs[:3],
        })
    return rows


# -------------------------------------------------------------------- supabase
def sb_headers(env):
    key = env["SUPABASE_SERVICE_KEY"]
    return {"apikey": key, "Authorization": f"Bearer {key}",
            "Content-Type": "application/json", "Prefer": "return=minimal"}


def sb_write(env, season, week, nickname, rows):
    if not (env.get("SUPABASE_URL") and env.get("SUPABASE_SERVICE_KEY")):
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY missing")
    oc.ensure_ssl_certs()
    base = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/tailgate_buzz"
    # Replace this team's rows for the week: delete, then insert.
    q = f"?season=eq.{season}&week=eq.{week}&team=eq.{urllib.parse.quote(nickname)}"
    urllib.request.urlopen(urllib.request.Request(
        base + q, headers=sb_headers(env), method="DELETE"), timeout=60).read()
    if rows:
        urllib.request.urlopen(urllib.request.Request(
            base, data=json.dumps(rows).encode("utf-8"),
            headers=sb_headers(env), method="POST"), timeout=60).read()


# ------------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--current", action="store_true", help="infer season + latest week")
    g.add_argument("--season", type=int, help="explicit season (needs --week)")
    ap.add_argument("--week", type=int)
    ap.add_argument("--teams", help="comma-separated abbrevs, e.g. BUF,BAL (default: all 32)")
    ap.add_argument("--shard", metavar="i/n",
                    help="process only shard i of n -- a fixed 1/n slice of the 32 teams. "
                         "Run all n shards (in parallel, separate IPs) to cover the league "
                         "without tripping Reddit's per-IP throttle.")
    ap.add_argument("--no-extract", action="store_true",
                    help="ingest + filter only; print snippet counts, no Claude call")
    ap.add_argument("--write", action="store_true", help="write to Supabase (else dry run)")
    ap.add_argument("--max-minutes", type=float, default=16.0,
                    help="stop starting new teams after this long (keeps the job under "
                         "GitHub's 20m kill; partial data persists, rest fills next run)")
    args = ap.parse_args(argv)

    env = oc.load_env()
    if args.current:
        season = current_season()
        week = args.week or latest_week(season)
    else:
        if args.week is None:
            print("ERROR: --season needs --week (or use --current)", file=sys.stderr)
            return 2
        season, week = args.season, args.week

    if args.teams:
        which = [t.strip().upper() for t in args.teams.split(",") if t.strip().upper() in TEAMS]
    elif args.shard:
        i, n = (int(x) for x in args.shard.split("/"))
        allteams = list(TEAMS)
        size = -(-len(allteams) // n)      # ceil division
        which = allteams[(i - 1) * size:i * size]
    else:
        # Rotate the start each run so a throttled (partial) run doesn't always
        # starve the same late-alphabet teams -- coverage fills over the week.
        allteams = list(TEAMS)
        off = (week + datetime.now(timezone.utc).weekday()) % len(allteams)
        which = allteams[off:] + allteams[:off]
    roster = load_roster(season)

    print(f"Tailgate scan -- season {season}, week {week}, {len(which)} team(s)"
          f"{' [WRITE]' if args.write else ' [dry run]'} -- Reddit + team blogs + national feeds")
    # National player-news feeds: fetch once, reuse for every team (roster-filtered).
    national = fetch_national()
    print(f"  national feeds -> {len(national)} snippets pooled across all teams")
    start = time.monotonic()
    total_rows, empty_teams, rl_streak, done = 0, 0, 0, 0
    extracted, errored = 0, 0   # teams we tried to extract/write, and how many threw
    for abbrev in which:
        if time.monotonic() - start > args.max_minutes * 60:
            print(f"\nTime budget ({args.max_minutes:g}m) hit -- stopping cleanly with "
                  f"{len(which) - done} team(s) left for the next run.", file=sys.stderr)
            break
        done += 1
        nickname = TEAMS[abbrev][1]
        raw = fetch_snippets(abbrev)
        # Circuit breaker: once Reddit throttles this IP, every request 429s and
        # eats backoff -- bail rather than crawl into the 20m kill. Only counts
        # when the team came back empty (a working blog feed keeps the team alive).
        rl_streak = rl_streak + 1 if (_rate_limited[0] and not raw) else 0
        if rl_streak >= 5:
            print("\nReddit throttled 5 teams in a row -- stopping; the rest resume "
                  "next run (rotated/sharded order covers them).", file=sys.stderr)
            break
        if not raw:
            empty_teams += 1
        # Pool the team's own feeds with the national feeds, then keep only snippets
        # that name this team's players (national items about other teams drop out).
        # Without a roster we can't filter, so national is skipped (would be cross-team noise).
        if roster and abbrev in roster:
            kept = [s for s in (raw + national) if mentions(s["text"], roster[abbrev])]
        else:
            kept = raw
        print(f"  {abbrev:<4} {len(raw):>3} team + {len(national):>3} natl -> {len(kept):>3} on-topic")
        if args.no_extract or not kept:
            continue
        # The extract (Claude) + write (Supabase) are the two steps that reach the
        # network for real work. A transient hiccup on ONE team (API overload, a
        # Supabase blip) must not crash the whole shard and email a failure -- the
        # pipeline is designed to be partial, so log the team and move on. A genuinely
        # systemic break (bad key, every team failing) still surfaces via the exit
        # code below.
        extracted += 1
        try:
            buzz = extract(nickname, kept, env)
            rows = build_rows(abbrev, nickname, buzz, kept, season, week)
            for r in rows:
                tick = f"[{'UP' if r['direction'] == 'up' else 'DN'} x{r['heat']}]"
                print(f"       {tick:<8} {r['player']} -- {r['angle']}")
            if args.write:
                sb_write(env, season, week, nickname, rows)
            total_rows += len(rows)
        except Exception as e:  # noqa: BLE001 -- one team's failure never kills the shard
            errored += 1
            print(f"  {abbrev}: extract/write failed ({type(e).__name__}: {e}); "
                  f"skipping this team", file=sys.stderr)

    if empty_teams and empty_teams == done:
        print("\nWARNING: every team attempted returned 0 snippets -- Reddit is rate-"
              "limiting/blocking this IP (403/429 above).", file=sys.stderr)
    print(f"\n{total_rows} buzz row(s) {'written' if args.write else 'found (dry run)'} "
          f"across {done} team(s).")
    # Fail the run ONLY if every team we tried to extract/write threw -- that's a real
    # systemic outage (revoked key, Supabase down) worth an email. A few transient
    # per-team failures are expected and stay quiet.
    if extracted and errored == extracted:
        print(f"\nERROR: all {extracted} extract/write attempt(s) failed -- systemic "
              f"outage (see per-team errors above).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
