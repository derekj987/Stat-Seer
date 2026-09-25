"""Fail loudly when tonight's baseball board is out of date with tonight's baseball.

The football sibling is analysis/injury_guardrail.py and the reasoning is identical: Derek should
not have to ask "player X is out, do we know?" -- but MLB fails in a different place, so the checks
are different, and copying the football ones across would have produced three that cannot fire.

WHERE FOOTBALL BREAKS: a news feed knows a starter is unavailable and the injury adjustment does
not merge him, so a published margin prices a team as though nobody were hurt.

WHERE BASEBALL BREAKS: there is no injury merge to get wrong. mlb_availability.py is wired straight
into the game model and the props, so an absence that the feed knows about is already priced. What
baseball has instead is a DAILY REGENERATION and a slate that changes during the day:

  A. SLATE COVERAGE   a game is on tonight and has no row in our board at all
  B. FRESHNESS        the generated files are yesterday's, so the board describes last night
  C. STARTING PITCHER the probable starter changed, or was announced, after our last refresh

C is the one that matters most and the one that is easiest to miss. mlb_game_model's own held-out
numbers say team quality is worth 0.0% and "only the starting pitcher adds anything" -- and
sp_factor() returns 1.0, a league-average arm, when the starter is unknown. So a game with a blank
starter is not a slightly worse projection, it is the league mean with a model's name on it, shown
on the board with nothing to say so.

Measured writing this, 2026-09-25: of 16 upcoming games, 28 starters agreed with statsapi, 3 were
unannounced on both sides (fine), and one -- Jose Soriano, 3.5 hours before first pitch -- was
known to statsapi and blank in our file. 19 of 44 rows across the two-day board carried at least
one missing starter.

INDEPENDENCE. This reads statsapi.mlb.com directly rather than calling mlb_availability. The
football version learned that the hard way: its first draft rebuilt the out-list from the very
helpers it was checking, so disabling the news merge blinded the model and the check at the same
instant and it reported all-clear on the exact failure it existed to catch. A check that shares a
dependency with its subject is an echo.

Exit code 1 on any FAIL, so refresh-mlb-availability.yml goes red and sends mail.

    python analysis/mlb_guardrail.py
    python analysis/mlb_guardrail.py --hours 12
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "analysis"))
sys.path.insert(0, ROOT)

API = "https://statsapi.mlb.com/api/v1"
LIB = os.path.join(ROOT, "web", "lib")

# The refresh is daily, so anything past a day plus slack means a run was missed.
FILE_MAX_AGE_H = 26.0
# How close to first pitch a game has to be before a missing starter is a failure rather than a
# fact of life. Probables for tomorrow are routinely unannounced and that is not a defect.
SP_WINDOW_H = 12.0

GENERATED = [("mlbAvailability.ts", "MLB_AVAIL"), ("mlbGameModel.ts", "MLB_GAMES"),
             ("mlbStrikeouts.ts", "MLB_K"), ("mlbPlayerProps.ts", "MLB_PROPS")]

OUT_LINES: list[str] = []
FAILS: list[str] = []
WARNS: list[str] = []


def say(line=""):
    print(line)
    OUT_LINES.append(line)


def fail(msg):
    FAILS.append(msg)
    say(f"  [FAIL] {msg}")


def warn(msg):
    WARNS.append(msg)
    say(f"  [warn] {msg}")


def ok(msg):
    say(f"  [ok]   {msg}")


def load_generated(fname, const):
    """(generated-at, rows) from one of the AUTO-GENERATED web/lib files.

    Each export is a single very long line ending in '];', so this parses THAT LINE rather than
    the file -- and it anchors on '= [' rather than the first '[', because the first bracket on the
    line belongs to the type annotation (`MlbAvail[]`) and slicing from there yields '[] = [{...'
    which fails to parse with a thoroughly unhelpful "Extra data: line 1 column 4"."""
    path = os.path.join(LIB, fname)
    gen = None
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if gen is None and line.startswith("// Generated "):
                gen = line.split("// Generated ", 1)[1].strip()
            if line.startswith(f"export const {const}"):
                return gen, json.loads(line[line.index("= [") + 2:line.rindex("]") + 1])
    return gen, []


def statsapi_days(days=2):
    """Tonight's and tomorrow's schedule, straight from the source. One call per date."""
    out = []
    now = dt.datetime.now(dt.timezone.utc)
    for off in range(days):
        d = (now + dt.timedelta(days=off)).strftime("%Y-%m-%d")
        url = f"{API}/schedule?sportId=1&date={d}&hydrate=lineups,probablePitcher"
        j = json.load(urllib.request.urlopen(url, timeout=60))
        for day in j.get("dates", []):
            out.extend(day.get("games", []))
    return out


def upcoming(live):
    """Games not yet started. A final game's projection is history and must not be alerted on."""
    return [g for g in live
            if g.get("status", {}).get("abstractGameState") == "Preview"]


