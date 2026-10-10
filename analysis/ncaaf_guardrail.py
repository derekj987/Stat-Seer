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
  E. LEAN             a market's projections sit over the book's number far more often than half

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
#
# 🚨 THE ALLOWANCE HAS TO MATCH HOW OFTEN THE FILE CHANGES, NOT HOW OFTEN THE JOB RUNS. These
# workflows commit only when the generated file actually differs, so a file whose CONTENT is stable
# shows no commit however faithfully the job ran. ncaafDepth.ts is the one that bites: the scrape
# runs twice a day and succeeds, but a depth chart that nobody edited produces an identical file and
# no commit. Measured over its last 14 gaps — 10.7, 12.0, 12.0, 12.1, 12.2, 12.5, 13.5, 23.6, 23.9,
# 24.2, 24.3, 36.1, 84.1h — FIVE exceed 20h, and the 84h one failed this job eight times in a row
# (Sep 28-30) while refresh-cfb-player-proj was green on every single run.
#
# That is a check red for a reason unrelated to what it guards, which is the failure mode that
# teaches people to ignore the red ones. 96h still catches a genuinely dead scraper within a day of
# it mattering, because a depth chart really does move every game week.
#
# I left the projections file at 20h on the reasoning that its numbers move whenever a book line
# moves, so it changes on essentially every run. MEASURED, AND WRONG: its last 15 gaps run 0.6, 5.3,
# 5.6, 10.1, 10.7, 11.0, 11.6, 11.8, 11.8, 12.0, 12.1, 12.4, 13.6, 24.1, 27.7h — two of fifteen over
# 20h, and the 27.7h one failed this job on Oct 5. Early in the week the next slate's props have not
# posted, so the file is genuinely identical and nothing is committed. Same structural trap as the
# depth chart, one step less obvious. 36h is three missed runs against a twice-daily cron.
ARTIFACTS = [(MODEL_DATA, 10.0), ("web/lib/ncaafPlayerProjections.ts", 36.0),
             ("web/lib/ncaafDepth.ts", 96.0)]
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


def check_one_scale():
    """Every published yardage number should be the SAME statistic.

    The board builds rows on three paths and only two of them call `to_fifty_fifty`, so the second
    pass — players the market priced but the depth chart never listed — publishes a recency-weighted
    MEAN beside a line the book set near a MEDIAN. Ja'Kyrian Turner carried both at once: his
    rush_yds converted, his rec_yds did not.

    It is invisible from outside, which is why it survived — both numbers look like yards. It is
    visible in the data only because `mu` (the pre-conversion mean) is now stored, and a row that
    was never converted is exactly one where mu == proj.

    It was a WARN for exactly one day, while 38% of rows were still raw and a red every morning
    would have trained everyone to ignore it. The second pass now converts, so the board is on one
    scale and a red here means a REGRESSION rather than a backlog — which is the condition under
    which it is worth failing the job, so it does.
    """
    rows = _ncaaf_rows()
    yd = [r for r in rows if r.get("market") in ("rec_yds", "rush_yds", "pass_yds")
          and r.get("mu") is not None and r.get("proj") is not None]
    if not yd:
        warn("no rows carry `mu` yet — regenerate the board to enable the published-scale check")
        return
    # 🚨 A CONVERSION THAT IS A NO-OP BY DESIGN IS NOT A SKIPPED CONVERSION. to_fifty_fifty returns
    # a non-positive mu untouched (`if not r or mu is None or mu <= 0: return mu`) — scaling a
    # negative number by 0.72 would make it LESS negative, which is meaningless — so mu == proj is
    # the correct outcome there, not evidence the row missed the conversion.
    #
    # This failed the job on exactly one row of 380: a Michigan State QB at mu = -6.6 rushing yards,
    # which is a real number in college (sacks are charged against rushing). Equality cannot tell
    # "declined by design" from "never ran", so the rows the conversion declines are excluded rather
    # than the test being loosened. Checking `proj == to_fifty_fifty(mu)` directly would be stronger
    # still, but it means importing cfb_player_proj, and this file stays stdlib-only on purpose.
    yd = [r for r in yd if r["mu"] > 0]
    if not yd:
        ok("published scale: no positive-mu yardage rows to check")
        return
    raw = [r for r in yd if abs(r["mu"] - r["proj"]) < 1e-9]
    if not raw:
        ok(f"published scale: all {len(yd)} yardage rows went through the 50/50 conversion")
        return
    fail(f"published scale: {len(raw)} of {len(yd)} yardage rows "
         f"({100.0 * len(raw) / len(yd):.0f}%) are a raw MEAN rather than a 50/50 number — some "
         f"emit path is skipping to_fifty_fifty again (EMPIRICAL_REFERENCE §13a)")


# Markets whose projection should sit near the book's number about half the time. anytime_td is
# NOT here: a TD projection is a probability and sits near 32-37% over by construction, so holding
# it to 50% would fire forever on a non-problem (the NFL flag report learned the same thing).
LEAN_MARKETS = ("rec_yds", "rush_yds", "pass_yds", "receptions", "pass_tds", "rush_att")
LEAN_MIN_N = 40          # below this a lean is noise, not a signal
# 🚨 THESE BANDS WARN; THEY CANNOT PROVE. At n=198 the standard error on a 50% rate is about
# 3.6 points, so one market at 45.5% is ~1.3 SE from fair — real enough to look at, nowhere near
# enough to fail a job on. The 2026-10-09 regression was 3-4 points on every market at once, and
# the honest statement is that no single-week test can call that significant market by market.
# What catches it is the POOLED line below plus a human reading three markets that all moved the
# same way, which is why this check reports every market every run instead of staying silent when
# it is happy. FAIL is reserved for a lean too large to be sampling noise at any of these sizes.
LEAN_WARN = (46.0, 54.0)
LEAN_FAIL = (40.0, 60.0)
# The markets that carry the mean->median conversion and should each sit near 50%. Pooled, they
# are the single most sensitive thing available in one week's board: a global bias moves all of
# them together, while one genuinely mispriced market moves only itself.
LEAN_POOL = ("rec_yds", "rush_yds", "pass_yds")

