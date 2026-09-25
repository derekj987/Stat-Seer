"""Fail loudly when a starter is out and the model has not noticed.

Derek: "I do not want to ask every day 'Hey Player X is now out for the season. Do you know this and
have our numbers been updated?'"

This is the assertion that would have caught the Jaxson Dart case by itself, the day it happened.
He went on injured reserve, which drops a player OFF the weekly injury report entirely, so the
model's adjustment for New York stayed at +0.00 and the site went on publishing a number three
points clear of the market all week. Nothing was broken loudly enough to notice.

It checks the WHOLE CHAIN, because any one link breaking looks identical from the outside:

    A. NEWS -> ADJUSTMENT   a starter is unavailable, and the model subtracts nothing for his team
    B. ADJUSTMENT -> PAGE   the model's current margin and the latest PUBLISHED margin disagree
    C. FEED FRESHNESS       the availability capture or the practice report has gone quiet

A is the Dart failure. B is the publisher-skips-already-published failure that kept the corrected
number off the site even once the model had it right. C is the one that makes both of the others
impossible to spot, because an empty feed and a healthy league look the same.

Exit code 1 on any FAIL, so the workflow that runs it goes red and sends mail. WARN does not fail
the run: a back-up receiver missing with no measurable adjustment is normal and should not train
anyone to ignore this.

    python analysis/injury_guardrail.py
    python analysis/injury_guardrail.py --week 3
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "analysis"))
sys.path.insert(0, os.path.join(ROOT, "ingest"))
sys.path.insert(0, ROOT)

from weekly_flags import depth_chart, norm, sb, slot_of  # noqa: E402

# Out-type designations. Questionable is deliberately absent: it is a game-time decision, not an
# absence, and alerting on it would fire on half the league every Friday. Measured over 2016-2026
# on players who take touches: Questionable plays 60% of the time, Doubtful does not play 99.1% of
# the time -- indistinguishable from Out, which is why DOUBTFUL counts here. See injury_adj.NEWS_OUT
# for the full table; these two sets must agree or the check and the model disagree about who is
# even absent.
OUT_LIKE = {"OUT", "IR", "PUP", "NFI", "DNR", "SUS", "DOUBTFUL"}
# How much the model must subtract before we accept that it has noticed. A quarterback is the only
# position where the coefficient is big enough to demand a real number; everything else is a WARN,
# because injury_adj's own measurement found RB/WR/TE individually insignificant.
QB_MIN_POINTS = 1.0
OTHER_MIN_POINTS = 0.2
# The publisher's own threshold. If the live model and the published number differ by more than
# this, a revision was due and did not happen.
STALE_MARGIN = 0.75
# How old the newest availability CHANGE may be before it is worth a mention.
#
# This is a WARN, not a FAIL, and the distinction cost a false alarm on the guardrail's first real
# run. `sleeper_availability` is written only when something CHANGES -- the capture's own log line
# for a quiet run is "nothing to write" -- so the newest row's timestamp is when the league last
# had news, NOT when the job last ran. capture-sleeper.yml runs every 4h; it ran successfully at
# 13:36, wrote nothing because nothing had changed, and this check failed the whole workflow at
# 18:09 for a feed that was working perfectly.
#
# A check that goes red on a healthy system is worse than no check, because it teaches you to
# ignore the red. The table cannot answer "did the job run" -- it has no heartbeat row -- so this
# no longer pretends to ask that. 12h is a provisional bound: news does not stay quiet much longer
# than that mid-season, but the table has only a day of history so far, so re-derive it from the
# real distribution of gaps once there is a season of them.
FEED_MAX_AGE_H = 12.0

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


def _gsis_map(season):
    """{(normalised name, team): gsis_id} from the season roster.

    Needed because the feeds name players and the model's shares are keyed on gsis."""
    import pandas as pd
    path = os.path.join(ROOT, "data", f"roster_{season}.csv")
    if not os.path.exists(path):
        try:
            import injury_adj
            injury_adj._news_out(season)          # side effect: caches the roster to disk
        except Exception:  # noqa: BLE001
            return {}
    if not os.path.exists(path):
        return {}
    ros = pd.read_csv(path, low_memory=False)
    return {(norm(r.full_name), str(r.team)): str(r.gsis_id)
            for _, r in ros.iterrows() if pd.notna(r.get("gsis_id"))}


