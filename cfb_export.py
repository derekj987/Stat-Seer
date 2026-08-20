"""
cfb_export.py -- freeze the CFB power rating + its honest track record into a typed
data module the web app imports for the /ncaaf Model panel. No fabrication: every
number is computed here from data/cfb.db and written verbatim.

Writes web/app/ncaaf/model-data.ts. Re-run whenever the backfill refreshes.

    python cfb_export.py

Stdlib + numpy; reuses cfb_power / cfb_ats.
"""
import json
import math
import sqlite3
import statistics
import sys
import urllib.request

import cfb_power as cp
import cfb_ats as ca
import odds_client as oc

DB = "data/cfb.db"
LAM, CAP, DECAY, FROM_WEEK = 5.0, 28, 0.6, 6
OUT = "web/app/ncaaf/model-data.ts"


def team_conferences(db, season):
    conn = sqlite3.connect(db)
    rows = conn.execute(
        """SELECT home_team AS t, home_conf AS c FROM games
             WHERE season=? AND home_class='fbs' AND home_conf IS NOT NULL
           UNION
           SELECT away_team AS t, away_conf AS c FROM games
             WHERE season=? AND away_class='fbs' AND away_conf IS NOT NULL""",
        (season, season)).fetchall()
    conn.close()
    return {t: c for t, c in rows}


def season_final_ratings(games, upto):
    """Chain the carryover through seasons and return `upto` season's final rating+hfa."""
    seasons = sorted({g["season"] for g in games})
    prior, final, hfa = {}, {}, 0.0
    for s in seasons:
        sg = [g for g in games if g["season"] == s]
        final, hfa = cp.fit_ratings(sg, LAM, CAP, prior)
        prior = {t: DECAY * r for t, r in final.items()}
        if s == upto:
            break
    return final, hfa


def load_completed(db, season):
    """Completed FBS-vs-FBS games of `season` (scores only, no Elo needed) for the
    in-season rating fit."""
    conn = sqlite3.connect(db)
    rows = conn.execute(
        """SELECT week, home_team, away_team, home_points, away_points, neutral_site
             FROM games WHERE season=? AND home_class='fbs' AND away_class='fbs'
               AND home_points IS NOT NULL AND away_points IS NOT NULL""", (season,)).fetchall()
    conn.close()
    return [{"season": season, "week": w or 0, "home": h, "away": a,
             "margin": hp - ap, "neutral": 1 if neu else 0} for w, h, a, hp, ap, neu in rows]


def detect_upcoming_week(db, season, fallback):
    """Earliest week of `season` that still has an unplayed FBS-vs-FBS game."""
    conn = sqlite3.connect(db)
    r = conn.execute(
        """SELECT MIN(week) FROM games WHERE season=? AND home_class='fbs'
             AND away_class='fbs' AND home_points IS NULL""", (season,)).fetchone()
    conn.close()
    return r[0] or fallback


def _norm(s):
    """Normalize a team name for cross-source matching (Odds API full names vs CFBD)."""
    return " ".join("".join(c if c.isalnum() else " " for c in (s or "").lower()).split())


def fetch_ncaaf_odds():
    """Current NCAAF consensus spreads + totals from The Odds API. Returns a list of
    {away_n, home_n, home_spread, total}; home_spread is the HOME line (neg = home fav).
    Empty on any failure (the Card then shows model-only, like the NFL board pre-lock)."""
    key = oc.load_env().get("ODDS_API_KEY")
    if not key:
        return []
    oc.ensure_ssl_certs()
    url = ("https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds"
           "?apiKey=%s&regions=us&markets=spreads,totals&oddsFormat=american" % key)
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = json.loads(r.read())
    except Exception as e:  # noqa: BLE001
        print("  odds fetch failed: %s" % e, file=sys.stderr)
        return []
    out = []
    for e in data:
        hf, af = e.get("home_team"), e.get("away_team")
        hsp, tot = [], []
        for b in e.get("bookmakers", []):
            for m in b.get("markets", []):
                if m["key"] == "spreads":
                    for o in m.get("outcomes", []):
                        if o.get("name") == hf and o.get("point") is not None:
                            hsp.append(o["point"])
                elif m["key"] == "totals":
                    pts = [o["point"] for o in m.get("outcomes", []) if o.get("point") is not None]
                    if pts:
                        tot.append(pts[0])
        out.append({"away_n": _norm(af), "home_n": _norm(hf),
                    "home_spread": round(statistics.median(hsp), 1) if hsp else None,
                    "total": round(statistics.median(tot), 1) if tot else None})
    return out