# 🚨 KNOWN-MISCALIBRATED, AND DELIBERATELY ONLY A WARNING. These two have leaned over since the
# median conversion was fitted (receptions ~63%, pass_tds ~57%) because neither carries a
# conversion — the receptions bands were fitted and REJECTED on backtest (they did not clear the
# bar), so nothing corrects them yet. They are listed rather than silently excluded, and they warn
# loudly every run. Failing the job on a pre-existing issue is how a red stops meaning anything,
# which is the one outcome a guardrail must never produce. Delete an entry the day it is refitted.
LEAN_WARN_ONLY = {"receptions": "bands fitted and rejected on backtest — no conversion applied",
                  "pass_tds": "no conversion applied"}


def check_lean():
    """Is the board leaning one way, per market?

    🚨 THIS EXISTS BECAUSE DEREK CAUGHT A REGRESSION BY EYE THAT NOTHING ELSE WOULD HAVE CAUGHT.
    On 2026-10-09 an asymmetric role-pull shipped at CFB_ASYM=0.5 — fitted on low-usage receivers,
    where it genuinely improves MAE, but applied to every player sitting under their role baseline
    and only ever downward. Receiving yards went from 49.0% over (median proj/book 1.000) to 45.5%,
    and every other market moved the same direction with it. The board was quietly under-leaning
    for a day. No check here looked at the numbers the board publishes, only at coverage and
    staleness, so the first and only alarm was a person looking at it.

    LEAN IS MEASURED PER MARKET, NEVER POOLED. Pooling hides exactly this: anytime_td's structural
    30% and receptions' 63% average out to something that looks fine while both are wrong.
    """
    rows = _ncaaf_rows()
    by = {}
    for r in rows:
        mk, p, b = r.get("market"), r.get("proj"), r.get("book")
        if mk in LEAN_MARKETS and p is not None and b:
            by.setdefault(mk, []).append(1 if p > b else 0)
    if not by:
        warn("no priced rows to measure lean on")
        return
    for mk in sorted(by, key=lambda m: -len(by[m])):
        hits = by[mk]
        n = len(hits)
        if n < LEAN_MIN_N:
            continue
        pct = sum(hits) / n * 100.0
        if LEAN_WARN[0] <= pct <= LEAN_WARN[1]:
            say(f"- lean `{mk}` {pct:.1f}% over ({n} rows) — balanced")
            continue
        note = LEAN_WARN_ONLY.get(mk)
        msg = (f"`{mk}` leans {pct:.1f}% over across {n} priced rows "
               f"(a fair board sits near 50%)")
        if note:
            warn(msg + f" — known: {note}")
        elif LEAN_FAIL[0] <= pct <= LEAN_FAIL[1]:
            warn(msg)
        else:
            fail(msg + " — a board where one market leans this hard is a projection bug, not a read")

    # Pooled across the conversion-carrying yardage markets. Reported every run, warned on when it
    # drifts, because a global bias shows here before it is provable in any one market.
    pool = [h for mk in LEAN_POOL for h in by.get(mk, [])]
    if len(pool) >= LEAN_MIN_N:
        n = len(pool)
        pct = sum(pool) / n * 100.0
        se = 50.0 / (n ** 0.5)
        sigma = abs(pct - 50.0) / se if se else 0.0
        line = (f"lean POOLED {'/'.join(LEAN_POOL)} {pct:.1f}% over ({n} rows, "
                f"{sigma:.1f} SE from fair)")
        if LEAN_WARN[0] <= pct <= LEAN_WARN[1]:
            say(f"- {line} — balanced")
        else:
            warn(line + " — every conversion-carrying market drifting the same way is the "
                        "fingerprint of a board-wide bias, not of one mispriced market")


def _ncaaf_rows():
    """The generated board, parsed.

    🚨 PARSED HERE RATHER THAN BY IMPORTING weekly_flags, which is what the first version did to
    avoid repeating four lines of regex. weekly_flags imports pandas at module level, and
    refresh-cfb-ratings.yml installs only `numpy certifi` — so reusing it took a guardrail that
    needs nothing but the standard library and gave it a heavyweight dependency the job does not
    have. The run died with ModuleNotFoundError: No module named 'pandas' AFTER the ratings and
    the card had already been written and committed, so the work was fine and only the check that
    confirms it was lost.
    A guardrail must not be able to fail for a reason unrelated to what it guards. Three duplicated
    lines are cheaper than an import graph, and this file deliberately stays stdlib-only.
    """
    path = os.path.join(ROOT, "web/lib/ncaafPlayerProjections.ts")
    if not os.path.exists(path):
        return []
    txt = open(path, encoding="utf-8").read()
    return [json.loads(m.group(0))
            for m in re.finditer(r'\{"game":.*?\}(?=,\n|\n\])', txt, re.S)]


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
    check_one_scale()
    check_lean()

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