def check_news_to_adjustment(env, season, week, depth):
    """A. Someone the feeds call unavailable, whose USAGE the model is not docking his team for.

    Two design mistakes were made here before this worked, and both are worth keeping:

    KEY ON USAGE SHARE, NOT ON A DEPTH SLOT. The first version asked "is a QB1 unavailable", which
    cannot catch the case it was written for: the depth chart DEMOTES a player the moment he lands
    on injured reserve, so Jaxson Dart already read QB2 and Jameis Winston read QB1. By the time the
    guardrail looked, the chart agreed the starter was fine.

    READ THE FEED DIRECTLY, NOT THROUGH THE THING BEING CHECKED. The second version rebuilt its
    out-list by calling injury_adj's own helpers. Disabling the news merge to test it made the model
    AND the check blind at the same instant, so it reported all-clear on the exact failure it
    exists to catch. A check that shares a dependency with its subject is an echo. This one reads
    `sleeper_availability_current` and `practice_reports` straight from the database, so it still
    sees the player even when the model has lost him."""
    say("## A. Is every unavailable STARTER reflected in the model?")
    say()
    try:
        import injury_adj
        adj = injury_adj.team_adjustment(season, week)
        u = injury_adj._usage_for(season)
    except Exception as e:  # noqa: BLE001
        fail(f"injury adjustment could not be computed at all ({e})")
        say()
        return
    # The INPUT check, before any conclusion is drawn from the output.
    #
    # team_adjustment() answers "no absences" and "I cannot see any absences" with the same empty
    # dict, by design -- a backtest season with no usage file must predict unadjusted rather than
    # crash. On the LIVE path those two are opposites, and the difference is a published number.
    #
    # This is what actually broke: data/ is gitignored and publish-predictions.yml never fetched
    # the stats CSVs, so load_usage() returned None on every scheduled run and the whole adjustment
    # silently evaluated to {}. The first version of this check then did `_shares(None, ...)` and
    # died with 'NoneType' object has no attribute 'season' -- which at least went red, but named
    # the messenger instead of the message.
    if u is None or not len(u):
        fail(f"no usage data for {season} — data/stats_{season}.csv and stats_{season - 1}.csv are "
             "missing, so injury_adj.load_usage() returns None, team_adjustment() returns {} and "
             "EVERY prediction is published with no injury adjustment at all. This is silent: the "
             "model does not error, it just prices a team as though nobody were hurt.")
        say()
        return False
    sh = injury_adj._shares(u, season, week)

    # INDEPENDENT out-set, straight from the tables.
    rows = sb(env, "sleeper_availability_current?select=player,team,status"
                   "&status=not.is.null&limit=2000")
    prac = sb(env, f"practice_reports?select=scraped_name,team,game_status&season=eq.{season}"
                   f"&week=eq.{week}&game_status=in.(OUT,IR)")
    named = {(norm(r["player"]), r["team"]) for r in rows
             if str(r.get("status") or "").upper() in OUT_LIKE}
    named |= {(norm(r["scraped_name"]), r["team"]) for r in prac
              if r.get("scraped_name") and r.get("team")}
    if not named:
        fail("neither feed lists a single unavailable player — that is a broken feed, not a "
             "healthy league")
        say()
        return False

    gmap = _gsis_map(season)
    out_by_team = {}
    for nm, team in named:
        g = gmap.get((nm, team))
        if g:
            out_by_team.setdefault(team, set()).add(g)

    flagged = 0
    for team, ids in sorted(out_by_team.items()):
        expected = 0.0
        biggest = None
        for pos, coef in injury_adj.COEF.items():
            for pid, share in sh.get((team, pos), {}).items():
                if pid in ids and share >= injury_adj.MIN_SHARE:
                    expected += coef * share
                    if biggest is None or share > biggest[1]:
                        biggest = (pos, share)
        actual = float(adj.get(team, 0.0))
        if expected >= -0.05:
            continue                       # nobody material out for this team
        flagged += 1
        if abs(expected - actual) > 0.5:
            fail(f"{team}: the feeds say {expected:+.2f} pts of usage is unavailable but the model "
                 f"subtracts {actual:+.2f}. Someone out is not being counted — an IR move drops a "
                 f"player off the injury report entirely, so check the news feed is merged in.")
        elif biggest and biggest[0] == "QB" and biggest[1] >= 0.40 and actual > -QB_MIN_POINTS:
            fail(f"{team}: a quarterback holding {biggest[1]:.0%} of the attempts is unavailable "
                 f"and the model subtracts only {actual:+.2f} pts.")
        else:
            ok(f"{team} {actual:+.2f} pts for {biggest[0]} usage {biggest[1]:.0%} unavailable")
    if not flagged:
        warn("no team has materially-used players unavailable — plausible early in a week, "
             "suspicious by Sunday")
    else:
        say(f"  checked {flagged} teams carrying a material absence")
    say()
    return True


