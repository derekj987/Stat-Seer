"""The questions Derek asks every week, answered before he has to ask them.

Derek: "we need to automate this so I am not asking these questions weekly."

Over this season the same four questions have come up by hand, every time about a different player:

    "I'm not seeing Jaxson Dart... also Caleb Williams"      -> who is out, and do we know it?
    "is ATL getting Penix back in the model?"                -> who is BACK, and did the model move?
    "Kaleb Johnson may be RB1, we have him way under"        -> which rows are worth a second look?
    "the NFL cards show ? for most teams"                    -> is any feed stale?

Each one is mechanical. This prints all four for the current week, and writes the same thing to
$GITHUB_STEP_SUMMARY so it lands in the Actions run summary and the notification e-mail rather
than in a log nobody opens.

LINE-BLINDNESS. Section 3 reads the market line, but only as a THRESHOLD against the player's own
history — "our number says over, his own record at that same number says rarely". It is a review
queue: no projection is changed by it and nothing is written back into any generated file.

An earlier version ranked that section by |proj - line| / line and reported the share of rows
leaning over. Both were wrong, and the way they were wrong is documented on section_disagreements:
we publish a MEAN and a book prices near the MEDIAN, so on right-skewed markets `proj > line` fires
most of the time by construction, and ranking by it just finds whoever has the smallest line.

    python analysis/weekly_flags.py                 # current week
    python analysis/weekly_flags.py --week 3
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "analysis"))
sys.path.insert(0, os.path.join(ROOT, "ingest"))
sys.path.insert(0, ROOT)

KEY_SLOTS = re.compile(r"^(QB[12]|RB[12]|WR[123]|TE1)$")
OUT_LIKE = {"OUT", "IR", "PUP", "NFI", "DNR", "SUS", "DOUBTFUL"}


# ----------------------------------------------------------------- small helpers
def norm(name: str) -> str:
    """Matches normName in web/lib/playerSlot.ts — see ingest/sleeper_availability.py."""
    s = (name or "").lower()
    s = re.sub(r"[^a-z ]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def depth_chart() -> dict[str, tuple[str, str, int]]:
    """{norm name: (team, pos, rank)} from the generated depth chart."""
    path = os.path.join(ROOT, "web/lib/depthChart.ts")
    out = {}
    if not os.path.exists(path):
        return out
    txt = open(path, encoding="utf-8").read()
    for m in re.finditer(r"'([^']+)':\s*\{ team: '([^']+)', pos: '([^']+)', rank: (\d+) \}", txt):
        out[m.group(1)] = (m.group(2), m.group(3), int(m.group(4)))
    return out


def slot_of(depth, name):
    e = depth.get(norm(name))
    return f"{e[1]}{e[2]}" if e else None


def sb(env, path):
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return []
    req = urllib.request.Request(
        url.rstrip("/") + "/rest/v1/" + path,
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Range": "0-9999", "Range-Unit": "items"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        print(f"  (supabase {e.code} on {path.split('?')[0]})", file=sys.stderr)
        return []
    except Exception:  # noqa: BLE001
        return []


def projections():
    """The generated prop board: (week, [rows])."""
    path = os.path.join(ROOT, "web/lib/playerProjections.ts")
    if not os.path.exists(path):
        return None, []
    txt = open(path, encoding="utf-8").read()
    wk = re.search(r"PROJ_WEEK = (\d+)", txt)
    body = txt[txt.index("PlayerProj[] = [") + len("PlayerProj[] = ["):]
    body = body[:body.rindex("];")]
    rows = [json.loads(m.group(0)) for m in re.finditer(r"\{.*?\}(?=,\n|\n?$)", body, re.S)]
    return (int(wk.group(1)) if wk else None), rows


OUT_LINES: list[str] = []


def say(line=""):
    print(line)
    OUT_LINES.append(line)


# ------------------------------------------------------------------- the sections
def section_availability(env, season, week, depth):
    say("## 1. Key players OUT and BACK")
    say()
    cur = sb(env, "sleeper_availability_current?select=player,team,pos,status,body_part"
                  "&status=not.is.null&limit=2000")
    outs = []
    for r in cur:
        st = str(r.get("status") or "").upper()
        if st not in OUT_LIKE:
            continue
        sl = slot_of(depth, r.get("player") or "")
        if sl and KEY_SLOTS.match(sl):
            outs.append((r["team"], sl, r["player"], st, r.get("body_part") or ""))
    if outs:
        say(f"Starters unavailable ({len(outs)}):")
        say()
        for t, sl, p, st, bp in sorted(outs):
            say(f"  {t:4s} {sl:4s} {p:24s} {st:10s} {bp.lower()}")
    else:
        say("No starter carries an out-type designation, or the availability table is empty.")
    say()

    # Back = designated in the previous week's report, nothing now.
    prev = sb(env, f"practice_reports?select=scraped_name,team,game_status&season=eq.{season}"
                   f"&week=eq.{week - 1}&game_status=in.(OUT,DOUBTFUL,IR)")
    now_out = {(norm(r["player"]), r["team"]) for r in cur}
    back = []
    for r in prev:
        nm, tm = r.get("scraped_name"), r.get("team")
        if not nm or not tm or (norm(nm), tm) in now_out:
            continue
        sl = slot_of(depth, nm)
        if sl and KEY_SLOTS.match(sl):
            back.append((tm, sl, nm))
    back = sorted(set(back))
    if back:
        say(f"Starters BACK this week ({len(back)}) — the model should be pricing these teams higher:")
        say()
        for t, sl, p in back:
            say(f"  {t:4s} {sl:4s} {p}")
    else:
        say("Nobody notable returning, or last week's report is not in yet.")
    say()


def section_adjustment(season, week):
    say("## 2. What the model did about it")
    say()
    try:
        import injury_adj
        adj = injury_adj.team_adjustment(season, week)
        prev = injury_adj.team_adjustment(season, week - 1) if week > 1 else {}
    except Exception as e:  # noqa: BLE001
        say(f"Injury adjustment unavailable ({e}).")
        say()
        return
    if not adj and not prev:
        say("No injury adjustment this week — the report is not filed yet, or nobody material is out.")
        say()
        return
    say("Points the model is subtracting for absences, and the change from last week.")
    say("A team that swings POSITIVE is one getting people back.")
    say()
    teams = sorted(set(adj) | set(prev), key=lambda t: (adj.get(t, 0.0) - prev.get(t, 0.0)))
    for t in teams:
        now, was = adj.get(t, 0.0), prev.get(t, 0.0)
        d = now - was
        mark = "  <- getting healthy" if d >= 1.0 else ("  <- newly hit" if d <= -1.0 else "")
        say(f"  {t:4s} last week {was:+6.2f}   this week {now:+6.2f}   change {d:+6.2f}{mark}")
    say()


def section_disagreements(rows, depth, n=12):
    """Rows where our number and the player's OWN history contradict each other.

    The first version of this ranked by |proj - line| / line and reported "62% of starter rows lean
    over", which Derek quite reasonably asked about. That metric was measuring skew, not bias.
    We publish a recency-weighted MEAN; a book sets a yardage line near the MEDIAN; and receiving
    and rushing yards are strongly right-skewed, so the mean sits above the median almost always.
    Measured on 44,619 player-weeks, 2021-2025:

        market       mean/median at a LOW level   at a HIGH level   our mean above the median
        rec_yds            1.83                        1.13                   95.9% of rows
        rush_yds           1.74                        1.10                   90.9%
        receptions         1.48                        1.01                   69.2%
        pass_yds           1.01                        1.01                   52.0%   <- the control

    Passing yards is near-symmetric, and it shows no lean at all. That is the tell: the lean tracks
    the SKEW of each market, not anything about our model. `proj > line` firing 62% of the time is
    what a calibrated mean does next to a median, so ranking by it just surfaces whichever players
    have the smallest lines.

    What is worth a human's time instead is a row that disagrees with ITSELF: our projection says
    comfortably over while the player's own history says he clears that number rarely. That is the
    failure mode this project has actually shipped before (a receiver projected at 3.7x his line),
    and it needs no market-derived constant to detect."""
    say("## 3. Rows that contradict their own history")
    say()
    say("Review queue only. Nothing here feeds a projection; it is the eyeball pass, automated.")
    say("Ranked by our projection disagreeing with the player's OWN hit rate at that same line —")
    say("not by distance from the line, which only ever finds the smallest lines (see the source).")
    say()
    flagged = []
    for r in rows:
        if not r.get("book") or r.get("proj") is None or r["market"] == "anytime_td":
            continue
        sl = slot_of(depth, r["player"])
        if not sl or not KEY_SLOTS.match(sl) or r["book"] < 10:
            continue
        g = r.get("cG") or 0
        if g < 6:                               # too few games to call anything a contradiction
            continue
        rate = (r.get("cOver") or 0) / g
        says_over = r["proj"] > r["book"]
        # A mean sits above the median by construction, so "we say over" is only interesting when
        # his own record is clearly on the other side. The thresholds are deliberately wide.
        if says_over and rate < 0.35:
            flagged.append((0.35 - rate, "we say OVER, he clears it rarely", rate, sl, r))
        elif not says_over and rate > 0.65:
            flagged.append((rate - 0.65, "we say UNDER, he clears it usually", rate, sl, r))
    flagged.sort(key=lambda x: -x[0])
    if not flagged:
        say("No starter row contradicts its own history. That is the healthy state.")
        say()
        return
    say(f"  {'':4s} {'player':22s} {'slot':5s} {'market':>9s} {'ours':>8s} {'his rate':>9s}  note")
    for _, note, rate, sl, r in flagged[:n]:
        say(f"  {r['team']:4s} {r['player']:22s} {sl:5s} {r['book']:9.1f} {r['proj']:8.1f} "
            f"{rate * 100:8.0f}%  {note}")
    say()
    say(f"{len(flagged)} starter rows flagged out of those with a usable sample.")
    say()


def section_calibration(rows, depth):
    """The board-level checks that came out of the "everything is an under" hunt.

    Each one is here because a whole session was spent discovering it by eye. They are cheap, they
    run on the generated board, and they fail loudly rather than looking plausible."""
    say("## 4. Is the board calibrated?")
    say()
    priced = [r for r in rows if r.get("book") and r.get("proj") is not None]
    ok = True

    def check(label, good, detail):
        nonlocal ok
        if not good:
            ok = False
        say(f"  [{'ok' if good else 'LOOK'}] {label}: {detail}")

    # 1. LEAN PER MARKET. Must be near 50% on each market SEPARATELY. Pooling hides it, because
    # anytime-TD is a probability market and sits near 37% by construction, which drags the average.
    for mkt in ("rec_yds", "rush_yds", "pass_yds", "receptions"):
        g = [r for r in priced if r["market"] == mkt]
        if len(g) < 20:
            continue
        pct = 100.0 * sum(1 for r in g if r["proj"] > r["book"]) / len(g)
        check(f"{mkt} lean", 38 <= pct <= 62, f"{pct:.0f}% over (n={len(g)}); want ~50")

    # 1b. TILT. The check that was missing, and the reason Derek could still see a broken board
    # while section 4 reported ALL CLEAR. A lean averaged over a whole market hides a slope: top-half
    # unders and bottom-half overs cancel to a healthy-looking 45%. Split each game at its median
    # line and compare the halves — this is exactly what the eye does when it says "all the big
    # receivers are unders and the little ones are overs".
    for mkt in ("rec_yds", "rush_yds"):
        tops = bots = topn = botn = 0
        for game in {r["game"] for r in priced}:
            q = sorted([r for r in priced if r["game"] == game and r["market"] == mkt],
                       key=lambda x: -x["book"])
            if len(q) < 6:
                continue
            h = len(q) // 2
            tops += sum(1 for r in q[:h] if r["proj"] > r["book"]); topn += h
            bots += sum(1 for r in q[h:] if r["proj"] > r["book"]); botn += len(q) - h
        if topn < 20 or botn < 20:
            continue
        t, b = 100.0 * tops / topn, 100.0 * bots / botn
        check(f"{mkt} tilt (big lines vs small)", abs(t - b) <= 22,
              f"top half {t:.0f}% over, bottom half {b:.0f}% over, gap {abs(t - b):.0f}pts; want <22")

    # 2. PROJECTION / LINE on players whose own history says the line IS their median. If both
    # numbers are the same statistic this sits at 1.0. It read 1.05 while we published a mean.
    mid = [r for r in priced if r["market"] != "anytime_td" and (r.get("cG") or 0) >= 8
           and 0.40 <= (r.get("cOver") or 0) / max(r.get("cG") or 1, 1) <= 0.60]
    if len(mid) >= 30:
        med = statistics.median(r["proj"] / r["book"] for r in mid)
        check("proj/line on mid-range players", 0.93 <= med <= 1.07,
              f"median {med:.3f} (n={len(mid)}); want ~1.00")

    # 3. ABSURD ROWS. A projection at 2x its line is only defensible on a tiny line.
    nt = [r for r in priced if r["market"] != "anytime_td"]
    big = [r for r in nt if r["proj"] / r["book"] >= 2 and r["book"] >= 15]
    check("rows >= 2x a non-trivial line", not big,
          f"{len(big)} rows" + ("" if not big else ": " + ", ".join(
              f"{r['player']} {r['book']}->{r['proj']}" for r in big[:4])))

    # 4. LEVEL vs the market, team by team. Our receivers should sum to roughly what the market
    # allocates the SAME rows. This is what proved the "everything is under" complaint was about
    # distribution rather than level, and it costs nothing to keep checking.
    off = []
    for game in {r["game"] for r in rows}:
        gr = [r for r in rows if r["game"] == game]
        for team in {r["team"] for r in gr if r.get("team")}:
            rec = [r for r in gr if r["market"] == "rec_yds" and r["team"] == team
                   and r.get("proj") is not None and r.get("book")]
            if len(rec) < 3:
                continue
            ours, mkt = sum(r["proj"] for r in rec), sum(r["book"] for r in rec)
            if mkt > 0 and not 0.80 <= ours / mkt <= 1.20:
                off.append(f"{team} {ours / mkt:.2f}")
    check("team receiving totals vs the market", len(off) <= 2,
          f"{len(off)} teams outside +/-20%" + ("" if not off else ": " + ", ".join(off[:5])))

    say()
    say("  ALL CLEAR" if ok else "  SOMETHING IS OFF — see above.")
    say()


def section_staleness(env, season, week, proj_week, depth):
    say("## 5. Is anything stale?")
    say()
    ok = True

    def check(label, good, detail):
        nonlocal ok
        if not good:
            ok = False
        say(f"  [{'ok' if good else 'STALE'}] {label}: {detail}")

    check("prop projections", proj_week == week,
          f"generated for week {proj_week}, current week is {week}")
    check("depth chart", bool(depth), f"{len(depth)} players loaded")
    avail = sb(env, "sleeper_availability_current?select=captured_at"
                    "&order=captured_at.desc&limit=1")
    if avail:
        seen = dt.datetime.fromisoformat(avail[0]["captured_at"].replace("Z", "+00:00"))
        age = (dt.datetime.now(dt.timezone.utc) - seen).total_seconds() / 3600
        check("availability feed", age < 12, f"last capture {age:.1f}h ago")
    else:
        check("availability feed", False, "no rows — has ingest/sleeper_availability.sql been run?")
    rep = sb(env, f"practice_reports?select=team&season=eq.{season}&week=eq.{week}&limit=2000")
    teams = len({r["team"] for r in rep})
    # Thursday-only slates legitimately have two teams; the full report lands Wednesday-Friday.
    check("practice report", teams >= 2, f"{teams} teams filed for week {week}")
    say()
    say("ALL CLEAR" if ok else "SOMETHING IS STALE — see above.")
    say()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--week", type=int)
    args = ap.parse_args()

    import injuries_nflverse as inj_env
    env = inj_env.load_env()
    inj_env.ensure_ssl()

    proj_week, rows = projections()
    week = args.week or proj_week
    if not week:
        print("no week — projections file missing", file=sys.stderr)
        return 1
    depth = depth_chart()

    say(f"# Weekly flags — {args.season} week {week}")
    say()
    say(f"_generated {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC_")
    say()
    section_availability(env, args.season, week, depth)
    section_adjustment(args.season, week)
    section_disagreements(rows, depth)
    section_calibration(rows, depth)
    section_staleness(env, args.season, week, proj_week, depth)

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("\n".join(OUT_LINES) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
