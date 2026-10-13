"""Is the starting goalie already priced into the NHL closing line?

The project's standing bar: a candidate enters a model only if it is observable and recorded in
advance, has a mechanism stated beforehand, and improves results AGAINST THE CLOSING LINE out of
sample. This answers that for the one input hockey people treat as obvious.

MECHANISM, STATED IN ADVANCE: a goalie faces ~30 shots a game, so a save-percentage gap of one
point between the two starters is worth roughly 0.3 goals — a real fraction of the ~2.6-goal
margin SD. Starters are announced in the morning, hours before the close. So EITHER the market has
already moved on the announcement (in which case the goalie is priced and this is Context, not an
edge), OR it has not (in which case a cheap, observable input beats the close).

WHAT IS JOINED
  nhl_goalie_starts   who actually started, from the NHL API (analysis: nhl_goalies.py)
  nhl_odds_snapshots  the closing moneyline, four backfilled seasons (2021-22 .. 2024-25)
  the final score      reconstructed from the goalie rows: a team's goals-against, summed over its
                       goalies, IS the opponent's goals. No extra source needed.

🚨 NO LOOK-AHEAD. A starter's quality is his save percentage over games STRICTLY BEFORE this one,
shrunk toward the league mean by SHRINK_SHOTS so a goalie with two starts does not arrive at .950
and dominate the signal. Using season-long or career numbers would leak the outcome into the
predictor and is the single easiest way to fake an edge here.

TWO TESTS, because they fail differently:
  1. CALIBRATION  regress the market's own error (did home win, minus the de-vigged market
                  probability) on the goalie gap. If the market prices goalies, the slope is ~0.
  2. BETTING      bet the side with the better goalie, graded at the closing price. The bar is not
                  50% — it is the break-even rate the price itself implies, which is what "beats
                  the vig" means.

    python analysis/nhl_goalie_vs_close.py
    python analysis/nhl_goalie_vs_close.py --min-gap 1.5 --holdout 20242025
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sqlite3
import statistics as st
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "analysis"))

import odds_client as oc  # noqa: E402

DB = os.path.join(ROOT, "data", "nhl.db")
SHRINK_SHOTS = 500          # prior-strength, in shots faced, toward the league mean save%
MIN_PRIOR_SHOTS = 200       # below this a starter has no usable history and the game is skipped

# Franchises the odds feed names differently from today's roster map, or that have since moved.
# Without these the join silently drops a club-season rather than failing.
EXTRA_TEAM = {
    "arizonacoyotes": "ARI", "phoenixcoyotes": "ARI",
    "utahhockeyclub": "UTA", "utahmammoth": "UTA",
    "montrealcanadiens": "MTL", "stlouisblues": "STL",
}


def imp(american):
    return 100.0 / (american + 100.0) if american > 0 else (-american) / ((-american) + 100.0)


def pg_all(path):
    env = oc.load_env()
    url, key = env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_KEY"]
    out, off = [], 0
    while True:
        req = urllib.request.Request(f"{url}/rest/v1/{path}",
                                     headers={"apikey": key, "Authorization": f"Bearer {key}",
                                              "Range-Unit": "items", "Range": f"{off}-{off+999}"})
        with urllib.request.urlopen(req, timeout=90) as r:
            b = json.loads(r.read())
        out += b
        if len(b) < 1000:
            return out
        off += 1000


def team_key(s):
    import re
    import unicodedata
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s.lower())


def abbrev_map():
    m = dict(EXTRA_TEAM)
    try:
        src = open(os.path.join(ROOT, "web", "lib", "nhlRosters.ts"), encoding="utf-8").read()
        import re
        block = re.search(r"NHL_TEAM_ABBREV[^{]*\{(.*?)\n\};", src, re.S)
        for k, v in re.findall(r'"([a-z0-9]+)":\s*"([A-Z]+)"', block.group(1) if block else ""):
            m.setdefault(k, v)
    except Exception:  # noqa: BLE001
        pass
    return m


def load_games():
    """{(date, frozenset{home_ab, away_ab})): game dict} with starters, score and rest."""
    conn = sqlite3.connect(DB)
    rows = conn.execute(
        "select game_id, season, game_date, team, opponent, is_home, goalie_id, goalie_name,"
        "       is_starter, shots_against, saves, goals_against"
        "  from nhl_goalie_starts").fetchall()
    conn.close()
    by = collections.defaultdict(list)
    for r in rows:
        by[r[0]].append(r)
    games = {}
    for gid, rs in by.items():
        sides = collections.defaultdict(list)
        for r in rs:
            sides[r[3]].append(r)
        if len(sides) != 2:
            continue
        g = {"game_id": gid, "season": rs[0][1], "date": rs[0][2], "teams": {}}
        ok = True
        for team, rr in sides.items():
            starter = [x for x in rr if x[8] == 1]
            if len(starter) != 1:
                ok = False
                break
            s = starter[0]
            # A team's goals-against, summed over its goalies, is what the OPPONENT scored.
            ga = sum(x[11] or 0 for x in rr)
            g["teams"][team] = {"is_home": bool(s[5]), "opp": s[4], "starter_id": s[6],
                                "starter_name": s[7], "conceded": ga}
        if not ok or len(g["teams"]) != 2:
            continue
        games[gid] = g
    return games


def goalie_history(games):
    """{(game_id, goalie_id): (prior_saves, prior_shots)} — strictly games BEFORE this one."""
    conn = sqlite3.connect(DB)
    rows = conn.execute(
        "select goalie_id, game_date, game_id, shots_against, saves from nhl_goalie_starts"
        " where shots_against is not null and saves is not null order by goalie_id, game_date, game_id"
    ).fetchall()
    conn.close()
    out, acc = {}, collections.defaultdict(lambda: [0, 0])
    for gid_, date_, game_id, sa, sv in rows:
        a = acc[gid_]
        out[(game_id, gid_)] = (a[0], a[1])     # BEFORE adding this game
        a[0] += sv or 0
        a[1] += sa or 0
    return out


def closing_moneyline():
    """{event_key: (p_home_devig, home_price, away_price, home_name, away_name, date)}"""
    rows = pg_all("nhl_odds_snapshots?select=event_id,commence_time,home_team,away_team,book,"
                  "market,outcome_name,price_american,snapshot_at&market=eq.h2h")
    byev = collections.defaultdict(list)
    for r in rows:
        byev[r["event_id"]].append(r)
    out = {}
    for ev, rs in byev.items():
        # The CLOSE: the latest snapshot we hold for this event.
        last = max(r["snapshot_at"] for r in rs)
        rs = [r for r in rs if r["snapshot_at"] == last]
        home, away = rs[0]["home_team"], rs[0]["away_team"]
        hp = [r["price_american"] for r in rs if r["outcome_name"] == home]
        ap = [r["price_american"] for r in rs if r["outcome_name"] == away]
        if not hp or not ap:
            continue
        # Median across books, then de-vig the pair — one book's outlier should not set the market.
        mh, ma = st.median(hp), st.median(ap)
        ih, ia = imp(mh), imp(ma)
        if ih + ia <= 0:
            continue
        out[ev] = {"p_home": ih / (ih + ia), "home_price": mh, "away_price": ma,
                   "home": home, "away": away, "date": rs[0]["commence_time"][:10]}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--min-gap", type=float, default=0.0,
                    help="only bet when the save%% gap exceeds this many POINTS")
    ap.add_argument("--holdout", default="", help="season id held out, e.g. 20242025")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    AB = abbrev_map()
    games = load_games()
    hist = goalie_history(games)
    print(f"goalie games: {len(games)}")
    mls = closing_moneyline()
    print(f"events with a closing moneyline: {len(mls)}")

    # Join on (date, the pair of teams). A date plus two clubs is unique in the NHL.
    index = {}
    for gid, g in games.items():
        abs_ = frozenset(g["teams"].keys())
        index[(g["date"], abs_)] = g

    joined, unmapped = [], collections.Counter()
    for ev, m in mls.items():
        h, a = AB.get(team_key(m["home"])), AB.get(team_key(m["away"]))
        if not h or not a:
            unmapped[m["home"] if not h else m["away"]] += 1
            continue
        # 🚨 A LATE PUCK DROP IS THE NEXT DAY IN UTC. The odds feed's commence_time is UTC and the
        # NHL's gameDate is the local date, so a 10pm ET game is 02:00 UTC tomorrow. Keying on the
        # UTC date alone matched only 1,261 of 3,987 events — it quietly threw away the whole late
        # window, which is most of the Western conference. Try the neighbouring dates too; a date
        # plus a pair of clubs is still unique, because the same two teams cannot play twice inside
        # 48 hours in this schedule.
        import datetime as _dt
        g = None
        try:
            base = _dt.date.fromisoformat(m["date"])
        except ValueError:
            continue
        for delta in (0, -1, 1):
            g = index.get(((base + _dt.timedelta(days=delta)).isoformat(), frozenset((h, a))))
            if g is not None:
                break
        if g is None:
            continue
        joined.append((g, m, h, a))
    print(f"joined games (goalies + closing line): {len(joined)}")
    if unmapped:
        print(f"  team names that did not map: {dict(unmapped.most_common(6))}")
    if not joined:
        return 0

    # League-mean save% for the shrink, from the pairs themselves.
    allsv = sum(x[0] for x in hist.values()), sum(x[1] for x in hist.values())
    lg = allsv[0] / allsv[1] if allsv[1] else 0.9
    print(f"league save% baseline: {lg:.4f}\n")

    rows = []
    for g, m, h, a in joined:
        th, ta = g["teams"][h], g["teams"][a]
        ph = hist.get((g["game_id"], th["starter_id"]), (0, 0))
        pa = hist.get((g["game_id"], ta["starter_id"]), (0, 0))
        if ph[1] < MIN_PRIOR_SHOTS or pa[1] < MIN_PRIOR_SHOTS:
            continue
        qh = (ph[0] + lg * SHRINK_SHOTS) / (ph[1] + SHRINK_SHOTS)
        qa = (pa[0] + lg * SHRINK_SHOTS) / (pa[1] + SHRINK_SHOTS)
        gap = (qh - qa) * 100.0                      # in save-percentage POINTS, home minus away
        home_goals = ta["conceded"]
        away_goals = th["conceded"]
        if home_goals == away_goals:
            continue                                  # a tie cannot happen in this era; bad row
        rows.append({"season": g["season"], "gap": gap, "p_home": m["p_home"],
                     "home_win": 1 if home_goals > away_goals else 0,
                     "home_price": m["home_price"], "away_price": m["away_price"]})
    print(f"testable games (both starters have {MIN_PRIOR_SHOTS}+ prior shots): {len(rows)}")
    if len(rows) < 100:
        print("too few to conclude anything")
        return 0

    # ---- TEST 1: is the market's own error explained by the goalie gap? ----
    xs = [r["gap"] for r in rows]
    ys = [r["home_win"] - r["p_home"] for r in rows]
    mx, my = st.mean(xs), st.mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx else 0.0
    resid = [y - (my + slope * (x - mx)) for x, y in zip(xs, ys)]
    se = (sum(r * r for r in resid) / max(len(rows) - 2, 1) / sxx) ** 0.5 if sxx else 0.0
    print("\n=== TEST 1 — does the goalie gap explain the market's error? ===")
    print(f"  gap: mean {mx:+.3f} pts, sd {st.pstdev(xs):.3f}")
    print(f"  slope {slope:+.5f} win-prob per save% point   SE {se:.5f}   t={slope/se if se else 0:+.2f}")
    print(f"  (a market that fully prices the starter gives a slope of 0)")

    # ---- TEST 2: bet the better goalie at the close ----
    print("\n=== TEST 2 — bet the better goalie, graded at the closing price ===")
    print(f"  {'split':>12} {'n':>5} {'win%':>7} {'break-even':>11} {'edge':>7} {'ROI':>9} {'SE':>7} {'t':>6}")

    def grade(sel):
        n = w = 0
        be, pnl = [], []
        for r in sel:
            if abs(r["gap"]) < args.min_gap:
                continue
            on_home = r["gap"] > 0
            price = r["home_price"] if on_home else r["away_price"]
            won = r["home_win"] == (1 if on_home else 0)
            n += 1
            w += won
            be.append(imp(price))
            pnl.append((price / 100.0 if price > 0 else 100.0 / -price) if won else -1.0)
        if not n:
            return None
        # 🚨 ROI WITHOUT ITS STANDARD ERROR IS NOT A RESULT. A unit bet on a moneyline has a payout
        # SD near 1, so even a few thousand bets leave a standard error around 2 points — which is
        # larger than most "edges" anyone reports. Carry the t so the reader can see that a
        # headline +1% and zero are the same number.
        mean_roi = st.mean(pnl) * 100
        se = (st.pstdev(pnl) / (n ** 0.5)) * 100 if n > 1 else 0.0
        return n, w / n * 100, st.mean(be) * 100, mean_roi, se

    hold = args.holdout
    splits = [("all", rows)]
    seasons = sorted({r["season"] for r in rows})
    for s in seasons:
        splits.append((str(s), [r for r in rows if r["season"] == s]))
    if hold:
        splits.append((f"ex-{hold}", [r for r in rows if str(r["season"]) != hold]))
    for label, sel in splits:
        g = grade(sel)
        if not g:
            continue
        n, win, be, roi, se = g
        t = roi / se if se else 0.0
        print(f"  {label:>12} {n:5} {win:6.1f}% {be:10.1f}% {win-be:+6.1f} {roi:+8.2f}% {se:6.2f} {t:+6.2f}")
    print("\n  'edge' is win% minus the break-even the price itself implies. Positive and stable "
          "across seasons is the only thing that counts; one season is noise.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
