"""
prop_backtest.py -- validate player props against reality, using the backfilled historical
prop snapshots (prop_snapshots, capture_reason=BACKFILL) + actual nflverse results.

Answers the questions the odds-history purchase unblocked, for props:
  1. Is the closing prop LINE efficient? (over-hit rate - a big deviation from ~50% is a
     standing bias you could bet blindly.)
  2. What is line-SHOPPING worth on props? (best book vs consensus price, in implied %.)
  3. Are prices CALIBRATED? (bucket by closing implied prob, compare to actual hit rate.)

This characterizes the MARKET. Testing whether OUR projection beats the line out of sample is
the next layer (needs per-week historical projections) - noted at the end.

    python analysis/prop_backtest.py --season 2024
    python analysis/prop_backtest.py --season 2024 --weeks 1-8

Reads prop_snapshots from Supabase (BACKFILL rows) + data/stats_<season>.csv. Stdlib + odds_client.
"""
import argparse
import csv
import os
import statistics
import sys
import urllib.parse
import urllib.request
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo root
import odds_client as oc

# market -> (nflverse stat column, is_anytime_td)
MARKET = {
    "player_pass_yds": ("passing_yards", False),
    "player_pass_tds": ("passing_tds", False),
    "player_rush_yds": ("rushing_yards", False),
    "player_reception_yds": ("receiving_yards", False),
    "player_receptions": ("receptions", False),
    "player_anytime_td": (None, True),
}
LABEL = {"player_pass_yds": "passing yards", "player_pass_tds": "passing TDs",
         "player_rush_yds": "rushing yards", "player_reception_yds": "receiving yards",
         "player_receptions": "receptions", "player_anytime_td": "anytime TD"}


def norm(n):
    import re, unicodedata
    n = unicodedata.normalize("NFKD", n or "")
    n = "".join(c for c in n if not unicodedata.combining(c)).lower().replace("'", "")
    n = re.sub(r"[^a-z ]", " ", n)
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", n)
    return " ".join(n.split())


def implied(p):
    return (-p) / (-p + 100) if p < 0 else 100 / (p + 100)


def read_props(env, season, weeks):
    """All BACKFILL prop rows for the season (paginated)."""
    base = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/prop_snapshots"
    key = env["SUPABASE_SERVICE_KEY"]
    wk = f"&week=in.({','.join(map(str, weeks))})" if weeks else ""
    q = (f"?capture_reason=eq.BACKFILL&season=eq.{season}{wk}"
         "&select=snapshot_at,event_id,commence_time,season,week,player_name,market,side,line,price_american,book")
    out, PAGE = [], 1000
    for off in range(0, 2_000_000, PAGE):
        req = urllib.request.Request(base + q, headers={
            "apikey": key, "Authorization": f"Bearer {key}",
            "Range": f"{off}-{off+PAGE-1}", "Range-Unit": "items"})
        import json
        page = json.loads(urllib.request.urlopen(req, timeout=90).read())
        out += page
        if len(page) < PAGE:
            break
    return out


