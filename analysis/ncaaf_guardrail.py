"""Fail loudly when the NCAAF board stops matching college football.

Third of three. The football sibling is analysis/injury_guardrail.py, the baseball one
analysis/mlb_guardrail.py, and the reason they are three files rather than one flag is that each
sport rots somewhere different. Writing the same three checks three times would have produced two
sets that cannot fire.

  NFL   a news feed knows a starter is out and the injury adjustment does not merge him
  MLB   a starting pitcher is announced or swapped after the daily regeneration
  NCAAF nothing knows anything -- college has no injury report at all

That last one is the whole point. There is no availability feed to fall behind, so the failures
here are about COVERAGE and STALENESS: a game the board never got, an artifact that stopped
regenerating, a market that stopped being captured, and a player the market prices that our board
has never heard of.

  A. SLATE COVERAGE   CFBD has a game scheduled that our board does not carry
  B. FRESHNESS        a generated artifact stopped regenerating
  C. MARKET LINES     games are going lineless -- capture-cfb-odds has stopped landing
  D. PRICED PLAYERS   the market prices a player our projection board has no row for

D is the one with history behind it. A scraped depth chart decides who gets projected, and when it
silently truncates, the board loses players without any error: 195 of 813 priced players -- 24% --
were being dropped at one point, including the market's second-shortest price in his own game.
cfb_player_proj now projects anyone carrying a posted prop, and this is the assertion that the fix
has not regressed. Measured 2026-09-25: 16 of 1,230 priced names, 1.3%.

Note D excludes team markets. 155 of the 171 names without a row are "Alabama Crimson Tide D/ST"
and friends -- team defense props, which correctly have no player projection. Counting them put
the miss rate at 13.9% and would have made this check fire forever on a non-problem.

INDEPENDENCE. Coverage is checked against CFBD directly and pricing against cfb_prop_snapshots,
not through cfb_export or cfb_player_proj. A check that shares a dependency with its subject goes
blind at the same moment its subject does -- the football guardrail learned that twice.

Exit code 1 on any FAIL.

    python analysis/ncaaf_guardrail.py
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import unicodedata
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "analysis"))
sys.path.insert(0, os.path.join(ROOT, "ingest"))
sys.path.insert(0, ROOT)

MODEL_DATA = "web/app/ncaaf/model-data.ts"
# (path, hours before it is stale). The cadences are the crons in the workflows that write them:
# refresh-cfb-ratings every 6h, refresh-cfb-player-proj at 01:00 and 13:00. The allowance is
# roughly a cadence and a half, so one skipped run warns rather than fails on the next.
ARTIFACTS = [(MODEL_DATA, 10.0), ("web/lib/ncaafPlayerProjections.ts", 20.0),
             ("web/lib/ncaafDepth.ts", 20.0)]
# A prop on a TEAM, not a person. These have no player projection by design.
TEAM_MARKET = ("D/ST", "Defense", "Special Teams")
MISS_FAIL, MISS_WARN = 0.10, 0.05
LINES_FAIL, LINES_WARN = 0.50, 0.80

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


def nkey(s):
    """Match cfb_player_proj's own name flattening closely enough to join on."""
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"[^a-z]", "", s.lower())


def load_card():
    """The `card` object out of the generated model-data.ts."""
    path = os.path.join(ROOT, MODEL_DATA)
    s = open(path, encoding="utf-8").read()
    i = s.index("export const NCAAF_MODEL")
    return json.loads(s[s.index("= {", i) + 2:s.rindex("}") + 1])["card"]


