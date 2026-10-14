"""
nhl_goalie_value.py -- is there stale value around the morning goalie confirmation?

    python nhl_results.py --season 2024 --csv data/nhl_results.csv            # free
    python nhl_goalies.py --season 2024 --csv data/nhl_goalies.csv            # free
    python nhl_backfill_odds.py --season 2024 --offset-minutes 1440,240 \
        --markets h2h,totals --write                                          # ~31k credits
    python nhl_goalie_value.py --season 2024

THE CLAIM BEING TESTED, and why it is a Value Finder question rather than a model one.

§14f settled that the NHL closing total is efficient out of sample -- four seasons, the winning
side flips, pooled best side misses break-even by 1.88%. So no projection of goals is going to beat
that number. What is left on Derek's factor list is the one item whose mechanism is TIMING rather
than a priced variable: NHL starters are confirmed on the morning of the game, and if some books
reprice a backup start before others, the slow book is offering a price that the fast books'
consensus already says is wrong. Spotting that is arithmetic -- de-vig, compare, flag -- which is
exactly what Value Finder is for (CLAUDE.md: "mostly arithmetic. This is where the money is").

So the question is NOT "is a backup goalie worse" (obviously, and priced). It is:

    does the share of consensus-beating quotes RISE around confirmation, and
    does it rise MORE in games where an unexpected goalie started?

§14c is the baseline to beat: at the close, only 7 of 1,048 quotes (1%) beat the de-vigged
consensus, worth a median 0.30%. If the pre-confirmation and post-confirmation windows look the
same as the close, there is no timing edge and this panel should not be built.

🚨 NO HINDSIGHT IN THE LABEL. "Unexpected start" is computed from that goalie's share of the team's
starts BEFORE the game only (nhl_goalies.share_before), with a minimum number of prior team games
so early-season noise cannot masquerade as a surprise. A label that used full-season start counts
would know things the morning bettor did not, and would manufacture an edge that cannot be traded.

🚨 AND THIS MEASURES DISPERSION, NOT PROFIT. A quote beating consensus is a necessary condition for
value, not a realised win. Whether it is tradeable depends on limits and on whether the slow book
would have taken the bet, neither of which is in this data. Reported as what it is.
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

# Lead-time bands, in minutes before puck drop. The backfill plants snapshots at 1440 / 240 / 6;
# these bands catch them with slack for the archive's own cadence.
BANDS = (("pre-confirm (~24h)", 1200, 1700),
         ("post-confirm (~4h)", 150, 330),
         ("close (<40m)", 0, 40))


def american_to_prob(a):
    a = float(a)
    return 100.0 / (a + 100.0) if a > 0 else -a / (-a + 100.0)


def devig(pa, pb):
    ia, ib = american_to_prob(pa), american_to_prob(pb)
    return ia / (ia + ib) if ia + ib else None


def norm_team(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.lower().replace("-", " ").split())


def parse_iso(s):
    return _dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))


def sb_get(env, table, query, page=1000, tries=4):
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
                    raise RuntimeError(f"{table}: page at {offset:,} failed {tries}x ({e})") from e
                time.sleep(2 * (attempt + 1))
        out += chunk
        if len(chunk) < page:
            return out
        offset += page


# ------------------------------------------------------------------ goalie labelling
#
# HOW SURPRISING WAS THE START? A binary "backup or not" does not survive contact with the data:
# at a <50% threshold 60.7% of 2024-25 games contain a "backup" start, because NHL teams split
# starts roughly 60/40 and a 1B starting 30% of the time is ROUTINE, not news. (New Jersey's Jake
# Allen at "30% of starts" was getting flagged as a surprise in every one of his starts.) A label
# that fires on 3 games in 5 cannot be measuring an information event.
#
# So bucket by DEGREE instead, on the more surprising of the two starters, and look for a
# dose-response: if confirmation really leaves stale prices, dispersion should rise as the start
# gets more unexpected. A flat profile across these buckets is a negative result.
#
SURPRISE_BUCKETS = (("#1 both sides  (>=50%)", 0.50, 1.01),
                    ("routine 1B     (30-50%)", 0.30, 0.50),
                    ("deep backup    (15-30%)", 0.15, 0.30),
                    ("rare start      (<15%)", 0.00, 0.15))


def load_goalie_labels(path, season, min_prior_team_games):
    """game_id -> {'min_share', 'unknown', 'detail'}, using ONLY pre-game information.

    The goalies file has one row per team per game. Sorting a team's rows by puck drop makes the
    row index that team's games-so-far, which is the denominator we need without trusting a
    stored ratio. `min_share` is the lower of the two starters' prior start shares -- the more
    surprising goalie on the ice, which is what would move a price."""
    with open(path, "r", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if str(r.get("season")) == str(season)]
    if not rows:
        return {}
    by_team = collections.defaultdict(list)
    for r in rows:
        by_team[r["team_abbrev"]].append(r)
    labels = {}
    for _team, rs in by_team.items():
        rs.sort(key=lambda r: r["start_time_utc"] or "")
        for i, r in enumerate(rs):             # i == team games before this one
            try:
                before = int(r["starts_before"])
            except (TypeError, ValueError):
                continue
            gid = r["game_id"]
            lab = labels.setdefault(gid, {"min_share": None, "unknown": False, "detail": []})
            # Too little history to call anything a surprise -- explicitly unknown, never "backup".
            if i < min_prior_team_games:
                lab["unknown"] = True
                lab["detail"].append(f"{r['team_abbrev']} {r['goalie']} (only {i} prior)")
                continue
            share = before / i
            lab["detail"].append(f"{r['team_abbrev']} {r['goalie']} ({share:.0%})")
            if lab["min_share"] is None or share < lab["min_share"]:
                lab["min_share"] = share
    for v in labels.values():
        v["detail"] = "; ".join(v["detail"])
    return labels


def surprise_bucket(min_share):
    if min_share is None:
        return None
    for name, lo, hi in SURPRISE_BUCKETS:
        if lo <= min_share < hi:
            return name
    return None


# -------------------------------------------------------------------- odds assembly
def quote_stats(rows, market):
    """Per-book de-vigged fair prob at the modal line, plus how many books beat the consensus.

    Returns None unless at least `MIN_BOOKS` books priced a complete two-way at the same line --
    a 'consensus' built from two books is not one, and dispersion across two books is noise."""
    MIN_BOOKS = 4
    if market == "totals":
        lines = collections.Counter(float(r["outcome_point"]) for r in rows
                                    if r["outcome_point"] is not None)
        if not lines:
            return None
        line = lines.most_common(1)[0][0]
        sel = [r for r in rows if r["outcome_point"] is not None
               and float(r["outcome_point"]) == line]
        a, b = "over", "under"
    else:
        line = None
        sel = rows
        names = sorted({norm_team(r["outcome_name"]) for r in sel})
        if len(names) != 2:
            return None
        a, b = names

    per_book = collections.defaultdict(dict)
    for r in sel:
        side = norm_team(r["outcome_name"]) if market != "totals" else \
            (r["outcome_name"] or "").strip().lower()
        if side in (a, b) and r.get("price_american") is not None:
            per_book[r["book"]][side] = float(r["price_american"])

    fair_a, raw = {}, {}
    for bk, sides in per_book.items():
        if a in sides and b in sides:
            p = devig(sides[a], sides[b])
            if p is not None:
                fair_a[bk] = p
                raw[bk] = (sides[a], sides[b])
    if len(fair_a) < MIN_BOOKS:
        return None

    cons = statistics.fmean(fair_a.values())
    sd = statistics.pstdev(fair_a.values()) if len(fair_a) > 1 else 0.0
    # A quote "beats consensus" when its own RAW price implies a probability lower than the
    # de-vigged consensus for that side -- i.e. the book is paying more than the market's fair
    # price. Measured on both sides, in implied-probability points, exactly as §14c did.
    beats = []
    for bk, (pa, pb) in raw.items():
        edge_a = cons - american_to_prob(pa)
        edge_b = (1 - cons) - american_to_prob(pb)
        for side, e in ((a, edge_a), (b, edge_b)):
            if e > 0:
                beats.append((bk, side, e))
    return {"line": line, "consensus": cons, "sd": sd, "n_books": len(fair_a),
            "n_quotes": 2 * len(fair_a), "beats": beats,
            "best_edge": max((e for _b, _s, e in beats), default=0.0)}


def band_of(lead_min):
    for name, lo, hi in BANDS:
        if lo <= lead_min <= hi:
            return name
    return None


def run(args):
    oc.ensure_ssl_certs()
    env = oc.load_env()
    if not (env.get("SUPABASE_URL") and env.get("SUPABASE_SERVICE_KEY")):
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing", file=sys.stderr)
        return 1
    if not os.path.exists(args.results_csv) or not os.path.exists(args.goalies_csv):
        print(f"ERROR: need {args.results_csv} and {args.goalies_csv} (both free to build)",
              file=sys.stderr)
        return 1

    with open(args.results_csv, "r", encoding="utf-8") as f:
        results = {r["game_id"]: r for r in csv.DictReader(f)
                   if str(r.get("season")) == str(args.season) and r.get("total_goals")}
    labels = load_goalie_labels(args.goalies_csv, args.season, args.min_prior_team_games)
    print(f"NHL goalie-confirmation value -- season {args.season}")
    print(f"  {len(results):,} completed game(s), {len(labels):,} with a goalie label")
    n_unknown = sum(1 for v in labels.values() if v.get("unknown"))
    print(f"  {n_unknown:,} too early in the season to label (excluded from the buckets)")
    bcount = collections.Counter(
        surprise_bucket(v["min_share"]) for v in labels.values() if not v.get("unknown"))
    for name, _lo, _hi in SURPRISE_BUCKETS:
        c = bcount.get(name, 0)
        print(f"    {name:<26}{c:>5} game(s)")
    print()

    lo = min(r["start_time_utc"] for r in results.values())
    hi = max(r["start_time_utc"] for r in results.values())
    q = (f"?capture_reason=eq.BACKFILL&market=in.({args.markets})"
         f"&commence_time=gte.{lo}&commence_time=lte.{hi}"
         "&select=snapshot_at,commence_time,home_team,market,book,outcome_name,"
         "outcome_point,price_american")
    print("fetching backfilled odds ...")
    odds = sb_get(env, "nhl_odds_snapshots", q)
    print(f"  {len(odds):,} book-level row(s)\n")

    # index results by home team + nearest puck drop (the odds feed's commence_time and the NHL
    # feed's start disagree by up to ~15 min -- see nhl_totals_validation)
    idx = collections.defaultdict(list)
    for r in results.values():
        idx[norm_team(r["home_team"])].append((parse_iso(r["start_time_utc"]), r))

    # (game, band, market) -> rows
    grouped = collections.defaultdict(list)
    unmatched = 0
    for r in odds:
        ct = parse_iso(r["commence_time"])
        best, bestgap = None, None
        for st, res in idx.get(norm_team(r["home_team"]), []):
            gap = abs((st - ct).total_seconds()) / 3600.0
            if bestgap is None or gap < bestgap:
                best, bestgap = res, gap
        if best is None or bestgap > 6:
            unmatched += 1
            continue
        lead = (ct - parse_iso(r["snapshot_at"])).total_seconds() / 60.0
        band = band_of(lead)
        if band is None:
            continue
        grouped[(best["game_id"], band, r["market"])].append(r)

    # --------------------------------------------------------------------- measure
    agg = collections.defaultdict(lambda: {"games": 0, "quotes": 0, "beat": 0,
                                           "sd": [], "edges": []})
    recs = []        # kept for the confound check below
    for (gid, band, market), rows in grouped.items():
        s = quote_stats(rows, market)
        if not s:
            continue
        lab = labels.get(gid, {})
        bucket = None if lab.get("unknown") else surprise_bucket(lab.get("min_share"))
        recs.append({"band": band, "market": market, "bucket": bucket,
                     "consensus": s["consensus"], "n_quotes": s["n_quotes"],
                     "beat": len(s["beats"])})
        groups = [(band, market, "all")]
        if bucket:
            groups.append((band, market, bucket))
        for g in groups:
            a = agg[g]
            a["games"] += 1
            a["quotes"] += s["n_quotes"]
            a["beat"] += len(s["beats"])
            a["sd"].append(s["sd"])
            a["edges"] += [e for _b, _sd, e in s["beats"]]

    markets = [m.strip() for m in args.markets.split(",")]
    for market in markets:
        print(f"=== {market} " + "=" * (62 - len(market)))
        print(f"   {'band':<22}{'group':<26}{'games':>7}{'quotes':>8}"
              f"{'beat cons.':>12}{'book SD':>9}{'median edge':>13}{'max':>8}")
        for band, _lo, _hi in BANDS:
            for group in ("all",) + tuple(n for n, _l, _h in SURPRISE_BUCKETS):
                a = agg.get((band, market, group))
                if not a or not a["games"]:
                    continue
                med = statistics.median(a["edges"]) if a["edges"] else 0.0
                mx = max(a["edges"]) if a["edges"] else 0.0
                print(f"   {band:<22}{group:<26}{a['games']:>7}{a['quotes']:>8}"
                      f"{a['beat'] / a['quotes']:>11.1%} {statistics.fmean(a['sd']):>8.2%}"
                      f"{med:>12.2%}{mx:>8.2%}")
        print()

    # ------------------------------------------------------- is the gradient a confound?
    # A gradient down the surprise buckets only means something if it is CAUSED by the goalie
    # news. Two checks: (a) does it appear in the pre-confirmation band, where the starter is
    # not yet known and so cannot be causing anything, and (b) is it explained by how lopsided
    # the price is -- de-vigging a heavy favourite is noisier, so books disagree more on
    # extreme numbers regardless of goalies.
    print("=== CONFOUND CHECK: is the surprise gradient really about price extremity? " + "=" * 3)
    for market in markets:
        rs = [r for r in recs if r["market"] == market]
        if not rs:
            continue
        print(f"   {market}: quotes beating consensus, by how lopsided the price is")
        ext = collections.defaultdict(lambda: [0, 0])
        for r in rs:
            k = min(int(abs(r["consensus"] - 0.5) / 0.05), 5)
            ext[k][0] += r["beat"]; ext[k][1] += r["n_quotes"]
        for k in sorted(ext):
            b, q = ext[k]
            lo, hi = k * 5, (k + 1) * 5
            rng = f"{lo}-{hi}%" if k < 5 else "25%+"
            print(f"      consensus {rng:>7} from even{'':<2}{q:>7} quotes{b / q:>8.1%} beat")
        print(f"   {market}: mean distance from an even price, by surprise bucket")
        for name, _l, _h in SURPRISE_BUCKETS:
            v = [abs(r["consensus"] - 0.5) for r in rs if r["bucket"] == name]
            if v:
                print(f"      {name:<26}{statistics.fmean(v):>7.1%}")
        print()

    print("HOW TO READ THIS. 'beat cons.' is the share of individual book quotes paying more than\n"
          "the de-vigged consensus for that side -- the §14c measurement, which found 1% at the\n"
          "close worth a median 0.30%.\n"
          "  * If the pre/post-confirmation bands match the close, books reprice together and\n"
          "    there is NO timing edge -- do not build the panel.\n"
          "  * The test is a DOSE-RESPONSE down the surprise buckets within a band. A rare start\n"
          "    should strand more stale quotes than a routine 1B start if the mechanism is real.\n"
          "    A flat profile is a negative result however large the overall numbers look.\n"
          "Dispersion is a necessary condition for value, not realised profit -- limits and\n"
          "whether the slow book would take the bet are not in this data.")
    if unmatched:
        print(f"\n({unmatched:,} odds row(s) matched no result and were dropped.)")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--results-csv", default="data/nhl_results.csv")
    ap.add_argument("--goalies-csv", default="data/nhl_goalies.csv")
    ap.add_argument("--markets", default="totals,h2h")
    ap.add_argument("--min-prior-team-games", type=int, default=10,
                    help="a team needs this many games played before a start can be called "
                         "unexpected (keeps early-season noise out of the label)")
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