def match_odds(away, home, odds):
    a, h = _norm(away), _norm(home)
    def m(x, y):
        return y == x or y.startswith(x + " ") or x.startswith(y + " ")
    cands = [o for o in odds if m(a, o["away_n"]) and m(h, o["home_n"])]
    return min(cands, key=lambda o: len(o["away_n"]) + len(o["home_n"])) if cands else None


def team_scoring(db, season, decay):
    """A light totals model: each team's regressed offensive/defensive point deviation
    from the league average, carried toward next season by `decay`. Projected total =
    2*L + off[home] + def[away] + off[away] + def[home]."""
    conn = sqlite3.connect(db)
    rows = conn.execute(
        """SELECT home_team, away_team, home_points, away_points FROM games
             WHERE season=? AND home_class='fbs' AND away_class='fbs'
               AND home_points IS NOT NULL""", (season,)).fetchall()
    conn.close()
    scored, allowed = {}, {}
    for h, a, hp, ap in rows:
        scored.setdefault(h, []).append(hp); allowed.setdefault(h, []).append(ap)
        scored.setdefault(a, []).append(ap); allowed.setdefault(a, []).append(hp)
    allpts = [p for v in scored.values() for p in v]
    L = sum(allpts) / len(allpts) if allpts else 27.0
    off, deff = {}, {}
    for t in scored:
        n = len(scored[t]); shrink = n / (n + 4)
        off[t] = decay * (sum(scored[t]) / n - L) * shrink
        deff[t] = decay * (sum(allowed[t]) / n - L) * shrink
    return L, off, deff


WINK = 11.0  # margin -> win-prob logistic scale (a 7-pt edge ~ 65%)


def build_card(db, ratings, hfa, season, week, top_set, scoring, odds):
    """Model-vs-Market card + upsets for `week`, mirroring the NFL board. Each game gets
    the market spread + total and our model's projection; `featured` flags games with a
    top-25 team (the homepage leads with those, the rest go behind a 'see all' dropdown).
    Upsets are off-consensus competitive games where the model backs the market dog."""
    L, off, deff = scoring
    conn = sqlite3.connect(db)
    rows = conn.execute(
        """SELECT away_team, home_team, neutral_site, start_date FROM games
             WHERE season=? AND week=? AND home_class='fbs' AND away_class='fbs'""",
        (season, week)).fetchall()
    conn.close()
    cards, upsets = [], []
    for away, home, neu, date in rows:
        rated = home in ratings and away in ratings          # both have FBS rating history
        rh, ra = ratings.get(home, NEWCOMER_R), ratings.get(away, NEWCOMER_R)
        raw = rh - ra + (0.0 if neu else hfa)
        # de-compress onto a realistic margin scale (see CARD_SCALE), guard the tail
        margin = max(-DISPLAY_CAP, min(DISPLAY_CAP, CARD_SCALE * raw))   # home perspective
        ptot = 2 * L + off.get(home, 0) + deff.get(away, 0) + off.get(away, 0) + deff.get(home, 0)
        od = match_odds(away, home, odds)
        hsp = od["home_spread"] if od else None                  # home line (neg = home fav)
        mtot = od["total"] if od else None

        # Our read beside the market: our projected favorite + margin, an ATS pick (which
        # side of the MARKET spread our projection covers), and an over/under lean.
        our_fav = home if margin >= 0 else away
        proj_spread = {"fav": our_fav, "num": round(-abs(float(margin)), 1)}
        market_spread = total_lean = pick = None
        off_flag = False
        if hsp is not None:
            mfav = home if hsp <= 0 else away
            market_spread = {"fav": mfav, "num": -abs(hsp)}      # the favorite's line
            off_flag = bool(mfav != our_fav)                     # off-consensus side
            # ATS lean: does our projected margin cover the market number? If our margin
            # for the favorite falls short of the line, our read is the dog +points.
            line = abs(float(hsp))
            fav_is_home = hsp <= 0
            fav_team = home if fav_is_home else away
            dog_team = away if fav_is_home else home
            fav_margin = float(margin) if fav_is_home else -float(margin)
            if fav_margin >= line:
                pick = {"side": fav_team, "num": round(-line, 1)}     # take the favorite -line
            else:
                pick = {"side": dog_team, "num": round(line, 1)}      # take the dog +line
        if mtot is not None and abs(ptot - mtot) >= 2.0:
            total_lean = {"dir": "OVER" if ptot > mtot else "UNDER", "num": mtot}

        cards.append({
            "away": away, "home": home, "neutral": 1 if neu else 0,
            "marketSpread": market_spread, "marketTotal": mtot,
            "projSpread": proj_spread, "projTotal": round(float(ptot), 1),
            "pick": pick, "totalLean": total_lean, "off": off_flag,
            "featured": bool(home in top_set or away in top_set),
            "_interest": min(rh, ra),
        })

        # Potential upset — only on competitive lines (a single-digit dog our model
        # flips to win outright), never a naive blowout-dog flip, and never on a
        # newcomer we couldn't rate.
        if hsp is not None and off_flag and abs(hsp) <= 9.5 and rated:
            dog = away if hsp <= 0 else home
            dog_margin = float(margin if dog == home else -margin)
            if dog_margin > 0:
                p_dog = 1 / (1 + math.exp(-dog_margin / WINK))
                p_dog_mkt = 1 - 1 / (1 + math.exp(-abs(hsp) / WINK))
                upsets.append({
                    "dog": dog, "matchup": ("vs " + away) if dog == home else ("at " + home),
                    "spread": "+" + str(abs(hsp)),
                    "modelPct": round(100 * p_dog), "marketPct": round(100 * p_dog_mkt),
                    "byPoints": round(dog_margin, 1),
                })
    # featured (top-25 team) games first, then the rest — each block by interest.
    cards.sort(key=lambda g: (g["featured"], g["_interest"]), reverse=True)
    for g in cards:
        del g["_interest"]
    upsets.sort(key=lambda u: u["modelPct"] - u["marketPct"], reverse=True)
    return cards, upsets


