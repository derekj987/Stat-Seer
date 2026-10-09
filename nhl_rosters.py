"""
nhl_rosters.py -- build the NHL player -> club map that puts a team tag beside a name.

The prop feed carries the two clubs per GAME and never the club per PLAYER, so an NHL prop
card could name eighteen skaters without saying which bench any of them sits on. This fetches
all 32 current rosters from the NHL's own public API and writes them to a generated TS module
the props page reads.

    python nhl_rosters.py --dry-run     # fetch and report coverage, write nothing
    python nhl_rosters.py               # write web/lib/nhlRosters.ts

🚨 MATCHING IS DONE WITHIN ONE GAME, AND A MISS IS CHEAPER THAN A MISLABEL. The resolver lives
in web/lib/nhlTeamTag.ts; this file only supplies it data. Two decisions in it were measured
here rather than guessed, against all 353 (player, game) pairs on a live sweep:

  · THE CANDIDATE SET IS THE TWO ROSTERS OF HIS OWN GAME, ~46 players, not the league's 773.
    That is what makes a bare last-name match safe.

  · THERE IS NO FUZZY TIER. An earlier cut had one at 0.84 and its only effects were bad: it
    matched "Damon Severson" to *Danton Heinen*, and it broke the Elias Pettersson tie by
    picking whichever scored higher. Exact / last+initial / last, each requiring its surviving
    candidates to agree on a club, matched 351 of 353 with nothing left to guess at.

Measured on 2026-10-09 (353 pairs, 773 rostered players):

    exact            350      league-wide names the feed spells exactly as the NHL does
    last             1        "Yegor Chinakhov" vs the NHL's "Egor" -- the surname carries it
    UNMATCHED        2        both Damon Severson, who is one player in two games

Severson is the honest limit, not a bug to fix: the NHL's own player search returns him as
CBJ with active=False -- he is on long-term injury reserve and off the roster endpoint, while
books still post props on him. He renders with no tag, which is what the grid does with any
player this map does not know.

THE TWO NAME SHAPES THAT BITE, both handled in the shared normaliser:

  · "St Louis Blues" (odds feed) vs "St. Louis Blues" (NHL API). Rather than keep an alias
    table, team names are keyed on letters and digits only, which also covers a feed that one
    day drops the accent from "Montreal Canadiens". All 32 clubs matched this way, checked
    against every team name either NHL table has ever recorded.

  · "Elias Pettersson (2004)". Vancouver have TWO Elias Petterssons and the feed disambiguates
    one with a birth year. The parenthetical is stripped, which leaves both names matching both
    players -- and that is fine, because BOTH ARE CANUCKS. The resolver returns a club when the
    surviving candidates agree on one even if it cannot tell the men apart; a team tag is a
    team, not an identity. It returns nothing only when they would disagree.

Stdlib + odds_client (TLS only -- the NHL API needs no key and costs nothing).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "analysis"))

import odds_client as oc  # noqa: E402

API = "https://api-web.nhle.com/v1"
OUT = os.path.join(ROOT, "web", "lib", "nhlRosters.ts")

# A roster this much smaller than a full NHL club means the fetch degraded, not that a team
# waived half its players. Writing a thin file would silently strip tags off the board.
MIN_PLAYERS_PER_TEAM = 16
MIN_TEAMS = 32


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def team_key(s: str) -> str:
    """Letters and digits only -- 'St Louis Blues' and 'St. Louis Blues' land on one key.
    web/lib/nhlTeamTag.ts implements exactly this; the two must not drift."""
    return re.sub(r"[^a-z0-9]", "", _strip_accents(s).lower())


SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def player_norm(s: str) -> str:
    """'Elias Pettersson (2004)' -> 'elias pettersson'. Mirrored in nhlTeamTag.ts."""
    s = re.sub(r"\(.*?\)", " ", s)
    s = _strip_accents(s).lower().replace(".", " ").replace("'", "").replace("-", " ")
    return " ".join(t for t in re.split(r"\s+", s) if t and t not in SUFFIXES)


def _get(url, timeout=45):
    req = urllib.request.Request(url, headers={"User-Agent": "statseer/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def fetch():
    """(teams, rosters) -- teams maps a team KEY to its abbreviation, rosters abbrev -> names."""
    standings = _get(f"{API}/standings/now").get("standings", [])
    teams, full = {}, {}
    for t in standings:
        ab = t["teamAbbrev"]["default"]
        name = t["teamName"]["default"]
        teams[team_key(name)] = ab
        full[ab] = name
    rosters = {}
    for ab in sorted(full):
        try:
            d = _get(f"{API}/roster/{ab}/current")
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            # One club failing must not quietly produce a board where that club's players have
            # no tag and every other club's does. Fail the run instead.
            raise SystemExit(f"roster fetch failed for {ab}: {e}")
        names = []
        for grp in ("forwards", "defensemen", "goalies"):
            for p in d.get(grp, []) or []:
                fn = (p.get("firstName") or {}).get("default", "")
                ln = (p.get("lastName") or {}).get("default", "")
                n = player_norm(f"{fn} {ln}")
                if n:
                    names.append(n)
        rosters[ab] = sorted(set(names))
    return teams, rosters, full


def render(teams, rosters, full) -> str:
    gen = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    lines = [
        "// AUTO-GENERATED by nhl_rosters.py — do not edit by hand.",
        "// All 32 current NHL rosters from the NHL public API, for the team tag beside a player's",
        "// name on /nhl/props. The prop feed gives two clubs per GAME and none per PLAYER.",
        "//",
        "// Resolution lives in lib/nhlTeamTag.ts, NOT here — a helper added to a generated file is",
        "// wiped by the next refresh, which has taken this project's build down before.",
        f"// Generated {gen} — {len(rosters)} clubs, {sum(len(v) for v in rosters.values())} players.",
        "",
        "/** Team name as the ODDS FEED spells it, keyed on letters+digits only, to its abbreviation.",
        " *  The key form matters: the feed writes 'St Louis Blues', the NHL writes 'St. Louis Blues'. */",
        "export const NHL_TEAM_ABBREV: Record<string, string> = {",
    ]
    for k in sorted(teams):
        lines.append(f'  {json.dumps(k)}: {json.dumps(teams[k])},')
    lines += [
        "};",
        "",
        "/** Abbreviation to the club's full name, for anything that wants to print it. */",
        "export const NHL_TEAM_NAME: Record<string, string> = {",
    ]
    for ab in sorted(full):
        lines.append(f'  {json.dumps(ab)}: {json.dumps(full[ab])},')
    lines += [
        "};",
        "",
        "/** Abbreviation to that club's normalised player names (see player_norm in nhl_rosters.py). */",
        "export const NHL_ROSTER: Record<string, string[]> = {",
    ]
    for ab in sorted(rosters):
        lines.append(f'  {json.dumps(ab)}: {json.dumps(rosters[ab])},')
    lines += ["};", ""]
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="fetch and report, write nothing")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    teams, rosters, full = fetch()
    total = sum(len(v) for v in rosters.values())
    print(f"{len(rosters)} clubs, {total} players")

    # 🚨 GUARD THE WRITE. A generated file is rewritten by a scheduled job with nobody watching,
    # and a half-empty one does not fail a build — it just quietly drops every tag for the clubs
    # it lost. Same guard, same reason, as the one cfb_export.py grew after writing a 0-row board
    # twice from a stale database.
    thin = [ab for ab, v in rosters.items() if len(v) < MIN_PLAYERS_PER_TEAM]
    if len(rosters) < MIN_TEAMS or thin:
        raise SystemExit(
            f"refusing to write: {len(rosters)} clubs (want {MIN_TEAMS}), "
            f"undersized {thin or 'none'} — the API returned less than a league.")

    if args.dry_run:
        print("DRY RUN — nothing written.")
        for ab in sorted(rosters)[:3]:
            print(f"  {ab}: {len(rosters[ab])} e.g. {rosters[ab][:3]}")
        return 0

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(render(teams, rosters, full))
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