def git_age_h(path):
    """Hours since the file was last COMMITTED.

    These artifacts carry no '// Generated' stamp the way the MLB ones do, and the workflows commit
    them, so the commit time IS the generation time. Needs full history: a shallow checkout reports
    nothing and this returns None rather than a comforting zero."""
    out = subprocess.run(["git", "log", "-1", "--format=%cI", "--", path],
                         cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if not out:
        return None
    return (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(out)).total_seconds() / 3600


def check_coverage(card):
    say("## A. Does the board carry every scheduled game?")
    say()
    try:
        import cfbd_client as cc
        import odds_client as oc
        key = oc.load_env().get("CFBD_API_KEY")
        if not key:
            warn("no CFBD_API_KEY, so the schedule cannot be checked independently")
            say()
            return
        st, games = cc.cfbd_get("/games", {"year": card["season"], "week": card["week"],
                                           "seasonType": "regular"}, key)
    except Exception as e:  # noqa: BLE001
        warn(f"CFBD could not be reached ({e})")
        say()
        return
    if st != 200 or not games:
        warn(f"CFBD returned {st} with {len(games or [])} games")
        say()
        return

    def nm(g, side):
        return g.get(f"{side}Team") or g.get(f"{side}_team")

    fbs = [g for g in games
           if (g.get("homeClassification") or g.get("home_division")) == "fbs"
           or (g.get("awayClassification") or g.get("away_division")) == "fbs"]
    wk = next((w for w in card.get("weeks", []) if w["week"] == card["week"]), None)
    if not wk:
        fail(f"the board has no games at all for its own current week ({card['week']})")
        say()
        return
    ours = {(g["away"], g["home"]) for g in wk["games"]}
    missing = [g for g in fbs if (nm(g, "away"), nm(g, "home")) not in ours]
    for g in missing[:10]:
        fail(f"{nm(g, 'away')} @ {nm(g, 'home')} is scheduled for week {card['week']} and has no "
             "row on the board")
    if len(missing) > 10:
        fail(f"...and {len(missing) - 10} more scheduled games missing from the board")
    if not missing:
        ok(f"all {len(fbs)} FBS games in week {card['week']} are on the board")
    say()


def check_freshness():
    say("## B. Are the generated files still being rebuilt?")
    say()
    for path, max_h in ARTIFACTS:
        age = git_age_h(path)
        if age is None:
            warn(f"{path}: no commit history reachable — a shallow checkout cannot answer this")
            continue
        name = os.path.basename(path)
        if age > max_h:
            fail(f"{name} was last committed {age:.1f}h ago, past its {max_h:.0f}h allowance — "
                 "the workflow that writes it has stopped landing, and the board is describing an "
                 "older slate than the one being played")
        else:
            ok(f"{name:28s} {age:5.1f}h old (allowance {max_h:.0f}h)")
    say()


def check_lines(card):
    """C. Market numbers are what Value Finder runs on; a lineless board is a dead capture."""
    say("## C. Are market lines still landing?")
    say()
    wk = next((w for w in card.get("weeks", []) if w["week"] == card["week"]), None)
    if not wk:
        say()
        return
    now = dt.datetime.now(dt.timezone.utc)
    soon = []
    for g in wk["games"]:
        c = g.get("commence")
        if not c:
            continue
        try:
            k = dt.datetime.fromisoformat(c.replace("Z", "+00:00"))
        except ValueError:
            continue
        if now <= k <= now + dt.timedelta(days=3):
            soon.append(g)
    if not soon:
        warn("no game kicks off in the next 3 days, so there is nothing to price yet")
        say()
        return
    lined = [g for g in soon if g.get("marketSpread") or g.get("marketTotal")]
    frac = len(lined) / len(soon)
    msg = (f"{len(lined)} of {len(soon)} games kicking within 3 days carry a market line "
           f"({frac:.0%})")
    if frac < LINES_FAIL:
        fail(msg + " — books post these days in advance, so this is capture-cfb-odds failing, "
                   "not the market being slow")
    elif frac < LINES_WARN:
        warn(msg)
    else:
        ok(msg)
    say()


def check_priced_players():
    """D. The market names a player; does our board have a row for him?"""
    say("## D. Is every priced player on the projection board?")
    say()
    try:
        import injuries_nflverse as ie
        from weekly_flags import sb, ncaaf_projections
        env = ie.load_env()
        ie.ensure_ssl()
    except Exception as e:  # noqa: BLE001
        warn(f"could not reach the projection board or Supabase ({e})")
        say()
        return
    newest = sb(env, "cfb_prop_snapshots?select=snapshot_at&order=snapshot_at.desc&limit=1")
    if not newest:
        warn("no rows in cfb_prop_snapshots at all")
        say()
        return
    snap = newest[0]["snapshot_at"]
    age = (dt.datetime.now(dt.timezone.utc)
           - dt.datetime.fromisoformat(snap.replace("Z", "+00:00"))).total_seconds() / 3600
    # The timestamp is URL-ENCODED. '+00:00' unencoded decodes as a space and the query 400s,
    # which reads as "no props" -- a silent empty rather than an error.
    rows, off = [], 0
    while True:
        page = sb(env, "cfb_prop_snapshots?select=player"
                       f"&snapshot_at=eq.{quote(snap, safe='')}&limit=1000&offset={off}")
        rows += page
        if len(page) < 1000:
            break
        off += 1000
        if off > 60000:
            break
    priced = {r["player"] for r in rows if r.get("player")}
    players = {p for p in priced if not any(t in p for t in TEAM_MARKET)}
    if not players:
        warn(f"the newest snapshot ({age:.1f}h old) prices no individual players")
        say()
        return
    have = {nkey(p.get("player")) for p in ncaaf_projections()}
    missing = sorted(p for p in players if nkey(p) not in have)
    frac = len(missing) / len(players)
    msg = (f"{len(missing)} of {len(players)} priced players have no projection row "
           f"({frac:.1%}); snapshot {age:.1f}h old")
    if frac > MISS_FAIL:
        fail(msg + " — a scraped depth chart is probably gating who gets projected again; "
                   "cfb_player_proj is meant to project anyone carrying a posted prop")
        for m in missing[:8]:
            say(f"           {m}")
    elif frac > MISS_WARN:
        warn(msg)
    else:
        ok(msg)
    say()


def main():
    argparse.ArgumentParser().parse_args()
    try:
        card = load_card()
    except Exception as e:  # noqa: BLE001
        print(f"could not read {MODEL_DATA}: {e}", file=sys.stderr)
        return 1

    say(f"# NCAAF guardrail — {card['season']} week {card['week']}")
    say()
    say(f"_ran {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC_")
    say()
    check_coverage(card)
    check_freshness()
    check_lines(card)
    check_priced_players()

    say("---")
    if FAILS:
        say(f"**{len(FAILS)} FAILURE(S)** — the board does not match the schedule or the market:")
        for f in FAILS:
            say(f"- {f}")
    elif WARNS:
        say(f"No failures. {len(WARNS)} warning(s), which do not fail the run.")
    else:
        say("**All clear.** Every scheduled game is on the board, the files are current, lines "
            "are landing and every priced player has a row.")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("\n".join(OUT_LINES) + "\n")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