CARD_SEASON, CARD_WEEK = 2026, 1

# Card-projection calibration. The rating is fit on CAPPED margins and (for a preseason
# card) carried from last season, so the raw rating-diff badly UNDER-projects real
# margins. Calibrated on history — realized early-season margin ~= CARD_SCALE * prior
# final rating-diff — this de-compresses the projection onto a realistic scale and, as a
# bonus, lowers preseason error (RMSE 18.1 vs 19.1 for the old 0.6x shrink). DISPLAY_CAP
# guards the tail (no team is projected to win by > this). NEWCOMER_R is the floor for a
# team with no FBS rating history (an FCS/independent call-up); such games are shown but
# NEVER flagged as an upset — we have no data to back one.
CARD_SCALE, NEWCOMER_R, DISPLAY_CAP = 1.209, -9.0, 50.0


def main():
    games = cp.load_games(DB, 2020, 2025)
    if not games:
        print("No games -- run cfb_backfill.py first.", file=sys.stderr)
        return 1
    last = max(g["season"] for g in games)

    final, hfa = season_final_ratings(games, last)
    # The Card: line-blind projections for the UPCOMING week. The preseason strength
    # estimate is last season's UNDECAYED final rating (validated: lower early-season
    # error than the old 0.6x shrink); CARD_SCALE then de-compresses it. As the season
    # runs, games already played refit toward that full prior, so a scheduled refresh
    # stays correct. Week auto-advances.
    completed = load_completed(DB, CARD_SEASON)
    cur_ratings = cp.fit_ratings(completed, LAM, CAP, final)[0] if completed else final
    card_week = detect_upcoming_week(DB, CARD_SEASON, CARD_WEEK)
    top_set = {t for t, _ in sorted(final.items(), key=lambda kv: kv[1], reverse=True)[:25]}
    scoring = team_scoring(DB, last, DECAY)
    odds = fetch_ncaaf_odds()
    card_games, upsets = build_card(DB, cur_ratings, hfa, CARD_SEASON, card_week, top_set, scoring, odds)
    confs = team_conferences(DB, last)
    ranked = sorted(final.items(), key=lambda kv: kv[1], reverse=True)
    top = [{"rank": i + 1, "team": t, "conf": confs.get(t, ""), "rating": round(r, 1)}
           for i, (t, r) in enumerate(ranked[:25])]

    res, se, ae = cp.walk_forward(games, LAM, CAP, FROM_WEEK, DECAY)
    n = res["n"]
    valid = {
        "games": n,
        "ourSU": round(100.0 * res["ours_su"] / n, 1),
        "eloSU": round(100.0 * res["elo_su"] / n, 1),
        "homeSU": round(100.0 * res["home_su"] / n, 1),
        "ourRMSE": round((se["ours"] / n) ** 0.5, 2),
        "eloRMSE": round((se["elo"] / n) ** 0.5, 2),
    }

    lined = ca.load(DB, 2020, 2024)
    tally = ca.backtest(lined, LAM, CAP, FROM_WEEK, DECAY)
    w, l, p = tally[0.0]
    ats = {"bets": w + l + p, "wins": w, "losses": l,
           "atsPct": round(100.0 * w / (w + l), 1), "breakeven": ca.BREAKEVEN}

    # --- Context: conference strength (avg rating of members) --------------------
    by_conf = {}
    for t, r in final.items():
        c = confs.get(t)
        if c:
            by_conf.setdefault(c, []).append(r)
    conferences = sorted(
        ({"conf": c, "avgRating": round(sum(rs) / len(rs), 1), "teams": len(rs)}
         for c, rs in by_conf.items() if len(rs) >= 3),
        key=lambda d: d["avgRating"], reverse=True)

    # --- Value: CFB key numbers (margin distribution) + line-shopping spread ------
    conn = sqlite3.connect(DB)
    margins = [m for (m,) in conn.execute(
        "SELECT ABS(home_points-away_points) FROM games "
        "WHERE home_class='fbs' AND away_class='fbs' AND home_points IS NOT NULL")]
    ng = len(margins)
    from collections import Counter
    mc = Counter(margins)
    NFL_KEY = {3: 15.0, 7: 9.1, 10: 5.8, 14: 4.9}  # published NFL baseline for contrast
    key_numbers = [{"margin": m, "pct": round(100.0 * mc[m] / ng, 1),
                    "nfl": NFL_KEY.get(m)} for m in (3, 7, 10, 14)]
    ranges = [rng for (rng,) in conn.execute(
        "SELECT MAX(spread)-MIN(spread) FROM lines WHERE spread IS NOT NULL "
        "AND provider!='consensus' GROUP BY game_id HAVING COUNT(*)>=2") if rng is not None]
    conn.close()
    book_shop = {"games": len(ranges),
                 "avgRange": round(sum(ranges) / len(ranges), 2),
                 "pctGap1": round(100.0 * sum(1 for r in ranges if r >= 1) / len(ranges))}

    data = {
        "season": last, "seasons": "2020-2025", "hfa": round(hfa, 1),
        "teamsRated": len(final), "top": top, "validation": valid, "ats": ats,
        "context": {"hfa": round(hfa, 1), "conferences": conferences},
        "value": {"games": ng, "keyNumbers": key_numbers, "bookShop": book_shop},
        "card": {"season": CARD_SEASON, "week": card_week,
                 "games": card_games, "upsets": upsets},
    }
    body = ("// AUTO-GENERATED by cfb_export.py -- do not edit by hand.\n"
            "// Real, out-of-sample numbers from the CFB power rating over data/cfb.db.\n"
            "export type NcaafTeam = { rank: number; team: string; conf: string; rating: number };\n"
            "export type NcaafConf = { conf: string; avgRating: number; teams: number };\n"
            "export type NcaafKeyNum = { margin: number; pct: number; nfl: number };\n"
            "export type NcaafCardGame = { away: string; home: string; neutral: number;"
            " marketSpread: { fav: string; num: number } | null; marketTotal: number | null;"
            " projSpread: { fav: string; num: number }; projTotal: number;"
            " pick: { side: string; num: number } | null;"
            " totalLean: { dir: string; num: number } | null; off: boolean; featured: boolean };\n"
            "export type NcaafUpset = { dog: string; matchup: string; spread: string;"
            " modelPct: number; marketPct: number; byPoints: number };\n"
            "export const NCAAF_MODEL = " + json.dumps(data, indent=2) + " as const;\n")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body)
    print(f"Wrote {OUT}")
    print(f"  {last} season: {len(final)} teams rated, HFA {hfa:.1f} pts")
    print(f"  #1 {top[0]['team']} ({top[0]['rating']}), #2 {top[1]['team']} ({top[1]['rating']})")
    print(f"  validation: our SU {valid['ourSU']}% vs Elo {valid['eloSU']}%; "
          f"ATS {ats['atsPct']}% (breakeven {ca.BREAKEVEN})")
    print(f"  context: {len(conferences)} conferences ranked; top {conferences[0]['conf']} "
          f"({conferences[0]['avgRating']})")
    print(f"  value: key# 3={key_numbers[0]['pct']}% 7={key_numbers[1]['pct']}%; "
          f"book spread avg {book_shop['avgRange']} pts, {book_shop['pctGap1']}% gap>=1")
    matched = sum(1 for g in card_games if g["marketSpread"])
    print(f"  card: {CARD_SEASON} wk{card_week}, {len(card_games)} games "
          f"({matched} with market lines), {len(upsets)} upset(s)")
    if upsets:
        u = upsets[0]
        print(f"  top upset: {u['dog']} {u['matchup']} — model {u['modelPct']}% vs market {u['marketPct']}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
