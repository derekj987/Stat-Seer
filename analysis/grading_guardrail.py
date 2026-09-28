"""Fail loudly when the GRADING cannot be trusted — the track record is the product.

Derek: "Build the grading guardrail and fix all the bugs identified so this does not happen again."

The three guardrails already in the repo check that the model reflects the news. This one checks
the thing underneath: that the record we publish about ourselves was honestly computed. It exists
because the NCAAF report card failed twice in one weekend and neither failure looked like an error.

  1. It graded NOTHING. `byg` was built from card["games"], the CURRENT week, and the board rolls
     forward every six hours — so on Sunday morning Saturday's 65 games had already moved into
     card["weeks"] and were invisible. It printed "finals that day: 274 | on our published board:
     0" and blamed Division II. A zero that explains itself is the most durable kind of bug.

  2. Once it could see them, it graded THE FUTURE. cfb_export rebuilds every week in the file from
     ratings that now include the games just played: of 71 week-4 games, 70 projections and 53
     PICKS changed after kickoff. Graded that way the slate scored 55-10 against the spread — 85%
     — and the only thing that caught it was that 85% is not a number anyone should believe.

THE CHECKS, and what each one would have caught:

  A. HINDSIGHT       the artifact grading reads must predate the games        (bug 2)
  B. AGREEMENT       the same slate, graded from the published board and from the working copy,
                     must produce the same record — any gap IS hindsight, measured   (bug 2)
  C. COVERAGE        finals exist on our board for that day, and we graded them       (bug 1)
  D. PLAUSIBILITY    no published record above what the sport allows                  (bug 2)
  E. LEDGER          NFL: nothing graded that was published after kickoff, no double grades

A and E are structural — they ask whether grading COULD be honest. B and D are empirical — they
ask whether the answer looks like one. C is the zero-detector.

Exit code 1 on any FAIL.

    python analysis/grading_guardrail.py --date 2026-09-26
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "analysis"))
sys.path.insert(0, os.path.join(ROOT, "ingest"))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

CARD_PATH = "web/app/ncaaf/model-data.ts"
PROJ_PATH = "web/lib/ncaafPlayerProjections.ts"
# What a real board can do against the number. Break-even at the vig is 52.4%; the best documented
# long-run handicappers live in the 53-57% band. Anything at or past this on a real sample is a
# grading bug until proven otherwise -- that is the whole lesson of the 85%.
ATS_CEILING = 0.65
ATS_MIN_N = 30

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


def git_blob(path, before_iso):
    sha = subprocess.run(["git", "log", "--format=%H", f"--before={before_iso}", "-1", "--", path],
                         capture_output=True, text=True).stdout.strip()
    if not sha:
        return "", "", None
    blob = subprocess.run(["git", "show", f"{sha}:{path}"],
                          capture_output=True, text=True, encoding="utf-8").stdout
    when = subprocess.run(["git", "log", "-1", "--format=%cI", sha],
                          capture_output=True, text=True).stdout.strip()
    return blob, sha, when


def parse_card(s):
    m = re.search(r"export const NCAAF_MODEL[^=]*=\s*", s)
    if not m:
        return None
    return json.loads(s[s.index("{", m.end() - 1): s.rindex("}") + 1])["card"]


def games_on(card, day):
    """Every board game whose kickoff falls on `day` (ET), across ALL weeks."""
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    out = {}
    weeks = card.get("weeks") or [{"games": card.get("games", [])}]
    for wk in weeks:
        for g in wk.get("games", []):
            c = g.get("commence")
            if not c:
                continue
            try:
                d = dt.datetime.fromisoformat(c.replace("Z", "+00:00")).astimezone(et)
            except ValueError:
                continue
            if d.strftime("%Y-%m-%d") == day:
                out[(g["away"], g["home"])] = g
    return out


def ats_record(board, finals):
    """(wins, losses) of the published pick against the market number."""
    w = l = 0
    for k, g in board.items():
        fin = finals.get(k)
        pick, ms = g.get("pick"), g.get("marketSpread")
        if not fin or not pick or not ms:
            continue
        ap, hp = fin
        marg = (hp - ap) if pick["side"] == k[1] else (ap - hp)
        res = marg + pick["num"]
        if abs(res) < 1e-9:
            continue
        w, l = (w + 1, l) if res > 0 else (w, l + 1)
    return w, l


def cfbd_finals(day, key):
    import cfbd_client as cc
    out = {}
    for wk in range(1, 20):
        st, games = cc.cfbd_get("/games", {"year": int(day[:4]), "week": wk,
                                           "seasonType": "regular"}, key)
        if st != 200 or not isinstance(games, list):
            continue
        from zoneinfo import ZoneInfo
        et = ZoneInfo("America/New_York")
        for g in games:
            sd = g.get("startDate") or g.get("start_date")
            hp = g.get("homePoints", g.get("home_points"))
            ap = g.get("awayPoints", g.get("away_points"))
            if not sd or hp is None or ap is None:
                continue
            try:
                d = dt.datetime.fromisoformat(str(sd).replace("Z", "+00:00")).astimezone(et)
            except ValueError:
                continue
            if d.strftime("%Y-%m-%d") != day:
                continue
            a = g.get("awayTeam") or g.get("away_team")
            h = g.get("homeTeam") or g.get("home_team")
            out[(a, h)] = (int(ap), int(hp))
    return out


def grader_record(day):
    """Run the real grader and read its SPREAD TOTAL back. Independent of how it gets there — the
    point is which ANSWER it produces, not which code path it took."""
    r = subprocess.run([sys.executable, "grade_ncaaf_day.py", "--date", day],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.search(r"SPREAD TOTAL\s*:\s*(\d+)-(\d+)", r.stdout or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def check_ncaaf(day, key):
    say(f"## NCAAF — {day}")
    say()
    before = f"{day}T04:00:00Z"
    pub_blob, pub_sha, pub_when = git_blob(CARD_PATH, before)
    _, prj_sha, prj_when = git_blob(PROJ_PATH, before)

    # A. HINDSIGHT — what we grade from must predate the games.
    if not pub_blob.strip():
        fail(f"no committed {CARD_PATH} before {before}, so there is no record of what the site "
             "showed before kickoff and any grade for this day is hindsight")
        say()
        return
    ok(f"board as published: {pub_sha[:8]} committed {pub_when}")
    if prj_sha:
        ok(f"props as published: {prj_sha[:8]} committed {prj_when}")
    else:
        warn(f"no committed {PROJ_PATH} before {before}; prop grades for this day would be hindsight")

    pub = parse_card(pub_blob)
    cur = parse_card(open(CARD_PATH, encoding="utf-8").read())
    if pub is None or cur is None:
        fail("could not parse one of the two boards")
        say()
        return
    pub_g, cur_g = games_on(pub, day), games_on(cur, day)

    # C. COVERAGE — the zero-detector.
    fin = cfbd_finals(day, key)
    graded = [k for k in pub_g if k in fin]
    if not fin:
        warn("CFBD returned no finals for this day")
    elif not pub_g:
        fail(f"{len(fin)} finals that day and NOTHING on the published board — either the board "
             "genuinely had no games or the grader is looking at the wrong week; it cannot tell "
             "you which, which is exactly how this went unnoticed")
    elif not graded:
        fail(f"{len(pub_g)} board games and {len(fin)} finals, but ZERO joined — a name or key "
             "mismatch, not an empty slate")
    else:
        ok(f"{len(graded)} of {len(pub_g)} published games joined to a final")

    if not graded:
        say()
        return

    # B. WHICH FILE DID THE GRADER ACTUALLY READ?
    #
    # The obvious version of this check — "the published board and the working copy must agree" —
    # is wrong, and wrong in the way this project keeps having to relearn. cfb_export rebuilds
    # every week on every run, so the two will ALWAYS differ; a check keyed on that is red every
    # day on a system that is working, which is how you train someone to ignore it.
    #
    # What matters is not that the two differ. It is WHICH ONE THE GRADER USED. So compute both
    # independently here, then run the real grader and see which number it lands on. Matching the
    # working copy is the bug; matching the published board is the fix.
    pw, pl = ats_record(pub_g, fin)
    cw, cl = ats_record(cur_g, fin)
    say(f"         published board grades {pw}-{pl}; the rebuilt working copy grades {cw}-{cl} "
        f"(they differ by design — the file is regenerated every six hours)")
    got = grader_record(day)
    if got is None:
        warn("could not read a SPREAD TOTAL out of grade_ncaaf_day.py, so which board it used "
             "cannot be confirmed")
    elif got == (cw, cl) and (cw, cl) != (pw, pl):
        fail(f"grade_ncaaf_day.py returned {got[0]}-{got[1]}, which is the WORKING COPY's record, "
             f"not the published board's {pw}-{pl}. It is grading picks that were rebuilt after "
             "the games — load_card/load_proj must read the pre-kickoff commit.")
    elif got != (pw, pl):
        fail(f"grade_ncaaf_day.py returned {got[0]}-{got[1]} but the board as published grades "
             f"{pw}-{pl}. It is reading neither file cleanly.")
    else:
        ok(f"grader used the PUBLISHED board: {pw}-{pl}"
           + ("" if (pw, pl) != (cw, cl) else " (both files agree today, so this is weak evidence)"))

    # D. PLAUSIBILITY.
    n = pw + pl
    pr = pw / max(n, 1)
    if n >= ATS_MIN_N and pr >= ATS_CEILING:
        fail(f"published record {pw}-{pl} = {pr:.0%} against the spread on {n} games. Break-even "
             f"is 52.4% and the best documented handicappers live near 55%; {pr:.0%} is a grading "
             "bug until proven otherwise.")
    elif n >= ATS_MIN_N:
        ok(f"record {pw}-{pl} ({pr:.0%}) is within what the sport allows")
    else:
        warn(f"only {n} graded sides — too few to judge plausibility")
    say()


def check_nfl(env):
    say("## NFL — ledger integrity")
    say()
    from weekly_flags import sb
    res = sb(env, "prediction_results?select=prediction_id,outcome&limit=5000")
    if not res:
        warn("no rows in prediction_results yet")
        say()
        return
    ids = [r["prediction_id"] for r in res]
    dupes = len(ids) - len(set(ids))
    (ok if not dupes else fail)(
        f"{len(ids)} graded rows, {dupes} duplicate prediction_id"
        + ("" if not dupes else " — a prediction graded twice inflates the published record"))

    led = {r["id"]: r for r in sb(
        env, "prediction_ledger?section=eq.MODEL&select=id,published_at,commence_time&limit=5000")}
    late = 0
    for pid in set(ids):
        r = led.get(pid)
        if not r or not r.get("published_at") or not r.get("commence_time"):
            continue
        if str(r["published_at"]) >= str(r["commence_time"]):
            late += 1
    (ok if not late else fail)(
        f"{late} graded prediction(s) published at or after kickoff"
        + ("" if not late else " — the ledger CHECK should make this impossible, so a non-zero "
                              "count means the constraint is gone or the join is wrong"))
    say()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYY-MM-DD in ET; default yesterday")
    args = ap.parse_args()
    day = args.date or (dt.date.today() - dt.timedelta(days=1)).isoformat()

    say(f"# Grading guardrail — {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC")
    say()
    try:
        import odds_client as oc
        oc.ensure_ssl_certs()
        key = oc.load_env().get("CFBD_API_KEY")
    except Exception as e:  # noqa: BLE001
        key = None
        warn(f"could not load the CFBD key ({e})")
    if key:
        try:
            check_ncaaf(day, key)
        except Exception as e:  # noqa: BLE001
            fail(f"the NCAAF grading checks could not run ({e})")
    else:
        warn("no CFBD_API_KEY — skipping the NCAAF grading checks")

    try:
        import injuries_nflverse as ie
        env = ie.load_env()
        ie.ensure_ssl()
        check_nfl(env)
    except Exception as e:  # noqa: BLE001
        fail(f"the NFL ledger checks could not run ({e})")

    say("---")
    if FAILS:
        say(f"**{len(FAILS)} FAILURE(S)** — the published record cannot be trusted as computed:")
        for f in FAILS:
            say(f"- {f}")
    elif WARNS:
        say(f"No failures. {len(WARNS)} warning(s), which do not fail the run.")
    else:
        say("**All clear.** Grading reads what was published, joins what it should, and the "
            "record is inside what the sport allows.")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("\n".join(OUT_LINES) + "\n")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
