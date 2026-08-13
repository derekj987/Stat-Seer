"""
The Board — line shopping + key numbers, straight from odds_snapshots.

No model. Pure arithmetic on the odds already in Supabase. Answers the only
question that reliably makes money: *where is the price wrong / best?*

For each game it reports, per market:
  - the BEST available number across all books, and which book has it
  - the shopping edge — how much the best price beats the field, in win-prob points
  - key-number flags on spreads (a half point at 3 is worth ~9%, at 7 ~6.2%)
  - market coherence — the de-vigged fair favorite prob vs the empirical rate for
    that spread over 27 seasons; flags a genuinely divergent price (usually none)

    python analysis/the_board.py            # week 1
    python analysis/the_board.py --week 2

Reads SUPABASE_URL / SUPABASE_SERVICE_KEY from the repo-root .env. Stdlib only.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from statistics import median

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Empirical push cost at each key number (from spread_fundamentals.py / games.csv).
KEY_NUMBERS = {3: 9.0, 7: 6.2}

GAMES_LOCAL = os.path.join(REPO_ROOT, "data", "games.csv")
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
_HIST = None  # cached (fav_mag, fav_margin) pairs for the empirical win curve


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
    """Return one COMPLETE snapshot of the week's odds. SCHEDULED/MANUAL sweeps
    capture every game; PRE_KICKOFF is partial. We pin the board to the most recent
    complete sweep and fetch only that snapshot_at, so the result is both current and
    whole — and stays under PostgREST's 1000-row cap no matter how many snapshots
    have accumulated. (Fetching all rows and de-duping client-side silently drops
    games once the table passes 1000 rows.)"""
    ensure_ssl()
    base = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/odds_snapshots"
    hdr = {"apikey": env["SUPABASE_SERVICE_KEY"],
           "Authorization": f"Bearer {env['SUPABASE_SERVICE_KEY']}"}

    def get(q):
        with urllib.request.urlopen(urllib.request.Request(base + q, headers=hdr),
                                    timeout=45) as r:
            return json.loads(r.read())

    latest = get(f"?season=eq.{season}&week=eq.{week}"
                 "&capture_reason=in.(SCHEDULED,MANUAL)"
                 "&select=snapshot_at&order=snapshot_at.desc&limit=1")
    if not latest:
        return []
    snap = urllib.parse.quote(latest[0]["snapshot_at"], safe="")
    return get(f"?season=eq.{season}&week=eq.{week}&snapshot_at=eq.{snap}"
               "&select=snapshot_at,event_id,commence_time,home_team,away_team,"
               "book,market,outcome_name,outcome_point,price_american&limit=5000")


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


# --------------------------------------------------------- market coherence
def _hist():
    """Cached list of (fav_mag, fav_margin) from games.csv, for the empirical win
    curve. Local file if present, else fetched. Returns None if unavailable so the
    board still works (coherence just omitted)."""
    global _HIST
    if _HIST is not None:
        return _HIST or None
    import csv
    import io
    text = None
    try:
        if os.path.exists(GAMES_LOCAL):
            text = open(GAMES_LOCAL, encoding="utf-8").read()
        else:
            req = urllib.request.Request(GAMES_URL, headers={"User-Agent": "statseer/1.0"})
            with urllib.request.urlopen(req, timeout=45) as r:
                text = r.read().decode("utf-8")
    except Exception:
        _HIST = []
        return None
    pairs = []
    for row in csv.DictReader(io.StringIO(text)):
        if row.get("game_type") != "REG" or not row.get("spread_line") \
                or not row.get("home_score") or not row.get("away_score"):
            continue
        try:
            sp = float(row["spread_line"])          # + = home favored
            margin = int(row["home_score"]) - int(row["away_score"])
            fav_margin = margin if sp >= 0 else -margin
            pairs.append((abs(sp), fav_margin))
        except ValueError:
            continue
    _HIST = pairs
    return pairs or None


def emp_winprob(mag, bw=1.0):
    """Empirical P(favorite wins outright | spread ~ mag), widening if the local
    window is thin. Returns (p, n) or None."""
    pairs = _hist()
    if not pairs:
        return None
    s = [fm for m, fm in pairs if mag - bw <= m <= mag + bw]
    if len(s) < 120:
        s = [fm for m, fm in pairs if mag - 2.5 <= m <= mag + 2.5]
    if not s:
        return None
    wins = sum(1 for fm in s if fm > 0)
    ties = sum(1 for fm in s if fm == 0)
    denom = len(s) - ties
    return (wins / denom, len(s)) if denom else None


def coherence(h2h_rows, consensus_spread, home, away):
    """De-vig the live moneyline and compare the market's fair favorite win prob to
    the empirical rate for that spread. Returns a dict, or None if not computable.
    Most games come back 'coherent' — that is the honest, trust-building result."""
    if consensus_spread is None or not h2h_rows:
        return None
    fav = home if consensus_spread < 0 else away
    mag = abs(consensus_spread)
    by_book = defaultdict(dict)
    for r in h2h_rows:
        by_book[r["book"]][r["outcome_name"]] = r["price_american"]
    holds, fav_fair = [], []
    for sides in by_book.values():
        if fav not in sides or len(sides) != 2:
            continue
        p_fav = implied(sides[fav])
        p_dog = implied(next(v for k, v in sides.items() if k != fav))
        s = p_fav + p_dog
        if s > 0:
            holds.append(s - 1.0)
            fav_fair.append(p_fav / s)
    emp = emp_winprob(mag)
    if not fav_fair or emp is None:
        return None
    mkt = median(fav_fair)
    gap = mkt - emp[0]
    # The absolute gap carries era-drift: modern favorites at a given spread win at
    # a slightly different rate than the 27-year average, so a moderate gap is NOT a
    # mispricing (two 3.5-favorites both showing +3.4 is the curve, not the market).
    # The market is the sharper forecast (docs: market MAE 9.89 < line-blind 10.15).
    # Only a large gap is worth a human look — as "investigate a possibly stale/soft
    # line", never as a pick. Everything else is coherent: the honest, expected result.
    flag = "investigate" if abs(gap) > 0.055 else "coherent"
    return dict(fav=fav, hold=median(holds), mkt_fair=mkt,
                emp=emp[0], gap=gap, flag=flag, n=emp[1])


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
        spr = spread(by_market.get("spreads", []), home, away)
        board.append({
            "matchup": f"{away} @ {home}", "home": home, "away": away,
            "commence": rs[0]["commence_time"], "snapshot": rs[0]["snapshot_at"],
            "ml": moneyline(by_market.get("h2h", [])),
            "spread": spr,
            "total": total(by_market.get("totals", [])),
            "coherence": coherence(by_market.get("h2h", []), spr["consensus"],
                                   home, away),
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
        # coherence
        c = g.get("coherence")
        if c:
            tag = "INVESTIGATE" if c["flag"] == "investigate" else "coherent"
            print(f"  COH  market {tag} — {c['fav']} priced {100*c['mkt_fair']:.0f}% "
                  f"vs 27-yr {100*c['emp']:.0f}% ({100*c['gap']:+.1f}) · "
                  f"hold {100*c['hold']:.1f}%")
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
