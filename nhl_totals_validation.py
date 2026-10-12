"""
nhl_totals_validation.py -- is the NHL closing total efficient? The benchmark every candidate
factor has to beat before it is allowed anywhere near The Model.

    python nhl_results.py --seasons 2024 --csv data/nhl_results.csv       # free
    python nhl_backfill_odds.py --season 2024 --write                     # ~23k credits
    python nhl_totals_validation.py --season 2024

WHY THIS COMES FIRST. Derek's NHL factor list (goaltending/GSAx, xGF, pace, special teams,
back-to-backs, home ice) is a list of MECHANISMS, and its own last section says those are "what
books use". CLAUDE.md's standing rule is that nothing enters The Model unless it beats the CLOSING
LINE out of sample -- so the first measurable question is not "does goaltending matter" (it
obviously does) but "how much room the closing total has left on the table". That number is the
bar. Measure the bar before building anything that has to clear it.

NFL precedent, from CLAUDE.md: ~50 hypotheses tested against the closing line, essentially none
beat the vig; the one survivor (wind, 56.1% unders at 15+ mph, n=640) still FAILED the vig bar by
0.18 points. A game-line power rating looked like an edge on Week 1 and was noise by Week 6. The
default expectation here is the same, and a negative result is a result.

WHAT IS MEASURED
  1. Join integrity, and how close to puck drop the archive's snapshot actually is. A "closing"
     line that is really 40 minutes early is a different number, and a backtest that quietly
     drops a third of its games is worthless. Both are reported, never assumed.
  2. The hold (vig) on NHL totals -- the bar itself.
  3. Over / under / push at the consensus closing total.
  4. Calibration: de-vigged market P(over) in buckets vs realised over-rate. If the market is
     calibrated there is no systematic side to take, and the search moves to Value Finder.
  5. Whether the 68.2% odd-total asymmetry (nhl_totals_study.py) leaves anything exploitable on
     whole-number totals, where a push is possible.

JOINING. The odds feed's commence_time and the NHL feed's startTimeUTC disagree by up to ~15
minutes on the same game, so an exact-timestamp join silently drops games. A team plays at most one
game a day, so we index results by home team and take the nearest puck drop inside
--max-join-gap-hours. The join rate is printed; a low one is a finding, not something to paper over.

Reads nhl_odds_snapshots (capture_reason=BACKFILL) from Supabase, results from the local CSV.
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as _dt
import json
import os
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import odds_client as oc  # noqa: E402


def american_to_prob(a):
    a = float(a)
    return 100.0 / (a + 100.0) if a > 0 else -a / (-a + 100.0)


def devig(pa, pb):
    """Two-way proportional de-vig. Returns P(a)."""
    ia, ib = american_to_prob(pa), american_to_prob(pb)
    return ia / (ia + ib) if ia + ib else None


def norm_team(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.lower().replace("-", " ").split())


def parse_iso(s):
    return _dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))


def sb_get(env, table, query, page=1000, tries=4):
    """Paged PostgREST select -- the snapshot table is far bigger than one response.

    Four seasons of totals is ~400k rows, so this makes hundreds of sequential requests and
    Supabase WILL reset one of them (WinError 10054) partway through. Retry the page rather
    than losing the whole read; a page that fails every attempt raises, so a genuine outage
    still surfaces instead of silently returning a short result that looks like a finding."""
    base = env["SUPABASE_URL"].rstrip("/") + f"/rest/v1/{table}"
    key = env["SUPABASE_SERVICE_KEY"]
    out, offset = [], 0
    while True:
        h = {"apikey": key, "Authorization": f"Bearer {key}",
             "Range-Unit": "items", "Range": f"{offset}-{offset + page - 1}"}
        chunk = None
        for attempt in range(tries):
            try:
                chunk = json.loads(urllib.request.urlopen(
                    urllib.request.Request(f"{base}{query}", headers=h), timeout=180).read())
                break
            except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
                if attempt == tries - 1:
                    raise RuntimeError(
                        f"{table}: page at offset {offset:,} failed {tries} times ({e})") from e
                time.sleep(2 * (attempt + 1))
        out += chunk
        if len(chunk) < page:
            return out
        offset += page


def load_results(path, season):
    with open(path, "r", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f)
                if r.get("total_goals") and str(r.get("season")) == str(season)]


def build_games(odds_rows):
    """Collapse book-level rows into one record per game, at its latest snapshot.

    A game may appear at several snapshots (a 7pm slate's snapshot also sees the 7:30 games).
    The CLOSING line is the latest snapshot that still precedes puck drop, so keep the max."""
    by_game = collections.defaultdict(dict)   # (commence, home) -> {snapshot_at -> rows}
    for r in odds_rows:
        if r.get("outcome_point") is None or r.get("price_american") is None:
            continue
        k = (r["commence_time"], norm_team(r["home_team"]))
        by_game[k].setdefault(r["snapshot_at"], []).append(r)
    games = {}
    for k, snaps in by_game.items():
        latest = max(snaps)
        games[k] = {"snapshot_at": latest, "rows": snaps[latest],
                    "commence_time": k[0],
                    "home_team": snaps[latest][0]["home_team"],
                    "away_team": snaps[latest][0]["away_team"]}
    return games


def consensus(rows):
    """Modal posted total across books, and the de-vigged P(over) at that line.

    Books don't always post the same number (6.0 vs 6.5). Pricing off a mixture of lines
    would be meaningless, so we take the line the most books agree on and de-vig only the
    books actually posting it."""
    lines = collections.Counter(float(r["outcome_point"]) for r in rows)
    line = lines.most_common(1)[0][0]
    per_book = collections.defaultdict(dict)
    for r in rows:
        if float(r["outcome_point"]) != line:
            continue
        side = (r["outcome_name"] or "").strip().lower()
        if side in ("over", "under"):
            per_book[r["book"]][side] = float(r["price_american"])
    fair, holds = [], []
    for _bk, sides in per_book.items():
        if "over" in sides and "under" in sides:
            p = devig(sides["over"], sides["under"])
            if p is not None:
                fair.append(p)
                holds.append(american_to_prob(sides["over"]) + american_to_prob(sides["under"]) - 1.0)
    if not fair:
        return None
    return {"line": line, "p_over": statistics.fmean(fair), "hold": statistics.fmean(holds),
            "n_books": len(fair), "n_lines_posted": len(lines)}


def collect_joined(env, season, results_csv, max_gap, quiet=False):
    """Fetch one season's backfilled totals and join them to results.

    Returns (joined, diag) -- diag carries what the caller must report rather than assume:
    how many priced games found a result, and how close to puck drop the snapshot really was."""
    results = load_results(results_csv, season)
    if not results:
        return [], {"error": f"no completed {season} games in {results_csv}"}

    lo = min(r["start_time_utc"] for r in results)
    hi = max(r["start_time_utc"] for r in results)
    q = ("?capture_reason=eq.BACKFILL&market=eq.totals"
         f"&commence_time=gte.{lo}&commence_time=lte.{hi}"
         "&select=snapshot_at,commence_time,home_team,away_team,book,outcome_name,"
         "outcome_point,price_american")
    if not quiet:
        print(f"fetching backfilled totals rows for {season} ...")
    odds_rows = sb_get(env, "nhl_odds_snapshots", q)
    games = build_games(odds_rows)

    idx = collections.defaultdict(list)
    for r in results:
        idx[norm_team(r["home_team"])].append((parse_iso(r["start_time_utc"]), r))
    joined, unmatched, gaps = [], 0, []
    for g in games.values():
        ct = parse_iso(g["commence_time"])
        best, bestgap = None, None
        for st, r in idx.get(norm_team(g["home_team"]), []):
            gap = abs((st - ct).total_seconds()) / 3600.0
            if bestgap is None or gap < bestgap:
                best, bestgap = r, gap
        if best is None or bestgap > max_gap:
            unmatched += 1
            continue
        c = consensus(g["rows"])
        if not c:
            unmatched += 1
            continue
        lead = (ct - parse_iso(g["snapshot_at"])).total_seconds() / 60.0
        gaps.append(lead)
        joined.append({**c, "season": season, "total": int(best["total_goals"]),
                       "end": best["last_period_type"], "lead_min": lead})
    return joined, {"n_odds_rows": len(odds_rows), "n_priced": len(games),
                    "n_results": len(results), "unmatched": unmatched, "gaps": gaps}


def summary_row(joined, holds_bar=None):
    """The one line that answers 'does it hold' -- under rate vs the break-even it must clear."""
    n = len(joined)
    over = sum(1 for j in joined if j["total"] > j["line"])
    under = sum(1 for j in joined if j["total"] < j["line"])
    push = n - over - under
    dec = over + under
    hold = statistics.fmean(j["hold"] for j in joined)
    be = 0.5 + hold / 2
    best = max(over, under) / dec if dec else 0
    return {"n": n, "over": over, "under": under, "push": push, "dec": dec,
            "hold": hold, "be": be, "under_rate": under / dec if dec else 0,
            "best": best, "edge": best - be,
            "side": "under" if under >= over else "over"}


def run(args):
    oc.ensure_ssl_certs()
    env = oc.load_env()
    if not (env.get("SUPABASE_URL") and env.get("SUPABASE_SERVICE_KEY")):
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing", file=sys.stderr)
        return 1

    # ---------------------------------------------- multi-season: does the result hold?
    if args.seasons:
        seasons = sorted({int(x) for part in args.seasons.split(",")
                          for x in (range(int(part.split("-")[0]), int(part.split("-")[1]) + 1)
                                    if "-" in part else [int(part)])})
        print(f"NHL closing totals -- seasons {seasons[0]}-{seasons[-1]}\n")
        allj, rows = [], []
        for s in seasons:
            j, d = collect_joined(env, s, args.results_csv, args.max_join_gap_hours)
            if d.get("error") or not j:
                print(f"  {s}: {d.get('error', 'nothing joined')}", file=sys.stderr)
                continue
            allj += j
            rows.append((s, summary_row(j), d))
        if not allj:
            print("nothing joined for any season.", file=sys.stderr)
            return 1
        print(f"\n{'season':<9}{'games':>7}{'cover':>8}{'hold':>8}{'break-even':>12}"
              f"{'under':>8}{'best side':>11}{'vs b/e':>9}")
        for s, m, d in rows:
            print(f"{s}-{str(s + 1)[2:]:<4}{m['n']:>7}{m['n'] / d['n_results']:>8.1%}"
                  f"{m['hold']:>8.2%}{m['be']:>12.2%}{m['under_rate']:>8.1%}"
                  f"{m['side'] + ' ' + format(m['best'], '.1%'):>11}{m['edge']:>+9.2%}")
        p = summary_row(allj)
        print(f"{'POOLED':<9}{p['n']:>7}{'':>8}{p['hold']:>8.2%}{p['be']:>12.2%}"
              f"{p['under_rate']:>8.1%}{p['side'] + ' ' + format(p['best'], '.1%'):>11}"
              f"{p['edge']:>+9.2%}")
        print(f"\nPooled: {p['dec']:,} decided bets across {len(rows)} season(s). The best side "
              f"({p['side']}) hits {p['best']:.2%}\nand must clear {p['be']:.2%} to break even -- "
              f"{'MISSES by ' + format(-p['edge'], '.2%') if p['edge'] <= 0 else 'BEATS it by ' + format(p['edge'], '.2%')}.")
        swing = max(m["under_rate"] for _s, m, _d in rows) - min(m["under_rate"] for _s, m, _d in rows)
        print(f"Season-to-season under-rate swing: {swing:.1%} -- the size of the noise any "
              f"single-season\nresult sits inside.")
        print("\nNothing here is a model and none of it is a pick.")
        return 0

    results = load_results(args.results_csv, args.season)
    joined, diag = collect_joined(env, args.season, args.results_csv, args.max_join_gap_hours)
    if diag.get("error"):
        print(diag["error"], file=sys.stderr)
        return 1
    print(f"NHL closing totals -- season {args.season}")
    print(f"  {diag['n_odds_rows']:,} book-level totals row(s) in the archive window")
    print(f"  {diag['n_priced']:,} distinct game(s) priced\n")
    games, unmatched, gaps = range(diag["n_priced"]), diag["unmatched"], diag["gaps"]

    n = len(joined)
    print("1. JOIN INTEGRITY + HOW CLOSE TO PUCK DROP")
    print(f"   {n:,} of {len(games):,} priced game(s) joined to a result "
          f"({n / max(len(games), 1):.1%}); {unmatched:,} unmatched/unpriced")
    print(f"   {n:,} of {len(results):,} completed games in the season have a closing total "
          f"({n / len(results):.1%})")
    if not n:
        print("\nnothing joined -- cannot measure. Check the backfill actually wrote.",
              file=sys.stderr)
        return 1
    gaps.sort()
    def pctl(p):
        return gaps[min(int(p * len(gaps)), len(gaps) - 1)]
    print(f"   snapshot lead before puck drop: median {statistics.median(gaps):.0f} min, "
          f"p10 {pctl(0.10):.0f}, p90 {pctl(0.90):.0f}, max {gaps[-1]:.0f}")
    print(f"   -> treat this as 'near-closing', not the literal close; the archive's snapshot\n"
          f"      cadence, not our request, sets how close we can get.\n")

    # -------------------------------------------------------------------- the bar
    holds = [j["hold"] for j in joined]
    print("2. THE BAR -- hold (vig) on NHL totals")
    print(f"   mean two-way hold {statistics.fmean(holds):.2%}, median "
          f"{statistics.median(holds):.2%}")
    print(f"   -> a side must win {0.5 + statistics.fmean(holds) / 2:.2%} of decided bets just to "
          f"break even.\n")

    # ------------------------------------------------------------ over/under/push
    over = sum(1 for j in joined if j["total"] > j["line"])
    under = sum(1 for j in joined if j["total"] < j["line"])
    push = sum(1 for j in joined if j["total"] == j["line"])
    dec = over + under
    print("3. RESULT AT THE CONSENSUS CLOSING TOTAL")
    print(f"   over {over:,} ({over / n:.1%})   under {under:,} ({under / n:.1%})   "
          f"push {push:,} ({push / n:.1%})")
    print(f"   of decided bets: over {over / dec:.1%} / under {under / dec:.1%}  (n={dec:,})")
    edge = max(over, under) / dec - (0.5 + statistics.fmean(holds) / 2)
    side = "over" if over > under else "under"
    print(f"   best side ({side}) clears break-even by {edge:+.2%}"
          f"{'  -- NOT an edge' if edge <= 0 else '  -- worth a closer look'}\n")

    # ----------------------------------------------------------------- calibration
    print("4. CALIBRATION -- de-vigged market P(over) vs realised over-rate")
    print("   (a calibrated market leaves no systematic side to take)")
    buckets = collections.defaultdict(list)
    for j in joined:
        if j["total"] == j["line"]:
            continue                      # a push is not an over/under outcome
        buckets[round(j["p_over"] * 20) / 20].append(1 if j["total"] > j["line"] else 0)
    print(f"   {'market P(over)':>15} {'n':>6} {'actual':>8} {'error':>8}")
    for b in sorted(buckets):
        v = buckets[b]
        if len(v) < 25:
            continue
        a = statistics.fmean(v)
        print(f"   {b:>14.0%} {len(v):>6} {a:>7.1%} {a - b:>+8.1%}")
    allp = [j["p_over"] for j in joined if j["total"] != j["line"]]
    alla = [1 if j["total"] > j["line"] else 0 for j in joined if j["total"] != j["line"]]
    print(f"   overall: market said {statistics.fmean(allp):.1%} over, actual "
          f"{statistics.fmean(alla):.1%}  ({statistics.fmean(alla) - statistics.fmean(allp):+.1%})\n")

    # ------------------------------------------------- the odd/even asymmetry, priced?
    print("5. DOES THE ODD-TOTAL ASYMMETRY LEAVE ANYTHING ON WHOLE-NUMBER TOTALS?")
    whole = [j for j in joined if float(j["line"]).is_integer()]
    half = [j for j in joined if not float(j["line"]).is_integer()]
    print(f"   books posted a whole number on {len(whole):,} of {n:,} games ({len(whole) / n:.1%}) "
          f"-- half-point lines on {len(half):,}")
    if whole:
        wp = sum(1 for j in whole if j["total"] == j["line"])
        print(f"   actual push rate on those whole numbers: {wp / len(whole):.1%} "
              f"(n={len(whole):,})")
        print(f"   -> compare nhl_totals_study.py: a fitted Poisson would have said ~16% at 6.0 "
              f"vs 11% actual.")
    byline = collections.Counter(j["line"] for j in joined)
    print("   most-posted lines: " + ", ".join(
        f"{ln:g} ({c:,})" for ln, c in byline.most_common(6)))

    print("\nREAD THIS AS THE BAR, NOT A RESULT. It says how efficient the closing total is and\n"
          "what any goaltending/xG/pace candidate has to beat out of sample. Nothing here is a\n"
          "model, and none of it is a pick.")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--season", type=int, help="full report for one season")
    g.add_argument("--seasons", help="range or list, e.g. 2021-2024 -- per-season comparison "
                                     "plus the pooled result, to see whether it holds")
    ap.add_argument("--results-csv", default="data/nhl_results.csv")
    ap.add_argument("--max-join-gap-hours", type=float, default=6.0,
                    help="max |odds commence_time - NHL puck drop| to call it the same game")
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
