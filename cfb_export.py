"""
cfb_export.py -- freeze the CFB power rating + its honest track record into a typed
data module the web app imports for the /ncaaf Model panel. No fabrication: every
number is computed here from data/cfb.db and written verbatim.

Writes web/app/ncaaf/model-data.ts. Re-run whenever the backfill refreshes.

    python cfb_export.py

Stdlib + numpy; reuses cfb_power / cfb_ats.
"""
import json
import sqlite3
import sys

import cfb_power as cp
import cfb_ats as ca

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


def project_week(db, ratings, hfa, season, week, limit):
    """Line-blind projections for an upcoming week: margin = home - away + HFA (0 at
    neutral sites). No market involved. Returns the `limit` biggest matchups (by the
    two teams' combined rating) so the homepage Card leads with the marquee games."""
    conn = sqlite3.connect(db)
    rows = conn.execute(
        """SELECT away_team, home_team, neutral_site, start_date
             FROM games WHERE season=? AND week=?
               AND home_class='fbs' AND away_class='fbs'""", (season, week)).fetchall()
    conn.close()
    out = []
    for away, home, neu, date in rows:
        rh, ra = ratings.get(home, 0.0), ratings.get(away, 0.0)
        pred = rh - ra + (0.0 if neu else hfa)
        out.append({
            "away": away, "home": home, "neutral": 1 if neu else 0,
            "fav": home if pred >= 0 else away, "margin": round(abs(pred), 1),
            # rank by the WEAKER side's rating so genuinely marquee (two strong teams)
            # games lead, not top-team-vs-cupcake blowouts.
            "date": (date or "")[:10], "_interest": min(rh, ra),
        })
    out.sort(key=lambda g: g["_interest"], reverse=True)
    for g in out:
        del g["_interest"]
    return out[:limit]


CARD_SEASON, CARD_WEEK, CARD_LIMIT = 2026, 1, 16


def main():
    games = cp.load_games(DB, 2020, 2025)
    if not games:
        print("No games -- run cfb_backfill.py first.", file=sys.stderr)
        return 1
    last = max(g["season"] for g in games)

    final, hfa = season_final_ratings(games, last)
    # The Card: line-blind projections for the UPCOMING week. Start from the regressed
    # end-of-`last` carryover, then fold in any games already played this season, so a
    # scheduled refresh stays correct as the season runs. Week auto-advances.
    prior_next = {t: DECAY * r for t, r in final.items()}
    completed = load_completed(DB, CARD_SEASON)
    cur_ratings = cp.fit_ratings(completed, LAM, CAP, prior_next)[0] if completed else prior_next
    card_week = detect_upcoming_week(DB, CARD_SEASON, CARD_WEEK)
    card_games = project_week(DB, cur_ratings, hfa, CARD_SEASON, card_week, CARD_LIMIT)
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
        "card": {"season": CARD_SEASON, "week": card_week, "games": card_games},
    }
    body = ("// AUTO-GENERATED by cfb_export.py -- do not edit by hand.\n"
            "// Real, out-of-sample numbers from the CFB power rating over data/cfb.db.\n"
            "export type NcaafTeam = { rank: number; team: string; conf: string; rating: number };\n"
            "export type NcaafConf = { conf: string; avgRating: number; teams: number };\n"
            "export type NcaafKeyNum = { margin: number; pct: number; nfl: number };\n"
            "export type NcaafCardGame = { away: string; home: string; neutral: number;"
            " fav: string; margin: number; date: string };\n"
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
    if card_games:
        g0 = card_games[0]
        print(f"  card: {CARD_SEASON} wk{card_week}, {len(card_games)} games; "
              f"top: {g0['fav']} by {g0['margin']} ({g0['away']} @ {g0['home']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