def check_published_is_current(env, season, week, data_ok=True):
    """B. The model's number now, against the number the site is serving.

    `data_ok` is not decoration. This check recomputes the model IN THE SAME PROCESS that publishes
    it, so when the environment is missing the usage data both sides go blind together and the
    comparison agrees -- on the wrong number. That is exactly what it did the day the injury
    adjustment was silently off: check A crashed, and B printed "every unplayed game's published
    margin is within 0.75 of the live model" while the site served NYG at +6.0 with a quarterback
    on injured reserve.

    A comparison between two copies of the same broken thing is an echo, not a check. When A says
    the inputs are gone, B declines to certify rather than passing."""
    say("## B. Does the PUBLISHED number match the model?")
    say()
    if not data_ok:
        warn("not comparing — check A found the model's injury inputs missing, and this check "
             "recomputes the model in the same process. Both sides would be blind in the same "
             "way and agree with each other. Fix A first; this says nothing until then.")
        say()
        return
    try:
        import game_model as gm
        g = gm.load(os.path.join(ROOT, "data", "games.csv"))
        preds = gm.predict_week(g, season, week)
    except Exception as e:  # noqa: BLE001
        warn(f"could not recompute the model to compare ({e})")
        say()
        return
    rows = sb(env, f"prediction_ledger?section=eq.MODEL&season=eq.{season}&week=eq.{week}"
                   "&select=event_id,subject,published_at,commence_time,reasoning"
                   "&order=published_at&limit=2000")
    if not rows:
        warn("nothing published for this week yet")
        say()
        return
    latest = {}
    for r in rows:                                    # ascending: last write per game wins
        latest[(r.get("subject"), str(r.get("commence_time"))[:10])] = r
    now = dt.datetime.now(dt.timezone.utc)
    stale = 0
    for p in preds:
        hit = next((r for k, r in latest.items() if k[0] == p["home"]), None)
        if not hit:
            continue
        kick = str(hit.get("commence_time") or "")
        try:
            if dt.datetime.fromisoformat(kick.replace("Z", "+00:00")) <= now:
                continue                              # already kicked off; the number is final
        except ValueError:
            pass
        was = (hit.get("reasoning") or {}).get("pred_margin")
        if was is None:
            continue
        if abs(float(p["pred_margin"]) - float(was)) >= STALE_MARGIN:
            stale += 1
            fail(f"{p['away']}@{p['home']}: model says {p['pred_margin']:+.1f}, the site is "
                 f"publishing {float(was):+.1f} — a revision was due and did not publish")
    if not stale:
        ok(f"every unplayed game's published margin is within {STALE_MARGIN} of the live model")
    say()


def check_feeds(env, season, week):
    """C. The feeds that make A and B possible."""
    say("## C. Are the feeds actually running?")
    say()
    avail = sb(env, "sleeper_availability_current?select=captured_at"
                    "&order=captured_at.desc&limit=1")
    if not avail:
        fail("no rows in sleeper_availability — has ingest/sleeper_availability.sql been run, and "
             "is capture-sleeper.yml green?")
    else:
        seen = dt.datetime.fromisoformat(avail[0]["captured_at"].replace("Z", "+00:00"))
        age = (dt.datetime.now(dt.timezone.utc) - seen).total_seconds() / 3600
        (ok if age < FEED_MAX_AGE_H else warn)(
            f"newest availability CHANGE is {age:.1f}h old")
    rep = sb(env, f"practice_reports?select=team&season=eq.{season}&week=eq.{week}&limit=2000")
    teams = len({r["team"] for r in rep})
    (ok if teams >= 2 else warn)(f"practice report has {teams} teams filed for week {week}")
    say()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--week", type=int)
    args = ap.parse_args()

    import injuries_nflverse as inj_env
    env = inj_env.load_env()
    inj_env.ensure_ssl()

    week = args.week
    if not week:
        from weekly_flags import projections
        week, _ = projections()
    if not week:
        print("no week to check", file=sys.stderr)
        return 0

    say(f"# Injury guardrail — {args.season} week {week}")
    say()
    say(f"_ran {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC_")
    say()
    depth = depth_chart()
    data_ok = check_news_to_adjustment(env, args.season, week, depth)
    check_published_is_current(env, args.season, week, data_ok=bool(data_ok))
    check_feeds(env, args.season, week)

    say("---")
    if FAILS:
        say(f"**{len(FAILS)} FAILURE(S)** — the model is not reflecting what the feeds know:")
        for f in FAILS:
            say(f"- {f}")
    elif WARNS:
        say(f"No failures. {len(WARNS)} warning(s), which do not fail the run.")
    else:
        say("**All clear.** Every unavailable starter is priced, and the site matches the model.")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("\n".join(OUT_LINES) + "\n")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