def check_coverage(live, games):
    say("## A. Is every upcoming game on the board?")
    say()
    up = upcoming(live)
    if not up:
        warn("statsapi lists no upcoming games — plausible off-season or between slates, "
             "suspicious in July")
        say()
        return
    ours = {str(g["gameKey"]) for g in games}
    missing = [g for g in up if str(g["gamePk"]) not in ours]
    for g in missing:
        fail(f"{g['teams']['away']['team']['name']} @ {g['teams']['home']['team']['name']} "
             f"({g['gamePk']}, {g['gameDate'][:16]}) is on tonight and has no row in the game "
             "model — the board simply does not show this game")
    if not missing:
        ok(f"all {len(up)} upcoming games have a row")
    say()


def check_freshness():
    say("## B. Were the files regenerated?")
    say()
    now = dt.datetime.now(dt.timezone.utc)
    for fname, const in GENERATED:
        try:
            gen, rows = load_generated(fname, const)
        except Exception as e:  # noqa: BLE001
            fail(f"{fname} could not be read or parsed ({e})")
            continue
        if not gen:
            warn(f"{fname} carries no '// Generated' stamp, so its age cannot be checked")
            continue
        age = (now - dt.datetime.fromisoformat(gen)).total_seconds() / 3600
        if age > FILE_MAX_AGE_H:
            fail(f"{fname} was generated {age:.1f}h ago — the daily refresh has not run, so this "
                 f"board describes a slate that has already been played ({len(rows):,} rows)")
        else:
            ok(f"{fname:22s} {age:5.1f}h old, {len(rows):,} rows")
    say()


def check_starters(live, games, window_h):
    """C. Whose starter do WE think it is, against whose starter it actually is."""
    say("## C. Does the board have tonight's starting pitchers?")
    say()
    ours = {str(g["gameKey"]): g for g in games}
    now = dt.datetime.now(dt.timezone.utc)
    agree = blank_both = 0
    checked = 0
    for g in upcoming(live):
        mine = ours.get(str(g["gamePk"]))
        if not mine:
            continue                       # already reported by check A
        try:
            kick = dt.datetime.fromisoformat(g["gameDate"].replace("Z", "+00:00"))
        except ValueError:
            continue
        hrs = (kick - now).total_seconds() / 3600
        if hrs > window_h:
            continue                       # tomorrow's probables are not announced yet; fine
        checked += 1
        for side, fld in (("home", "homeSpName"), ("away", "awaySpName")):
            real = (g["teams"][side].get("probablePitcher") or {}).get("fullName") or ""
            mine_sp = mine.get(fld) or ""
            tag = (f"{g['teams']['away']['team']['name']} @ "
                   f"{g['teams']['home']['team']['name']} ({side})")
            if not real and not mine_sp:
                blank_both += 1
            elif real and not mine_sp:
                fail(f"{tag}: statsapi has {real} starting in {hrs:.1f}h and our board has no "
                     "starter at all. sp_factor() falls back to 1.0 for an unknown arm, so this "
                     "game is projected as a league-average start — and the starter is the only "
                     "input the game model measured any gain from.")
            elif real and real != mine_sp:
                fail(f"{tag}: statsapi has {real} starting in {hrs:.1f}h, our board has "
                     f"{mine_sp} — a change we did not pick up, and the projection is built on "
                     "the wrong pitcher.")
            elif mine_sp and not real:
                warn(f"{tag}: we list {mine_sp} and statsapi now names nobody — usually a "
                     "postponement or a bullpen game being reclassified")
            else:
                agree += 1
    if not checked:
        warn(f"no game starts within {window_h:.0f}h, so there is nothing to check yet")
    else:
        ok(f"{agree} starters agree across {checked} games within {window_h:.0f}h "
           f"({blank_both} unannounced on both sides)")
    say()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=SP_WINDOW_H,
                    help="how close to first pitch a missing starter becomes a failure")
    args = ap.parse_args()

    try:
        import odds_client as oc
        oc.ensure_ssl_certs()
    except Exception:  # noqa: BLE001 — only needed on machines with a bare cert store
        pass

    say(f"# MLB guardrail — {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC")
    say()
    try:
        live = statsapi_days(2)
    except Exception as e:  # noqa: BLE001
        fail(f"statsapi could not be reached, so nothing can be checked against it ({e})")
        live = None

    try:
        _, games = load_generated("mlbGameModel.ts", "MLB_GAMES")
    except Exception as e:  # noqa: BLE001
        fail(f"the game model file could not be read ({e})")
        games = []

    if live is not None:
        check_coverage(live, games)
    check_freshness()
    if live is not None:
        check_starters(live, games, args.hours)

    say("---")
    if FAILS:
        say(f"**{len(FAILS)} FAILURE(S)** — tonight's board does not match tonight's baseball:")
        for f in FAILS:
            say(f"- {f}")
    elif WARNS:
        say(f"No failures. {len(WARNS)} warning(s), which do not fail the run.")
    else:
        say("**All clear.** Every upcoming game is on the board, the files are today's, and the "
            "starting pitchers match.")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("\n".join(OUT_LINES) + "\n")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
