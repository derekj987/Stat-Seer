"""
clv_backtest.py -- validate GAME LINES (spreads, totals, moneyline) against reality, from the
backfilled historical odds (odds_snapshots, capture_reason=BACKFILL) + actual scores.

The counterpart to prop_backtest.py. Reports, on closing lines vs results:
  1. ATS + over/under cover rates (efficient market ~ 50% each way) and key-number frequency.
  2. Moneyline line-SHOPPING value (best book vs consensus, in implied %).
  3. Line MOVEMENT / CLV — if the backfill captured more than the closing snapshot (e.g.
     --offsets 0.1,24), how far the consensus spread moved open->close (a CLV proxy).

    python analysis/clv_backtest.py --season 2024
    python analysis/clv_backtest.py --season 2024 --weeks 1-8

Reads odds_snapshots (BACKFILL) from Supabase + data/games.csv (scores). Stdlib + odds_client.
"""
import argparse
import csv
import json
import os
import statistics
import sys
import urllib.request
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo root
import odds_client as oc

ALIAS = {"LAR": "LA", "OAK": "LV", "SD": "LAC", "STL": "LA", "WSH": "WAS"}
KEY_MARGINS = (3, 7, 10, 14)


def implied(p):
    return (-p) / (-p + 100) if p < 0 else 100 / (p + 100)


def read_lines(env, season, weeks):
    base = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/odds_snapshots"
    key = env["SUPABASE_SERVICE_KEY"]
    wk = f"&week=in.({','.join(map(str, weeks))})" if weeks else ""
    q = (f"?capture_reason=eq.BACKFILL&season=eq.{season}{wk}"
         "&select=snapshot_at,event_id,commence_time,week,home_team,away_team,book,market,"
         "outcome_name,outcome_point,price_american")
    out, PAGE = [], 1000
    for off in range(0, 3_000_000, PAGE):
        req = urllib.request.Request(base + q, headers={
            "apikey": key, "Authorization": f"Bearer {key}",
            "Range": f"{off}-{off+PAGE-1}", "Range-Unit": "items"})
        page = json.loads(urllib.request.urlopen(req, timeout=90).read())
        out += page
        if len(page) < PAGE:
            break
    return out


