"""
The Board — line shopping + key numbers, straight from odds_snapshots.

No model. Pure arithmetic on the odds already in Supabase. Answers the only
question that reliably makes money: *where is the price wrong / best?*

For each game it reports, per market:
  - the BEST available number across all books, and which book has it
  - the shopping edge — how much the best price beats the field, in win-prob points
  - key-number flags on spreads (a half point at 3 is worth ~9%, at 7 ~6.2%)

    python analysis/the_board.py            # week 1
    python analysis/the_board.py --week 2

Reads SUPABASE_URL / SUPABASE_SERVICE_KEY from the repo-root .env. Stdlib only.
"""
import argparse
import json
import os
import sys
import urllib.request
from collections import defaultdict
from statistics import median

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Empirical push cost at each key number (from spread_fundamentals.py / games.csv).
KEY_NUMBERS = {3: 9.0, 7: 6.2}


def load_env():
    env = {}
    path = os.path.join(REPO_ROOT, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.split("#", 1)[0].strip()
    return env


def ensure_ssl():
    if not os.environ.get("SSL_CERT_FILE"):
        try:
            import certifi
            os.environ["SSL_CERT_FILE"] = certifi.where()
        except Exception:
            pass


# ------------------------------------------------------------- odds math
def implied(price):
    """American odds -> implied win probability (with vig)."""
    return (-price) / (-price + 100) if price < 0 else 100 / (price + 100)


def fmt_odds(price):
    return f"+{price}" if price > 0 else str(price)


# ------------------------------------------------------------- fetch
def fetch_week(env, week, season=2026):
    ensure_ssl()
    base = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/odds_snapshots"
    key = env["SUPABASE_SERVICE_KEY"]
    q = (f"?season=eq.{season}&week=eq.{week}"
         "&select=snapshot_at,event_id,commence_time,home_team,away_team,"
         "book,market,outcome_name,outcome_point,price_american"
         "&order=event_id&limit=5000")
    req = urllib.request.Request(base + q, headers={
        "apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=45) as r:
        rows = json.loads(r.read())
    # keep only the latest snapshot per (event,market,book,outcome,point)
    latest = {}
    for r in rows:
        k = (r["event_id"], r["market"], r["book"], r["outcome_name"],
             r["outcome_point"])
        if k not in latest or r["snapshot_at"] > latest[k]["snapshot_at"]:
            latest[k] = r
    return list(latest.values())


# ------------------------------------------------------------- board
def best_price(rows):
    """Highest American price is best for the bettor. Returns (price, books) where
    books is every book offering that price -- so ties are visible, not hidden."""
    top = max(r["price_american"] for r in rows)
    books = sorted({r["book"] for r in rows if r["price_american"] == top})
    return top, books


def book_label(books):
    """Terminal label: name one book, note the tie count. e.g. 'betus +3'."""
    return books[0] + (f" +{len(books) - 1}" if len(books) > 1 else "")


def moneyline(rows):
    """Per side: best price + shopping edge (field-median vs best, in prob points)."""
    sides = defaultdict(list)
    for r in rows:
        sides[r["outcome_name"]].append(r)
    out = {}
    for side, rs in sides.items():
        prices = [r["price_american"] for r in rs]
        bp, books = best_price(rs)
        edge = (median(implied(p) for p in prices) - implied(bp)) * 100
        out[side] = (bp, books, edge, len(rs))
    return out


def line_side(rows, want="max_point"):
    """Best line for one spread/total side. want='max_point' (spreads, unders)
    or 'min_point' (overs). Ties broken by best price."""
    pts = [r["outcome_point"] for r in rows if r["outcome_point"] is not None]
    if not pts:
        return None
    tgt = max(pts) if want == "max_point" else min(pts)
    at = [r for r in rows if r["outcome_point"] == tgt]
    price, books = best_price(at)
    return tgt, price, books


def spread(rows, home, away):
    sides = defaultdict(list)
    for r in rows:
        sides[r["outcome_name"]].append(r)
    home_pts = [r["outcome_point"] for r in sides.get(home, [])
                if r["outcome_point"] is not None]
    consensus = median(home_pts) if home_pts else None
    key = None
    if consensus is not None and abs(consensus) in KEY_NUMBERS:
        key = (abs(consensus), KEY_NUMBERS[abs(consensus)])
    return {
        "consensus": consensus,
        home: line_side(sides.get(home, []), "max_point"),
        away: line_side(sides.get(away, []), "max_point"),
        "key": key,
    }


def total(rows):
    sides = defaultdict(list)
    for r in rows:
        sides[r["outcome_name"]].append(r)
    pts = [r["outcome_point"] for r in rows if r["outcome_point"] is not None]
    return {
        "consensus": median(pts) if pts else None,
        "Over": line_side(sides.get("Over", []), "min_point"),
        "Under": line_side(sides.get("Under", []), "max_point"),
    }


def build(rows):
    games = defaultdict(list)
    for r in rows:
        games[r["event_id"]].append(r)
    board = []
    for eid, rs in games.items():
        home, away = rs[0]["home_team"], rs[0]["away_team"]
        by_market = defaultdict(list)
        for r in rs:
            by_market[r["market"]].append(r)
        board.append({
            "matchup": f"{away} @ {home}", "home": home, "away": away,
            "commence": rs[0]["commence_time"], "snapshot": rs[0]["snapshot_at"],
            "ml": moneyline(by_market.get("h2h", [])),
            "spread": spread(by_market.get("spreads", []), home, away),
            "total": total(by_market.get("totals", [])),
        })
    board.sort(key=lambda g: g["commence"])
    return board


def render(board, week):
    if not board:
        print(f"No odds in Supabase for week {week}.")
        return
    snap = board[0]["snapshot"]
    print(f"\nVALUE FINDER — Week {week}   (lines as of {snap})")
    print("=" * 78)
    edges = []
    for g in board:
        print(f"\n{g['matchup']:<11}  kickoff {g['commence']}")
        # moneyline
        ml = g["ml"]
        parts = []
        for side, (price, books, edge, n) in ml.items():
            parts.append(f"{side} {fmt_odds(price):>5} {book_label(books)}")
            edges.append(edge)
        best_edge = max((e for _, (_, _, e, _) in ml.items()), default=0)
        print(f"  ML   {'   '.join(parts)}   | best shop edge +{best_edge:.1f}%")
        # spread
        s = g["spread"]
        if s[g["home"]] and s[g["away"]]:
            hp, hpr, hb = s[g["home"]]
            ap, apr, ab = s[g["away"]]
            flag = ""
            if s["key"]:
                num, cost = s["key"]
                flag = f"   *** KEY NUMBER {int(num)} — half point ~{cost:.0f}% ***"
            print(f"  SPR  {g['home']} {hp:+g} ({fmt_odds(hpr)}) {book_label(hb)}   "
                  f"{g['away']} {ap:+g} ({fmt_odds(apr)}) {book_label(ab)}{flag}")
        # total
        t = g["total"]
        if t["Over"] and t["Under"]:
            op, opr, ob = t["Over"]
            up, upr, ub = t["Under"]
            print(f"  TOT  O {op:g} ({fmt_odds(opr)}) {book_label(ob)}   "
                  f"U {up:g} ({fmt_odds(upr)}) {book_label(ub)}")
    print("\n" + "=" * 78)
    if edges:
        avg = sum(edges) / len(edges)
        print(f"Avg moneyline shopping edge across the board: +{avg:.2f}% win prob "
              f"per side — free, no model. That is the Value Finder.")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--week", type=int, default=1)
    ap.add_argument("--season", type=int, default=2026)
    args = ap.parse_args(argv)

    env = load_env()
    if not env.get("SUPABASE_URL") or not env.get("SUPABASE_SERVICE_KEY"):
        print("ERROR: SUPABASE creds missing in .env", file=sys.stderr)
        return 1
    rows = fetch_week(env, args.week, args.season)
    render(build(rows), args.week)
    return 0


if __name__ == "__main__":
    sys.exit(main())
