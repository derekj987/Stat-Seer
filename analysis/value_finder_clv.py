#!/usr/bin/env python3
"""Did a member who took the price the VALUE FINDER published beat the closing line?

Derek: "if a member took the best-book price we published, did they beat the close?"

This grades the SHOPPING board, not a model. The Value Finder never picks a side — it says "here
is the best price across the US books we track" — so what is being graded is a PRICE against a
later price, and no game results are needed. CLV is locked in the moment the bet is struck.

🚨 THE OBVIOUS VERSION OF THIS MEASUREMENT IS A TAUTOLOGY, AND IT IS WORTH SAYING WHY IT ISN'T
HERE. "Best of 21 books beats the consensus of 21 books" is true by construction and would be a
guaranteed-positive number dressed as a finding — the exact "appearance of rigor" this project
exists against. The comparison below is against the DE-VIGGED fair probability, which the best
price does NOT automatically beat: stripping the hold moves the bar past every book's raw number,
and only genuine disagreement between books gets a price through it. That is the same bar the Pick
Auditor's ✓ uses on the live board, by the same power method (fairValue.ts deVig /
mlb_player_props._power_devig), so a result here means what the ✓ means.

THE DECOMPOSITION, which is the whole point. For a side taken at time T:

    CLV(T)    = fair_close - implied(best price at T)     "did we beat the close"
              = SHOP(T) + TIMING(T)
    SHOP(T)   = fair_T     - implied(best price at T)     beat the no-vig market AT THAT MOMENT
    TIMING(T) = fair_close - fair_T                       the market then moved our way

All three are in probability points; positive is good for the bettor (a lower implied probability
is a better price for the same outcome). Reporting only CLV would blur a real claim into an
unfalsifiable one, because the two halves say completely different things:

  · SHOP is arithmetic the board performs. If it is positive, shopping has value.
  · TIMING is a forecast. If it is positive, the board's prices anticipate the market — which
    would contradict every other finding in this project, so expect ~0 and be suspicious if not.

🚨 SIDE-AGNOSTIC MEANS TIMING IS ZERO BY CONSTRUCTION. Averaged over BOTH sides of a market,
fair_close_A + fair_close_B = 1 and fair_T_A + fair_T_B = 1, so TIMING_A = -TIMING_B and the mean
is exactly 0 — not a finding, an identity. The two-sided mean of SHOP is the honest product
number: 1 - (overround of the best prices), i.e. how much of the hold shopping removes. The
side-selected view (`--tagged`) is the sharper question: of the prices the board would mark with a
✓, do they still look good against the close, or does the apparent mispricing evaporate?

MONEYLINE ONLY, DELIBERATELY. A spread of -3 at T and -3.5 at the close are different bets, so
comparing their prices needs a points-to-probability model and would import exactly the modelling
this measurement is meant to avoid. h2h has no point, so a price at T and a price at the close are
the same bet. Spreads and totals are left out rather than quietly approximated.

    python analysis/value_finder_clv.py --sport nfl --season 2026
    python analysis/value_finder_clv.py --sport nfl --season 2026 --weeks 5,6,7,8
    python analysis/value_finder_clv.py --sport nhl --days 21 --tagged
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# Mirror of web/lib/bookLabel.ts US_BOOKS and player_proj_export.py. The board never shows an
# offshore price, so grading one would grade a number no member could have taken.
US_BOOKS = {"draftkings", "fanduel", "betmgm", "williamhill_us", "fanatics", "betrivers",
            "espnbet", "hardrockbet", "ballybet", "betparx"}

SPORTS = {
    "nfl":   dict(table="odds_snapshots",     commence="commence_time", has_season=True),
    # cfb_odds_snapshots uses commence_time, NOT `commence` — unlike cfb_PROP_snapshots, which
    # does use `commence`. The two CFB tables disagree with each other, so introspect rather than
    # assume from the sport: `?select=*&limit=1`. Guessing it cost a 400 and a wasted run.
    #
    # 🚨 NCAAF IS NOT GRADABLE THROUGH THIS SCRIPT TODAY, AND THE REASON IS THE TABLE, NOT THE
    # METHOD. cfb_odds_snapshots holds ~1.27M rows (394k of them h2h) and answers HTTP 500 — a
    # server-side statement timeout — on these reads no matter how the client chunks them.
    # Tried and failed, 2026-10-28..11-05: unbounded; --days 120; --days 75 with 7-day windows;
    # --days 30 with 1-DAY windows. A hand probe of a single 2-day window DOES succeed in ~3s
    # with the same filters and the same parameter shape, including at offset 4000, so the query
    # is serviceable in isolation and not in a sequence of hundreds.
    #
    # The remaining fixes are server-side, not client-side: an index on (market, commence_time)
    # or a Postgres view/RPC that returns one row per (event, snapshot, side) instead of making
    # this script page the raw rows. More chunking has been tried to exhaustion and is not it.
    # Until then /ncaaf/lines correctly shows no measured number rather than a borrowed one.
    "ncaaf": dict(table="cfb_odds_snapshots", commence="commence_time", has_season=False),
    "nhl":   dict(table="nhl_odds_snapshots", commence="commence_time", has_season=False),
    "mlb":   dict(table="mlb_odds_snapshots", commence="commence_time", has_season=False),
    "nba":   dict(table="nba_odds_snapshots", commence="commence_time", has_season=False),
}

# A "close" taken from a sweep long before kickoff is not a close. GitHub delivers this repo's
# captures unevenly (EMPIRICAL_REFERENCE §17a), so some events genuinely have no late snapshot;
# those are dropped and COUNTED, never silently averaged in.
MAX_CLOSE_AGE_H = 6.0
# Below this many books quoting both sides, a "consensus" is one or two opinions.
MIN_BOOKS = 4


def implied(american: float) -> float:
    return 100 / (american + 100) if american > 0 else -american / (-american + 100)


def power_devig(a: float, b: float) -> float:
    """Fair probability of the first side. Identical to fairValue.ts deVig() and
    mlb_player_props._power_devig — the grader and the board must agree on what 'fair' means."""
    if a <= 0 or b <= 0 or a + b <= 1:
        return a / (a + b) if a + b > 0 else a
    lo, hi = 0.5, 4.0
    for _ in range(60):
        k = (lo + hi) / 2
        if a ** k + b ** k > 1:
            lo = k
        else:
            hi = k
    return a ** ((lo + hi) / 2)


def load_env():
    env = {}
    for name in (".env", os.path.join("web", ".env.local")):
        p = os.path.join(ROOT, name)
        if not os.path.exists(p):
            continue
        for line in open(p, encoding="utf-8"):
            if "=" in line and not line.strip().startswith("#"):
                kk, _, vv = line.strip().partition("=")
                env.setdefault(kk, vv)
    env.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    return env


def page(url, key, table, params, tries=5):
    """Paged PostgREST read. `limit=` does not raise the 1000-row ceiling, and a response sitting
    exactly at it is indistinguishable from a complete one.

    🚨 EACH PAGE RETRIES, BECAUSE THESE READS ARE LONG ENOUGH FOR A BLIP TO BE LIKELY. The NHL
    table holds five years of moneylines — about 280 pages — and a single
    `[WinError 10054] connection forcibly closed` two hundred pages in threw the whole run away,
    which is exactly what happened on the first MLB attempt. A transient network error is not a
    result; retrying the page costs seconds and losing the run costs minutes. A 4xx still raises
    immediately, because a bad column or a bad filter must fail loudly rather than be retried
    five times and reported as a network problem."""
    out, start = [], 0
    while True:
        q = urllib.parse.urlencode(params, safe="*.,()")
        req = urllib.request.Request(
            f"{url.rstrip('/')}/rest/v1/{table}?{q}",
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Range": f"{start}-{start + 999}", "Accept": "application/json"})
        rows = None
        for attempt in range(tries):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    rows = json.loads(r.read().decode())
                break
            except urllib.error.HTTPError as e:
                if e.code < 500:
                    raise
                if attempt == tries - 1:
                    raise
                time.sleep(2 * (attempt + 1))
            except Exception:  # noqa: BLE001  — URLError, socket reset, truncated read
                if attempt == tries - 1:
                    raise
                time.sleep(2 * (attempt + 1))
        out += rows
        if len(rows) < 1000:
            return out
        start += 1000


def page_windows(url, key, table, params, ccol, lo, hi, step_days=14):
    """Read a date range in WINDOWS, paging each one separately.

    🚨 A DEEP `Range:` OFFSET IS WHAT TIMES OUT, NOT THE FILTER — and that distinction took two
    failed runs to find. cfb_odds_snapshots (1.27M rows) answered HTTP 500 on every retry, so the
    first guess was an unbounded scan and the fix was `--days 120`. It still 500'd. Probing
    directly showed the FIRST page returns in 0.3-0.5s at 7, 30 and 60 days, with or without the
    book filter: the query is fine. It is the later pages. PostgREST turns `Range: 40000-40999`
    into `OFFSET 40000`, and Postgres must walk and discard every one of those rows to answer,
    so each successive page costs more than the last until one crosses the statement timeout.
    Bounding the WINDOW does nothing about that, because a narrower window still paginates from 0
    to however many rows it holds.

    Chunking the range keeps every offset shallow: a fortnight of one sport's moneylines is a few
    thousand rows, so no single page reaches a depth that can time out, and the number of requests
    grows linearly rather than the cost per request growing quadratically.

    The alternative is keyset pagination (order by a key, filter `> last seen`), which is the
    textbook answer and is better for a hot path. It is not used here because it needs a stable
    unique ordering this table has no index for, and because these runs are a handful of minutes
    either way. If this ever becomes a scheduled job rather than an occasional measurement,
    revisit that.
    """
    out = []
    cur = lo
    while cur < hi:
        nxt = min(cur + dt.timedelta(days=step_days), hi)
        p = dict(params)
        # 🚨 BOTH BOUNDS IN ONE `and=(...)`, NEVER ONE AS A BARE PARAM AND THE OTHER IN `and`.
        # This is the actual cause of the HTTP 500s on cfb_odds_snapshots, and it is NOT what it
        # looked like. Measured on one 2-day window of the same table:
        #
        #   commence_time=gte.X  &  and=(commence_time.lt.Y)   -> HTTP 500 after 8.8s
        #   and=(commence_time.lt.Y)  &  commence_time=gte.X   -> HTTP 500 after 8.7s
        #   and=(commence_time.gte.X,commence_time.lt.Y)       -> OK, 1000 rows in 3.1s
        #                                        ... at offset 4000 -> OK in 8.4s
        #
        # So it was the parameter SHAPE, not the window and not the offset depth. Splitting a
        # range across a bare filter and an `and` group on the SAME column gives the planner
        # something it handles badly enough to cross the statement timeout; expressed as one
        # range it plans fine and pages fine. The first two diagnoses here were wrong -- an
        # unbounded scan, then deep offsets -- and each looked convincing because a smaller
        # request happened to succeed while the server was quieter. The probe that settled it
        # varied ONLY the shape, holding the window and the offset fixed.
        p["and"] = f"({ccol}.gte.{cur.isoformat()},{ccol}.lt.{nxt.isoformat()})"
        out += page(url, key, table, p)
        cur = nxt
    return out


def fair_at(rows_at_snapshot):
    """Median de-vigged fair probability per side, across books quoting BOTH sides.

    Only two-sided books contribute: a book showing one side has no hold to strip, and mixing its
    raw number into an average of de-vigged ones is the error the visual-audit skill calls out by
    name. Returns ({side: fair}, n_books) and ({}, n) when too few books to call it a consensus."""
    by_book = defaultdict(dict)
    for r in rows_at_snapshot:
        if r["book"] in US_BOOKS and r["price_american"] is not None:
            by_book[r["book"]][r["outcome_name"]] = float(r["price_american"])
    per_side = defaultdict(list)
    n = 0
    for sides in by_book.values():
        if len(sides) != 2:
            continue
        n += 1
        (sa, pa), (sb, pb) = sides.items()
        ia, ib = implied(pa), implied(pb)
        per_side[sa].append(power_devig(ia, ib))
        per_side[sb].append(power_devig(ib, ia))
    if n < MIN_BOOKS:
        return {}, n
    return {s: statistics.median(v) for s, v in per_side.items()}, n


def best_at(rows_at_snapshot):
    """What the board publishes: the best price per side across the US books we track."""
    best = {}
    for r in rows_at_snapshot:
        if r["book"] not in US_BOOKS or r["price_american"] is None:
            continue
        p = float(r["price_american"])
        if r["outcome_name"] not in best or p > best[r["outcome_name"]][0]:
            best[r["outcome_name"]] = (p, r["book"])
    return best


def bucket(hours):
    for hi, label in ((1, "< 1 h"), (3, "1-3 h"), (6, "3-6 h"), (12, "6-12 h"),
                      (24, "12-24 h"), (72, "1-3 d"), (168, "3-7 d")):
        if hours < hi:
            return label
    return "> 7 d"


BUCKETS = ["< 1 h", "1-3 h", "3-6 h", "6-12 h", "12-24 h", "1-3 d", "3-7 d", "> 7 d"]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sport", choices=list(SPORTS), default="nfl")
    ap.add_argument("--season", type=int, help="only for sports whose table carries a season")
    ap.add_argument("--weeks", help="comma-separated, e.g. 5,6,7,8 (NFL only)")
    # 🚨 BOUND THE WINDOW ON A BIG TABLE OR THE SERVER GIVES UP. An unbounded run on
    # cfb_odds_snapshots (1.27M rows, 394k of them h2h) returned HTTP 500 on every retry: a scan
    # that crossed PostgREST's statement timeout, not a network problem, which is why the retry
    # loop could not save it. `--days 120` covers a football season and returns in minutes. This
    # is the same lesson publish_predictions.current_week() already carries in triplicate -- never
    # ask PostgREST for an unbounded scan of a snapshot table; bound it, then resolve in code.
    # NFL avoids this with --season, which is indexed; the sports with no season column need this.
    ap.add_argument("--days", type=int, default=0,
                    help="only events kicking off in the last N days — REQUIRED on big tables "
                         "(cfb_odds_snapshots times out unbounded)")
    ap.add_argument("--tagged", action="store_true",
                    help="grade ONLY the prices the board tags as beating fair (best beats de-vigged)")
    ap.add_argument("--export", action="store_true",
                    help="write the measured shopping value to web/lib/shoppingValue.ts for the board")
    # 🚨 SIZE THIS TO THE SPORT'S ROW RATE, NOT TO TASTE. The window only helps if it is small
    # enough that no single window's paging reaches a timing-out offset — see page_windows. NFL,
    # NHL and MLB are fine at the default. NCAAF is not: ~130 FBS teams across 10 books at several
    # sweeps a day puts roughly 4,000 moneyline rows a DAY in the table, so a fortnight is ~60,000
    # rows and the last pages of each window are back in the same hole. Two days is ~9 pages.
    ap.add_argument("--window-days", type=int, default=14,
                    help="read the range in windows this many days wide (use 2 for NCAAF)")
    a = ap.parse_args(argv)
    if a.export and a.tagged:
        sys.exit("--export writes the SIDE-AGNOSTIC number; it must not be run with --tagged, "
                 "whose sample is selected on beating fair and is not the board's claim")

    cfg = SPORTS[a.sport]
    env = load_env()
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")

    cc = cfg["commence"]
    params = {"select": f"snapshot_at,event_id,{cc},home_team,away_team,book,outcome_name,price_american",
              "market": "eq.h2h",
              "book": f"in.({','.join(sorted(US_BOOKS))})"}
    if a.season and cfg["has_season"]:
        params["season"] = f"eq.{a.season}"
    if a.weeks and cfg["has_season"]:
        params["week"] = f"in.({a.weeks})"

    print(f"# Value Finder vs the closing line — {a.sport.upper()} moneyline"
          + (f", season {a.season}" if a.season else "")
          + (f", weeks {a.weeks}" if a.weeks else "")
          + (f", last {a.days} days" if a.days else ""))
    now = dt.datetime.now(dt.timezone.utc)
    lo = now - dt.timedelta(days=a.days if a.days else 365 * 8)
    rows = page_windows(url, key, cfg["table"], params, cc, lo, now,
                        step_days=a.window_days)
    if not rows:
        sys.exit("no rows matched — NOTHING WAS GRADED")
    print(f"  {len(rows):,} US-book moneyline rows")

    by_event = defaultdict(list)
    for r in rows:
        by_event[r["event_id"]].append(r)

    recs = []
    skipped_close, skipped_books, events_used = 0, 0, 0
    for ev, erows in by_event.items():
        com = erows[0][cc]
        try:
            ct = dt.datetime.fromisoformat(com.replace("Z", "+00:00"))
        except Exception:  # noqa: BLE001
            continue
        by_snap = defaultdict(list)
        for r in erows:
            if r["snapshot_at"] < com:
                by_snap[r["snapshot_at"]].append(r)
        if not by_snap:
            continue
        snaps = sorted(by_snap)
        close_snap = snaps[-1]
        close_age = (ct - dt.datetime.fromisoformat(close_snap.replace("Z", "+00:00"))).total_seconds() / 3600
        if close_age > MAX_CLOSE_AGE_H:
            skipped_close += 1
            continue
        fair_close, nb = fair_at(by_snap[close_snap])
        if not fair_close:
            skipped_books += 1
            continue
        events_used += 1
        for s in snaps[:-1]:
            fair_t, _ = fair_at(by_snap[s])
            if not fair_t:
                continue
            best = best_at(by_snap[s])
            # 🚨 THE CONTROL, WITHOUT WHICH THE HEADLINE NUMBER IS UNREADABLE. "Best price is
            # 1.2 points worse than the no-vig fair" sounds like a failure until you know what the
            # same bet costs at ONE book. The product claim is not "shopping makes you +EV" — no
            # amount of shopping can, the hold is real — it is "shopping costs you less". So every
            # record also carries what the member would have paid at the board's reference book
            # (LINE_BOOK = fanduel) and at the median US book, priced identically.
            one = {}
            for r in by_snap[s]:
                if r["book"] == "fanduel" and r["price_american"] is not None:
                    one[r["outcome_name"]] = float(r["price_american"])
            allp = defaultdict(list)
            for r in by_snap[s]:
                if r["book"] in US_BOOKS and r["price_american"] is not None:
                    allp[r["outcome_name"]].append(float(r["price_american"]))
            hrs = (ct - dt.datetime.fromisoformat(s.replace("Z", "+00:00"))).total_seconds() / 3600
            for side, (price, book) in best.items():
                if side not in fair_t or side not in fair_close:
                    continue
                taken = implied(price)
                shop = fair_t[side] - taken
                timing = fair_close[side] - fair_t[side]
                fd = fair_close[side] - implied(one[side]) if side in one else None
                med = (fair_close[side] - implied(statistics.median(allp[side]))
                       if allp.get(side) else None)
                recs.append((bucket(hrs), shop, timing, shop + timing, book, fd, med))

    print(f"  {events_used} events graded; {skipped_close} dropped for no snapshot within "
          f"{MAX_CLOSE_AGE_H:g} h of kickoff, {skipped_books} for fewer than {MIN_BOOKS} two-sided books")
    if not recs:
        sys.exit("no gradable prices — NOTHING WAS GRADED")

    if a.tagged:
        recs = [r for r in recs if r[1] > 0]
        print(f"  --tagged: {len(recs):,} prices that BEAT the de-vigged market at the time "
              f"(the ones the board tags)")
        if not recs:
            sys.exit("no ✓ prices in this sample — NOTHING WAS GRADED")

    def pct(x):
        return f"{x * 100:+.2f}%"

    print(f"\n  {'when taken':12} {'n':>7} {'SHOP':>9} {'TIMING':>9} {'CLV':>9}  {'CLV>0':>7}")
    for b in BUCKETS:
        sel = [r for r in recs if r[0] == b]
        if not sel:
            continue
        shop = statistics.mean(r[1] for r in sel)
        tim = statistics.mean(r[2] for r in sel)
        clv = statistics.mean(r[3] for r in sel)
        win = sum(1 for r in sel if r[3] > 0) / len(sel) * 100
        print(f"  {b:12} {len(sel):7,} {pct(shop):>9} {pct(tim):>9} {pct(clv):>9}  {win:6.1f}%")
    shop = statistics.mean(r[1] for r in recs)
    tim = statistics.mean(r[2] for r in recs)
    clv = statistics.mean(r[3] for r in recs)
    win = sum(1 for r in recs if r[3] > 0) / len(recs) * 100
    print(f"  {'ALL':12} {len(recs):7,} {pct(shop):>9} {pct(tim):>9} {pct(clv):>9}  {win:6.1f}%")

    print(f"\n  SHOP   = beat the no-vig market at the moment taken (the board's arithmetic)")
    print(f"  TIMING = the market's fair then moved this way (a forecast; expect ~0)")
    print(f"  CLV    = SHOP + TIMING - did the taken price beat the close")
    if not a.tagged:
        print(f"\n  NOTE: averaged over BOTH sides, TIMING is 0 by construction (fair_A + fair_B = 1),")
        print(f"        so {pct(tim)} is an identity, not a finding. Use --tagged for the")
        print(f"        side-selected question.")

    # ---- THE CONTROL: what the same bets cost WITHOUT the board ----
    fd = [r[5] for r in recs if r[5] is not None]
    med = [r[6] for r in recs if r[6] is not None]
    print(f"\n  What the SAME bets cost without shopping — this is the number that makes the")
    print(f"  headline readable, because no amount of shopping can beat a hold that is real:")
    print(f"    {'best of ' + str(len(US_BOOKS)) + ' US books':28} {pct(clv)}   (what the board publishes)")
    if med:
        print(f"    {'median US book':28} {pct(statistics.mean(med))}   n={len(med):,}")
    if fd:
        print(f"    {'FanDuel alone (LINE_BOOK)':28} {pct(statistics.mean(fd))}   n={len(fd):,}")
        gain = clv - statistics.mean(fd)
        print(f"\n    Shopping is worth {pct(gain)} per bet against taking FanDuel's own number,")
        print(f"    and {pct(clv - statistics.mean(med))} against a typical book, in probability points.")
    books = defaultdict(list)
    for r in recs:
        books[r[4]].append(r[3])
    print(f"\n  best-price book  (share of the prices the board would have surfaced)")
    for b, v in sorted(books.items(), key=lambda kv: -len(kv[1]))[:6]:
        print(f"    {b:16} {len(v):7,}  {len(v)/len(recs)*100:5.1f}%   mean CLV {pct(statistics.mean(v))}")

    if a.export:
        if not med:
            sys.exit("--export needs the median-book control, which this sample does not have")
        write_export(a.sport, a.season, len(recs), events_used, clv,
                     statistics.mean(med), statistics.mean(fd) if fd else None)
    return 0


def write_export(sport, season, prices, events, clv, med, fd):
    """Write the one number the BOARD publishes, and only that one.

    🚨 WHAT GOES IN HERE IS THE GAIN, NOT THE RAW CLV, AND THAT IS NOT SPIN. `clv` on its own
    ("best price still pays 1.18 points to the close") is unreadable without the control beside
    it, and a bare negative on a board would tell a member something false: that shopping cost
    them. The honest, publishable quantity is the DIFFERENCE between shopping and not shopping,
    which is what the Value Finder actually does for them. The raw components stay in this
    script's console output, where the methodology lives.

    Nothing about HOW it is computed reaches the page — the de-vig, the power method and the
    decomposition stay here. The board gets a measured number and a sample size, which is what
    "verifiable" means for a reader: they can check it, not re-derive it.
    """
    out = os.path.join(ROOT, "web", "lib", "shoppingValue.ts")
    gen = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    rec = {"sport": sport, "season": season, "prices": prices, "events": events,
           "books": len(US_BOOKS),
           "gainVsTypical": round((clv - med) * 100, 2),
           "gainVsLineBook": round((clv - fd) * 100, 2) if fd is not None else None,
           "generated": gen}
    existing = {}
    if os.path.exists(out):
        src = open(out, encoding="utf-8").read()
        m = re.search(r"SHOPPING_VALUE: Record<string, ShoppingValue> = (\{.*?\n\});", src, re.S)
        if m:
            try:
                existing = json.loads(re.sub(r",(\s*[}\]])", r"\1", m.group(1)))
            except Exception:  # noqa: BLE001
                existing = {}
    existing[sport] = rec
    lines = [
        "// AUTO-GENERATED by analysis/value_finder_clv.py --export -- do not edit by hand.",
        "//",
        "// What shopping every book is WORTH, measured against the closing line. This is the",
        "// Value Finder's own claim, graded: the difference in price between taking the best of",
        "// the US books we track and taking a typical one, in probability points per bet.",
        "//",
        "// It is a TRACK RECORD, not a live reading. The board also shows an 'avg shopping edge'",
        "// computed from the current slate; that one says what is on offer right now, this one",
        "// says what it has been worth across a season of published prices. Do not merge them.",
        "//",
        "// Re-run after a season's worth of new prices:",
        "//   python analysis/value_finder_clv.py --sport nfl --season 2026 --export",
        "",
        "export interface ShoppingValue {",
        "  sport: string; season: number | null; prices: number; events: number; books: number;",
        "  /** Probability points per bet vs the MEDIAN US book — the headline. */",
        "  gainVsTypical: number;",
        "  /** Same, vs LINE_BOOK (the number every market column already shows). */",
        "  gainVsLineBook: number | null;",
        "  generated: string;",
        "}",
        "",
        "export const SHOPPING_VALUE: Record<string, ShoppingValue> = {",
    ]
    for k in sorted(existing):
        lines.append(f"  {json.dumps(k)}: {json.dumps(existing[k])},")
    lines += ["};", ""]
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"\n  wrote {out}  ({sport}: +{rec['gainVsTypical']:.2f} pts vs a typical book, "
          f"n={prices:,})")


if __name__ == "__main__":
    raise SystemExit(main())