def load_results(season):
    """(home, away) -> (margin=home-away, total) for completed REG games of the season."""
    out = {}
    with open(oc.GAMES_LOCAL, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if str(r.get("season")) != str(season) or r.get("game_type") != "REG":
                continue
            try:
                hs, as_ = float(r["home_score"]), float(r["away_score"])
            except (ValueError, KeyError, TypeError):
                continue
            h = ALIAS.get((r["home_team"] or "").upper(), (r["home_team"] or "").upper())
            a = ALIAS.get((r["away_team"] or "").upper(), (r["away_team"] or "").upper())
            out[(h, a)] = (hs - as_, hs + as_)
    return out


def median(xs):
    return statistics.median(xs) if xs else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--weeks", default=None)
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    env = oc.load_env()
    weeks = None
    if args.weeks:
        weeks = set()
        for p in args.weeks.split(","):
            if "-" in p: a, b = p.split("-"); weeks |= set(range(int(a), int(b) + 1))
            elif p.strip(): weeks.add(int(p))
        weeks = sorted(weeks)

    results = load_results(args.season)
    rows = read_lines(env, args.season, weeks)
    if not rows:
        print(f"No BACKFILL line rows for {args.season} yet - is the backfill still running / did it --write?")
        return 0

    # snapshots per event (for movement) + the closing snapshot
    snaps = defaultdict(set)
    for r in rows:
        if r["snapshot_at"] <= r["commence_time"]:
            snaps[r["event_id"]].add(r["snapshot_at"])
    close_at = {e: max(ss) for e, ss in snaps.items()}
    open_at = {e: min(ss) for e, ss in snaps.items() if len(ss) > 1}

    # per event: home team/away + per-snapshot home-spread median + closing consensus total + ml best/median
    ev = defaultdict(lambda: {"home": None, "away": None,
                              "spread_by_snap": defaultdict(list), "total_close": [],
                              "ml_close": defaultdict(list)})
    for r in rows:
        e = ev[r["event_id"]]
        e["home"] = ALIAS.get((r["home_team"] or "").upper(), (r["home_team"] or "").upper())
        e["away"] = ALIAS.get((r["away_team"] or "").upper(), (r["away_team"] or "").upper())
        closing = r["snapshot_at"] == close_at.get(r["event_id"])
        if r["market"] == "spreads" and r["outcome_point"] is not None and r["outcome_name"] == r["home_team"]:
            e["spread_by_snap"][r["snapshot_at"]].append(float(r["outcome_point"]))
        if closing and r["market"] == "totals" and r["outcome_point"] is not None:
            e["total_close"].append(float(r["outcome_point"]))
        if closing and r["market"] == "h2h" and r["price_american"] is not None:
            e["ml_close"][r["outcome_name"]].append(int(r["price_american"]))

    ats = {"n": 0, "home": 0, "push": 0, "fav": 0, "favn": 0}
    ou = {"n": 0, "over": 0, "push": 0}
    keymarg = defaultdict(int); ng = 0
    shop = []
    move = []

    for eid, e in ev.items():
        res = results.get((e["home"], e["away"]))
        if res is None:
            continue
        margin, total_pts = res
        ng += 1
        km = abs(int(round(margin)))
        if km in KEY_MARGINS:
            keymarg[km] += 1
        # spread ATS at closing
        cl = median(e["spread_by_snap"].get(close_at.get(eid), []))
        if cl is not None:
            ats["n"] += 1
            cover = margin + cl               # >0 home covers
            if abs(cover) < 1e-9: ats["push"] += 1
            elif cover > 0: ats["home"] += 1
            # favorite cover
            if cl != 0:
                fav_home = cl < 0
                fav_cover = (cover > 0) if fav_home else (cover < 0)
                ats["favn"] += 1; ats["fav"] += 1 if fav_cover else 0
        # total OU at closing
        tc = median(e["total_close"])
        if tc is not None:
            ou["n"] += 1
            if abs(total_pts - tc) < 1e-9: ou["push"] += 1
            elif total_pts > tc: ou["over"] += 1
        # moneyline shopping: best vs consensus implied, per side, averaged
        for side, ps in e["ml_close"].items():
            if len(ps) >= 2:
                shop.append(implied(int(median(ps))) - implied(max(ps)))
        # line movement open->close (consensus home spread)
        if eid in open_at:
            op = median(e["spread_by_snap"].get(open_at[eid], []))
            clm = median(e["spread_by_snap"].get(close_at[eid], []))
            if op is not None and clm is not None:
                move.append(clm - op)

    print(f"CLV / GAME-LINE BACKTEST - {args.season}{' wk ' + args.weeks if args.weeks else ''} "
          f"(BACKFILL closing lines vs results)")
    print(f"  {ng} game(s) with a final score matched\n")

    if ats["n"]:
        dec = ats["n"] - ats["push"]
        print("  Against the spread (closing consensus):")
        print(f"    home cover : {100.0*ats['home']/dec:5.1f}%   (n={ats['n']}, pushes={ats['push']})")
        if ats["favn"]:
            print(f"    favorite   : {100.0*ats['fav']/ats['favn']:5.1f}% cover   (efficient ~ 50%)")
    if ou["n"]:
        dec = ou["n"] - ou["push"]
        print(f"  Over/Under : {100.0*ou['over']/dec:5.1f}% over   (n={ou['n']}, pushes={ou['push']})")
    if ng:
        print("  Key numbers (final margin landed exactly on):")
        for k in KEY_MARGINS:
            print(f"    {k:2d}: {100.0*keymarg[k]/ng:4.1f}%   (n={keymarg[k]})")
    if shop:
        beats = sum(1 for x in shop if x >= 0.01)
        print(f"\n  Moneyline line-shopping value: {100*statistics.mean(shop):+.2f}% implied avg "
              f"(n={len(shop)} sides); best beats consensus by >=1% on {100.0*beats/len(shop):.0f}%")
    if move:
        toward_home = sum(1 for x in move if x < 0)   # more negative home line = toward home
        print(f"  Line movement open->close (home spread): avg {statistics.mean(move):+.2f} pt, "
              f"|avg| {statistics.mean(abs(x) for x in move):.2f} pt (n={len(move)}); "
              f"moved toward home {100.0*toward_home/len(move):.0f}%")
    else:
        print("\n  (No open->close movement: backfill captured a single snapshot per game. Re-run the "
              "backfill with --offsets 0.1,24 to measure line movement / CLV.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
