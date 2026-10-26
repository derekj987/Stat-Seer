"""
nba_rosters.py -- build the NBA player -> team map that puts a team tag beside a name.

The prop feed carries the two teams per GAME and never the team per PLAYER, so an NBA prop card
can name fourteen players without saying which bench any of them sits on. This fetches all 30
current rosters from ESPN's public site API and writes them to a generated TS module the props
page reads.

    python nba_rosters.py --dry-run     # fetch and report coverage, write nothing
    python nba_rosters.py               # write web/lib/nbaRosters.ts

WHY ESPN. It is already this project's source for NFL and college-football scoreboards, refs and
inactives (six call sites), it needs no key, and it serves rosters and the schedule from the same
host. The NHL module uses the NHL's own api-web.nhle.com; the NBA's equivalent (stats.nba.com)
rejects non-browser clients often enough that a scheduled job on it would be a recurring triage
ticket, which is the kind of cost this project has already paid once.

🚨 MATCHING IS DONE WITHIN ONE GAME, AND A MISS IS CHEAPER THAN A MISLABEL. The resolver lives in
web/lib/nbaTeamTag.ts; this file only supplies it data. Putting "(MIA)" beside a Maverick is worse
than putting nothing, because a reader cannot tell it is wrong.

MEASURED ON 2026-10-26, against all 117 (player, game) pairs in the first live prop sweep and all
518 rostered players:

    exact            117      after the initial-run rule in player_norm; 116 before it
    UNMATCHED          0
    priced into a game neither of their teams is in: 0

The one pair that was not exact is recorded in player_norm: the feed writes "C.J. McCollum" and
ESPN writes "CJ McCollum". It was worth fixing in the normaliser rather than letting the surname
tier absorb it, because it is a structural disagreement about how to write initials and would have
recurred for every P.J. and R.J. in the league.

With that done the looser tiers in nbaTeamTag.ts are insurance rather than load-bearing — which is
NOT what the NHL module found (it needed a surname tier for "Yegor" vs "Egor" Chinakhov and still
missed two). If a future sweep starts leaning on them, that is a signal the feed's naming has
drifted, not business as usual.

🚨 THIS CHECK IS ALSO WHAT SETTLED A FALSE ALARM, AND THE LESSON GENERALISES. Reviewing the first
NBA board by eye, I flagged Giannis Antetokounmpo on a Dallas @ Miami card and Anthony Davis and
Trae Young on Washington @ Charlotte as obviously wrong players. Every one was a 2026 offseason
move: Giannis is a Heat player, Davis and Young are Wizards, Paul George is a Celtic. The feed was
right and my recollection was stale. A model's or a reader's memory of a roster is not a source;
this file is. Check the names against it before calling a board wrong.

Rosters change in-season — trades, ten-day contracts, two-way call-ups — so this is refreshed on a
schedule rather than committed once.

Stdlib only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import unicodedata
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))

BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
OUT = os.path.join(ROOT, "web", "lib", "nbaRosters.ts")


def _strip_accents(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c))


def team_key(s: str) -> str:
    """Letters and digits only. Mirrored in nbaTeamTag.ts.

    The odds feed and ESPN agree on all 30 NBA team names today, so unlike the NHL's
    'St Louis Blues' vs 'St. Louis Blues' there is no live discrepancy to absorb. Keying this way
    anyway costs nothing and means a feed that one day writes 'LA Clippers' for 'Los Angeles
    Clippers' fails to match rather than silently mislabelling — and an alias table never has to
    be invented under pressure.
    """
    return re.sub(r"[^a-z0-9]", "", _strip_accents(s).lower())


SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def player_norm(s: str) -> str:
    """'P.J. Washington' and 'PJ Washington' -> 'pj washington'. Mirrored in nbaTeamTag.ts.

    NBA names lean on initials far harder than hockey names do, and THE TWO SOURCES DISAGREE ABOUT
    HOW TO WRITE THEM. Measured on the first live sweep: the odds feed sends "C.J. McCollum" while
    ESPN's roster says "CJ McCollum". Dot-to-space alone turns those into 'c j mccollum' and
    'cj mccollum', which are not equal -- so the pair fell through to the surname tier, the one the
    comments here call insurance.

    Merging a RUN of single-letter tokens back into one makes them identical, which is correct
    rather than merely convenient: "C.J." and "CJ" are one name written two ways, not two names.
    With this rule all 117 (player, game) pairs on that sweep resolve on the EXACT tier; without it,
    116 did. It generalises to every P.J., R.J., T.J. and A.J. in the league rather than fixing one
    man's name.
    """
    s = re.sub(r"\(.*?\)", " ", s or "")
    s = _strip_accents(s).lower().replace(".", " ").replace("'", "").replace("-", " ")
    toks = [t for t in re.split(r"\s+", s) if t and t not in SUFFIXES]
    out: list[str] = []
    run: list[str] = []
    for t in toks:
        if len(t) == 1:
            run.append(t)
            continue
        if run:
            out.append("".join(run))
            run = []
        out.append(t)
    if run:
        out.append("".join(run))
    return " ".join(out)


def _get(url, timeout=45):
    req = urllib.request.Request(url, headers={"User-Agent": "statseer/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def fetch():
    """(teams, rosters, full) -- teams maps a team KEY to its abbreviation, rosters abbrev ->
    normalised names, full abbrev -> display name."""
    data = _get(f"{BASE}/teams")
    entries = [x["team"] for x in data["sports"][0]["leagues"][0]["teams"]]
    if len(entries) < 30:
        raise SystemExit(f"ESPN returned {len(entries)} teams, expected 30 — feed shape changed?")
    teams, rosters, full = {}, {}, {}
    for t in entries:
        ab, name = t["abbreviation"], t["displayName"]
        teams[team_key(name)] = ab
        full[ab] = name
        athletes = _get(f"{BASE}/teams/{t['id']}/roster").get("athletes") or []
        names = sorted({player_norm(a.get("fullName") or a.get("displayName") or "")
                        for a in athletes})
        rosters[ab] = [n for n in names if n]
        print(f"  {ab:4} {name:26} {len(rosters[ab]):3} players")
    return teams, rosters, full


def render(teams, rosters, full) -> str:
    gen = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    lines = [
        "// AUTO-GENERATED by nba_rosters.py — do not edit by hand.",
        "// All 30 current NBA rosters from ESPN's public site API, for the team tag beside a",
        "// player's name on /nba/props. The prop feed gives two teams per GAME and none per PLAYER.",
        "//",
        "// Resolution lives in lib/nbaTeamTag.ts, NOT here — a helper added to a generated file is",
        "// wiped by the next refresh, which has taken this project's build down before.",
        f"// Generated {gen} — {len(rosters)} teams, {sum(len(v) for v in rosters.values())} players.",
        "",
        "/** Team name as the ODDS FEED spells it, keyed on letters+digits only, to its",
        " *  abbreviation. Keyed rather than literal so a feed that writes 'LA Clippers' for",
        " *  'Los Angeles Clippers' misses loudly instead of mislabelling. */",
        "export const NBA_TEAM_ABBREV: Record<string, string> = {",
    ]
    for k in sorted(teams):
        lines.append(f'  {json.dumps(k)}: {json.dumps(teams[k])},')
    lines += [
        "};",
        "",
        "/** Abbreviation to the team's full name, for anything that wants to print it. */",
        "export const NBA_TEAM_NAME: Record<string, string> = {",
    ]
    for ab in sorted(full):
        lines.append(f'  {json.dumps(ab)}: {json.dumps(full[ab])},')
    lines += [
        "};",
        "",
        "/** Abbreviation to that team's normalised player names (see player_norm in",
        " *  nba_rosters.py — nbaTeamTag.ts must normalise identically). */",
        "export const NBA_ROSTER: Record<string, string[]> = {",
    ]
    for ab in sorted(rosters):
        lines.append(f'  {json.dumps(ab)}: {json.dumps(rosters[ab])},')
    lines += ["};", ""]
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="fetch and report, write nothing")
    args = ap.parse_args(argv)

    teams, rosters, full = fetch()
    total = sum(len(v) for v in rosters.values())
    print(f"\n{len(rosters)} teams, {total} players")
    # A team that comes back empty is the failure mode worth catching: ESPN answers 200 with an
    # empty athletes list rather than erroring, so without this the generated file would quietly
    # lose a team and every player on it would render untagged with nothing to explain why.
    empty = [ab for ab, v in rosters.items() if not v]
    if empty:
        raise SystemExit(f"EMPTY ROSTER for {', '.join(empty)} — refusing to write a file that "
                         f"would silently drop them")
    if total < 400:
        raise SystemExit(f"only {total} players across 30 teams — expected ~500; refusing to write")

    if args.dry_run:
        print("\nDRY RUN — nothing written.")
        return 0
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(render(teams, rosters, full))
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
