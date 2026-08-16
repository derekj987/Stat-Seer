"""
tailgate_reddit.py -- Phase 2 of the Tailgate feature (see docs/TAILGATE_PIPELINE.md).

Scans the 32 team subreddits for players fans are buzzing to go OVER a number this
week, distills each team's chatter with Claude (Sonnet, thinking-off), and writes
`Buzz` rows into Supabase `tailgate_buzz` -- the exact shape the /tailgate page
already renders. This is FAN SENTIMENT, not a pick and not model output; it is never
graded and never feeds The Model.

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

MAX_INPUT_CHARS = 14000   # per-team cap on text handed to Claude
SNIPPET_CAP = 500         # per-snippet char cap
MIN_INTERVAL = 5.0        # seconds between Reddit requests (RSS rate-limits hard)

SYSTEM = (
    "You read NFL fan message-board chatter for ONE team and surface players fans "
    "are buzzing about to go OVER a number this week (rushing/receiving yards, "
    "receptions, an anytime TD, etc.). You are NOT predicting anything and NOT "
    "giving picks -- you summarize what fans are saying, as ammo for someone doing "
    "their own research.\n\n"
    "Rules:\n"
    "- Only report players and takes ACTUALLY present in the snippets. Never invent "
    "a player, a stat line, or an over/under number.\n"
    "- angle is a SHORT prop-style tag (max 6 words), never a sentence and never "
    "starting with 'Fans' or 'Buzz'. Use \"OVER <n> <stat>\" when fans cite a number "
    "(e.g. \"OVER 62.5 rec yds\"); otherwise a terse phrase like \"anytime TD\", "
    "\"big rushing day\", or \"first TD\". Put the narrative in take, not angle.\n"
    "- heat: 3 = loud/repeated across multiple snippets; 2 = a few fans, a real "
    "thread; 1 = a one-off simmering mention. Be conservative -- most weeks have few 3s.\n"
    "- take is 1-2 plain sentences capturing the sentiment, not a specific poster.\n"
    "- Include 1-3 short verbatim quotes (each under 15 words) copied from the "
    "snippets that back the buzz, so we can link to the thread.\n"
    "- If nothing rises above noise, return an empty buzz array. That is a valid answer."
)

BUZZ_SCHEMA = {
    "type": "object",
    "properties": {
        "buzz": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "player": {"type": "string"},
                "angle": {"type": "string", "description":
                          "short prop-style tag, max 6 words, e.g. 'OVER 62.5 rec "
                          "yds' or 'anytime TD' -- no sentences, no leading 'Fans'"},
                "heat": {"type": "integer", "enum": [1, 2, 3]},
                "take": {"type": "string"},
                "quotes": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["player", "angle", "heat", "take"],
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


def fetch_snippets(sub):
    """Top-of-week posts from the subreddit's RSS feed as [{text, permalink, score}].
    score is a synthetic descending rank (RSS has none) so feed/top order is kept."""
    oc.ensure_ssl_certs()
    _rate_limited[0] = False
    url = f"https://www.reddit.com/r/{sub}/top/.rss?t=week"
    try:
        raw = _http_get(url)
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            _rate_limited[0] = True
        hint = " (Reddit may be blocking this IP)" if e.code in (403, 429) else ""
        print(f"  r/{sub} -> HTTP {e.code}{hint}", file=sys.stderr)
        return []
    try:
        feed = ET.fromstring(raw)
    except ET.ParseError as e:
        print(f"  r/{sub} -> RSS parse error: {e}", file=sys.stderr)
        return []
    entries = feed.findall(f"{ATOM}entry")
    snippets = []
    for i, entry in enumerate(entries):
        title = (entry.findtext(f"{ATOM}title") or "").strip()
        if not title:
            continue
        link_el = entry.find(f"{ATOM}link")
        permalink = (link_el.get("href") if link_el is not None
                     else f"https://reddit.com/r/{sub}")
        body = _clean_content(entry.findtext(f"{ATOM}content") or "")
        text = (title + (" -- " + body if body else ""))[:SNIPPET_CAP]
        snippets.append({"text": text, "permalink": permalink,
                         "score": len(entries) - i})  # keep top-of-week order
    return snippets


# --------------------------------------------------------------------- extract
def extract(nickname, sub, snippets, env):
    """Claude call -> list of buzz dicts (player, angle, heat, take, quotes)."""
    import anthropic  # lazy: only needed when extracting

    lines, total = [], 0
    for i, s in enumerate(sorted(snippets, key=lambda x: -x["score"]), 1):
        block = f"[{i}] (score {s['score']}) {s['text']}"
        if total + len(block) > MAX_INPUT_CHARS:
            break
        lines.append(block)
        total += len(block)
    user = (f"Team: {nickname}\nSnippets from r/{sub} this week:\n\n"
            + "\n\n".join(lines))

    client = anthropic.Anthropic(api_key=env["ANTHROPIC_API_KEY"])
    resp = client.messages.create(
        model=MODEL, max_tokens=2000, thinking={"type": "disabled"},
        system=SYSTEM, messages=[{"role": "user", "content": user}],
        output_config={"format": {"type": "json_schema", "schema": BUZZ_SCHEMA}},
    )
    if resp.stop_reason == "refusal":
        print(f"  {nickname}: extraction refused; skipping", file=sys.stderr)
        return []
    text = next((b.text for b in resp.content if b.type == "text"), "{}")
    return json.loads(text).get("buzz", [])


def build_rows(abbrev, nickname, sub, buzz, snippets, season, week):
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
                    srcs.append({"board": f"r/{sub}", "url": s["permalink"]})
                    break
        if not srcs:
            srcs = [{"board": f"r/{sub}"}]
        rows.append({
            "season": season, "week": week,
            "id": f"w{week}-{abbrev}-{slug(player)}",
            "player": player, "team": nickname,
            "angle": (b.get("angle") or "").strip(),
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
    else:
        # Rotate the start each run so a throttled (partial) run doesn't always
        # starve the same late-alphabet teams -- coverage fills over the week.
        allteams = list(TEAMS)
        off = (week + datetime.now(timezone.utc).weekday()) % len(allteams)
        which = allteams[off:] + allteams[:off]
    roster = load_roster(season)

    print(f"Tailgate scan -- season {season}, week {week}, {len(which)} team(s)"
          f"{' [WRITE]' if args.write else ' [dry run]'} -- Reddit RSS")
    start = time.monotonic()
    total_rows, empty_teams, rl_streak, done = 0, 0, 0, 0
    for abbrev in which:
        if time.monotonic() - start > args.max_minutes * 60:
            print(f"\nTime budget ({args.max_minutes:g}m) hit -- stopping cleanly with "
                  f"{len(which) - done} team(s) left for the next run.", file=sys.stderr)
            break
        done += 1
        sub, nickname = TEAMS[abbrev]
        raw = fetch_snippets(sub)
        # Circuit breaker: once Reddit throttles this IP, every request 429s and
        # eats backoff -- bail rather than crawl into the 20m kill.
        rl_streak = rl_streak + 1 if _rate_limited[0] else 0
        if rl_streak >= 5:
            print("\nReddit throttled 5 teams in a row -- stopping; the rest resume "
                  "next run (rotated order covers them).", file=sys.stderr)
            break
        if not raw:
            empty_teams += 1
        kept = ([s for s in raw if mentions(s["text"], roster[abbrev])]
                if roster and abbrev in roster else raw)
        print(f"  {abbrev:<4} r/{sub:<18} {len(raw):>3} snippets -> {len(kept):>3} on-topic")
        if args.no_extract or not kept:
            continue
        buzz = extract(nickname, sub, kept, env)
        rows = build_rows(abbrev, nickname, sub, buzz, kept, season, week)
        total_rows += len(rows)
        for r in rows:
            heat = {1: "simmering", 2: "heating up", 3: "on fire"}[r["heat"]]
            print(f"       + {r['player']} ({heat}) -- {r['angle']}")
        if args.write:
            sb_write(env, season, week, nickname, rows)

    if empty_teams and empty_teams == done:
        print("\nWARNING: every team attempted returned 0 snippets -- Reddit is rate-"
              "limiting/blocking this IP (403/429 above).", file=sys.stderr)
    print(f"\n{total_rows} buzz row(s) {'written' if args.write else 'found (dry run)'} "
          f"across {done} team(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