def load_actuals(season):
    """(week, normalized name) -> stat dict, from nflverse weekly stats."""
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return None
    out = {}
    with open(path, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            nm = norm(r.get("player_display_name") or r.get("player_name") or "")
            wk = r.get("week")
            if not nm or not str(wk).isdigit():
                continue
            def num(c):
                try: return float(r.get(c) or 0)
                except ValueError: return 0.0
            out[(int(wk), nm)] = {
                "passing_yards": num("passing_yards"), "passing_tds": num("passing_tds"),
                "rushing_yards": num("rushing_yards"), "rushing_tds": num("rushing_tds"),
                "receiving_yards": num("receiving_yards"), "receiving_tds": num("receiving_tds"),
                "receptions": num("receptions"),
            }
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--weeks", default=None, help="e.g. 1-8 or 1,2,3 (default: all)")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    env = oc.load_env()
    weeks = None
    if args.weeks:
        weeks = set()
        for part in args.weeks.split(","):
            if "-" in part: a, b = part.split("-"); weeks |= set(range(int(a), int(b) + 1))
            elif part.strip(): weeks.add(int(part))
        weeks = sorted(weeks)

    actuals = load_actuals(args.season)
    if actuals is None:
        print(f"ERROR: data/stats_{args.season}.csv not found (needed for actual results).", file=sys.stderr)
        return 1
    rows = read_props(env, args.season, weeks)
    if not rows:
        print(f"No BACKFILL prop rows for {args.season} yet - is the backfill still running / did it --write?")
        return 0

    # closing snapshot per event = the latest snapshot at/just before kickoff.
    close_at = {}
    for r in rows:
        e = r["event_id"]; s = r["snapshot_at"]
        if s <= r["commence_time"] and (e not in close_at or s > close_at[e]):
            close_at[e] = s

    # group closing rows by (week, event, player, market), keeping prices BY LINE so
    # shopping compares the SAME line across books (never a -110 over on 249.5 vs a +200
    # over on 275.5 — that's a different bet).
    grp = defaultdict(lambda: {"over": defaultdict(list), "under": defaultdict(list), "yes": []})
    for r in rows:
        if r["snapshot_at"] != close_at.get(r["event_id"]):
            continue
        k = (int(r["week"]), r["event_id"], norm(r["player_name"]), r["player_name"], r["market"])
        g = grp[k]
        side = (r["side"] or "").lower(); price = r.get("price_american")
        if price is None:
            continue
        if side == "yes":
            g["yes"].append(int(price)); continue
        if r["line"] is None:
            continue
        if side == "over": g["over"][float(r["line"])].append(int(price))
        elif side == "under": g["under"][float(r["line"])].append(int(price))

    # grade
    by_market = defaultdict(lambda: {"n": 0, "over": 0, "push": 0})
    shop = defaultdict(list)          # market -> best-vs-median implied edge (over side)
    calib = defaultdict(lambda: [0, 0])  # implied-bucket -> [hits, n]
    td = {"n": 0, "hit": 0, "impl": []}
    graded_players = set()
    unmatched = 0

    from collections import Counter
    for (wk, _e, nm, _disp, market), g in grp.items():
        stat_col, is_td = MARKET.get(market, (None, False))
        act = actuals.get((wk, nm))
        if act is None:
            unmatched += 1
            continue
        graded_players.add(nm)
        if is_td:
            if not g["yes"]:
                continue
            hit = (act["rushing_tds"] + act["receiving_tds"]) >= 1
            td["n"] += 1; td["hit"] += 1 if hit else 0
            td["impl"].append(implied(max(g["yes"])))   # best (longest) yes price
            continue
        if not stat_col:
            continue
        # consensus line = the most-quoted line across books (over + under quotes).
        counts = Counter()
        for L, ps in g["over"].items(): counts[L] += len(ps)
        for L, ps in g["under"].items(): counts[L] += len(ps)
        if not counts:
            continue
        line = counts.most_common(1)[0][0]
        overs = g["over"].get(line, [])
        actual = act[stat_col]
        m = by_market[market]; m["n"] += 1
        if actual == line: m["push"] += 1
        elif actual > line: m["over"] += 1
        # shopping value on the OVER side at THE SAME line: best price vs consensus price.
        if len(overs) >= 2:
            best_imp = implied(max(overs)); med_imp = implied(int(statistics.median(overs)))
            shop[market].append(med_imp - best_imp)   # you pay less implied at the best price
        # calibration: closing implied (median over price at the line) vs actual over outcome.
        if overs:
            ip = implied(int(statistics.median(overs)))
            b = min(int(ip * 10), 9)
            calib[b][1] += 1
            if actual > line: calib[b][0] += 1

    # ---- report ----
    total = sum(m["n"] for m in by_market.values())
    print(f"PROP BACKTEST - {args.season}{' wk ' + args.weeks if args.weeks else ''} "
          f"(BACKFILL closing lines vs actual)")
    print(f"  graded {total} over/under props + {td['n']} anytime-TD props "
          f"across {len(graded_players)} players; {unmatched} unmatched to a stat line\n")

    print("  Over-hit rate at the closing line (efficient market ~ 50%):")
    for market in ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_receptions", "player_pass_tds"]:
        m = by_market.get(market)
        if not m or m["n"] == 0:
            continue
        dec = m["n"] - m["push"]
        pct = 100.0 * m["over"] / dec if dec else 0
        print(f"    {LABEL[market]:16s}: {pct:5.1f}% over   (n={m['n']}, pushes={m['push']})")
    if td["n"]:
        hr = 100.0 * td["hit"] / td["n"]
        ai = 100.0 * statistics.mean(td["impl"]) if td["impl"] else 0
        print(f"    {'anytime TD (Yes)':16s}: {hr:5.1f}% hit    (n={td['n']}, best-price implied {ai:.1f}%)")

    print("\n  Line-shopping value on props (best book vs consensus, OVER side):")
    for market, xs in sorted(shop.items()):
        if xs:
            print(f"    {LABEL[market]:16s}: {100*statistics.mean(xs):+.2f}% implied avg   (n={len(xs)})")

    cal = [(b, h, n) for b, (h, n) in sorted(calib.items()) if n >= 15]
    if cal:
        print("\n  Calibration - closing implied (over) vs actual over-rate:")
        for b, h, n in cal:
            print(f"    implied {b*10:2d}-{b*10+10:2d}% -> actual {100.0*h/n:4.1f}% over   (n={n})")

    print("\n  NEXT: this is market efficiency + shopping value. To test whether OUR projection")
    print("  beats the line out of sample, generate per-week projections from pre-week data and")
    print("  grade proj-vs-line-vs-actual (a prop_edge_model backtest) - the true edge question.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
