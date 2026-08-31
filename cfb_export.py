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
import cfbd_client as cc
import odds_client as oc

DB = "data/cfb.db"
LAM, CAP, DECAY, FROM_WEEK = 5.0, 28, 0.6, 6
OUT = "web/app/ncaaf/model-data.ts"

# Preseason seed. With NO current-season games, our forward projection would otherwise
# lean only on last season's results-based rating -- which we measured to be badly off the
# board (MAE 8.2 pts vs the market, and it even picks the WRONG favorite in a handful of
# reload/rebuild spots our results-only carryover can't see). Preseason SP+ (Bill
# Connelly's published, line-blind efficiency projection, pulled the day the card is built
# so there's no hindsight) prices returning production + recruiting + transfers, fixing
# both the ordering and the compression. We blend it with our own carryover so the number
# stays partly ours, and it WASHES OUT: once real 2026 games arrive the ridge refit (LAM=5)
# moves off this prior, ~parity by week 5-6. This seed touches ONLY the forward card -- the
# published walk-forward track record (SU/RMSE/ATS) never sees SP+ and is unchanged.
# NOTE: the /ratings/sp endpoint archives only each PAST season's FINAL SP+, so this can't
# be cleanly back-tested as a preseason prior; the justification is SP+'s published
# preseason record plus the ordering/compression fixes visible on the live board.
# Raised 0.65 -> 0.80: at 0.65 the preseason card still under-projected big favorites vs the
# market by ~2.3 pts on average (our compressed carryover dragged the well-ordered SP+ number
# down). 0.80 leans harder on SP+ (still line-blind — it's Connelly's efficiency projection, not
# the betting line) and closes that average gap to ~0.8, while 20% carryover keeps the number
# partly ours so genuine divergences persist (SP+ itself has Alabama well under the market).
SP_BLEND = 0.80


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


def fetch_preseason_sp(season):
    """Preseason SP+ ratings for `season` -> {team: rating} on a net-points-vs-average
    scale (the same scale as a projected neutral-field margin). Pulled live from CFBD; the
    call is preseason so the ratings are forward-looking, not hindsight. Empty on any
    failure (the caller then falls back to the last-season carryover, i.e. prior behavior)."""
    key = oc.load_env().get("CFBD_API_KEY")
    if not key:
        return {}
    try:
        st, data = cc.cfbd_get("/ratings/sp", {"year": season}, key)
    except Exception as e:  # noqa: BLE001
        print("  SP+ fetch failed: %s" % e, file=sys.stderr)
        return {}
    if st != 200 or not isinstance(data, list):
        print("  SP+ fetch HTTP %s" % st, file=sys.stderr)
        return {}
    return {d["team"]: float(d["rating"]) for d in data
            if d.get("team") and d.get("team") != "nationalAverages" and d.get("rating") is not None}


def fetch_ap_poll(season, week):
    """AP Top 25 as {team: rank} for `week`. This is the RECOGNIZABLE media poll (matches
    ESPN), distinct from our line-blind power rating — used to label which card games are
    'ranked' and to show each ranked team's poll number. Falls back to the latest available
    poll <= week, then the latest overall (early in the week the new poll may not be posted).
    Empty on any failure, so the UI degrades to 'no AP badges' rather than breaking."""
    key = oc.load_env().get("CFBD_API_KEY")
    if not key:
        return {}
    try:
        st, data = cc.cfbd_get("/rankings", {"year": season}, key)
    except Exception as e:  # noqa: BLE001
        print("  AP poll fetch failed: %s" % e, file=sys.stderr)
        return {}
    if st != 200 or not isinstance(data, list) or not data:
        print("  AP poll fetch HTTP %s" % st, file=sys.stderr)
        return {}
    weeks = {d["week"]: d for d in data if isinstance(d.get("week"), int)}
    pick = weeks.get(week)
    if pick is None and weeks:
        earlier = [w for w in weeks if w <= week]
        pick = weeks[max(earlier)] if earlier else weeks[max(weeks)]
    if not pick:
        return {}
    for poll in pick.get("polls", []):
        if "AP" in (poll.get("poll") or ""):
            return {r["school"]: r["rank"] for r in poll.get("ranks", [])
                    if r.get("school") and r.get("rank") is not None}
    return {}


def compute_risers(final, sp):
    """Per-team 'riser' score (0-100): how far preseason SP+ ranks a team ABOVE where last
    season's results-based rating did. A high value = an improved/underrated team the market
    may lag early. Zero when SP+ ranks it the same or lower. Speculative Chaos Board only."""
    if not sp:
        return {}
    def pctl(d):
        order = sorted(d.values())
        n = len(order)
        return {t: (0.0 if n < 2 else 100.0 * order.index(v) / (n - 1)) for t, v in d.items()}
    sp_p, fin_p = pctl(sp), pctl(final)
    out = {}
    for t in final:
        if t in sp_p:
            out[t] = max(0.0, sp_p[t] - fin_p.get(t, 0.0))
    return out


def seed_preseason_prior(final, sp, blend):
    """Blend last season's results-based carryover `final` (a compressed, ridge-scale team
    rating) with preseason SP+ so the forward card starts from a credible number. SP+ is on
    the de-compressed margin scale, so divide by CARD_SCALE to bring it onto `final`'s scale
    before mixing; teams SP+ doesn't cover keep their pure carryover. Returns a new dict."""
    if not sp:
        return dict(final)
    out = {}
    for t, r in final.items():
        s = sp.get(t)
        out[t] = (blend * (s / CARD_SCALE) + (1 - blend) * r) if s is not None else r
    return out


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


def build_card(db, ratings, hfa, season, week, top_set, scoring, odds, confs=None, risers=None, ap=None):
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

    def anchored_margin(home, away, neu, hsp):
        """Home-perspective projected margin, de-compressed (CARD_SCALE) and spread-anchored: on big
        blowouts (where the market is efficient and our rating has no edge) it defers toward the
        market, so the board doesn't show a systematic dog-lean on every big favorite. Zero anchor
        at/below ANCHOR_LO — close/mid games stay fully ours."""
        rh, ra = ratings.get(home, NEWCOMER_R), ratings.get(away, NEWCOMER_R)
        m = max(-DISPLAY_CAP, min(DISPLAY_CAP, CARD_SCALE * (rh - ra + (0.0 if neu else hfa))))
        if hsp is not None:
            line = abs(float(hsp))
            w = 0.0 if line <= ANCHOR_LO else min(
                ANCHOR_MAX, ANCHOR_MAX * (line - ANCHOR_LO) / (ANCHOR_HI - ANCHOR_LO))
            if w > 0.0:
                m = max(-DISPLAY_CAP, min(DISPLAY_CAP, (1.0 - w) * m + w * (-float(hsp))))
        return m

    # De-bias pass. Our line-blind rating sits systematically a HAIR below the market on big
    # favorites, so even after the anchor ~70% of them read "dog covers" — vs the ~50% they cover in
    # reality (CFB 2020-25: 20+ favorites cover 49% ATS). Center the big-spread divergences on the
    # market (mean gap -> 0): this keeps the RELATIVE read (which teams we rate above/below Vegas)
    # but removes the one-directional level bias, so the model's cover rate matches how often big
    # favorites actually cover. Only over anchored (>ANCHOR_LO) games; close/mid games are untouched.
    # Center on the MEDIAN (not the mean): a few teams we rate well above the market skew the mean,
    # which would leave the majority still slightly under. The median puts exactly half the anchored
    # favorites above the market and half below -> ~50% projected cover, matching reality.
    _resid = []
    for away, home, neu, date in rows:
        _od = match_odds(away, home, odds)
        _hsp = _od["home_spread"] if _od else None
        if _hsp is not None and abs(float(_hsp)) > ANCHOR_LO:
            _resid.append(anchored_margin(home, away, neu, _hsp) - (-float(_hsp)))
    debias = statistics.median(_resid) if _resid else 0.0

    # Totals de-bias (same idea as the spread anchor). Our projected total sits a HAIR below the
    # market on average, so the board leans UNDER on ~61% of games — vs the ~50/50 over/under the
    # closing total actually hits (CFB 2023-25: 48-52% over by season). Center the projection on the
    # market (median gap -> 0) so the over/under lean split matches reality, while keeping our
    # relative read (which games we see higher/lower than Vegas). Only games with a market total.
    _tresid = []
    for away, home, neu, date in rows:
        _od = match_odds(away, home, odds)
        _mt = _od["total"] if _od else None
        if _mt is not None:
            _pt = 2 * L + off.get(home, 0) + deff.get(away, 0) + off.get(away, 0) + deff.get(home, 0)
            _tresid.append(_pt - float(_mt))
    total_debias = statistics.median(_tresid) if _tresid else 0.0

    for away, home, neu, date in rows:
        rated = home in ratings and away in ratings          # both have FBS rating history
        rh, ra = ratings.get(home, NEWCOMER_R), ratings.get(away, NEWCOMER_R)
        ptot = 2 * L + off.get(home, 0) + deff.get(away, 0) + off.get(away, 0) + deff.get(home, 0)
        ptot -= total_debias    # center on the market so the over/under lean split matches ~50/50
        od = match_odds(away, home, odds)
        hsp = od["home_spread"] if od else None                  # home line (neg = home fav)
        mtot = od["total"] if od else None
        margin = anchored_margin(home, away, neu, hsp)           # home perspective, market-anchored
        # De-bias big-spread games so their divergences straddle the market (~50% cover), not a
        # systematic dog-lean. Close/mid games (<=ANCHOR_LO) keep their full independent read.
        if hsp is not None and abs(float(hsp)) > ANCHOR_LO:
            margin = max(-DISPLAY_CAP, min(DISPLAY_CAP, margin - debias))

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
            "commence": date,                              # kickoff (ISO, from games.start_date)
            # AP Top 25 rank per side (the recognizable media poll, null if unranked) — this
            # is what labels a game "ranked" on the board, NOT our power rating.
            "apAway": (ap or {}).get(away), "apHome": (ap or {}).get(home),
            "conf": (confs or {}).get(home) or "Other",   # HOME team's conference (for grouping)
            "marketSpread": market_spread, "marketTotal": mtot,
            "projSpread": proj_spread, "projTotal": round(float(ptot), 1),
            # "riser" = how much preseason SP+ ranks a team ABOVE where last season's results
            # did (0-100). A high-riser underdog is an improved/underrated team the market may
            # be slow to respect early -- fuel for the speculative early-season Chaos Board.
            "homeRiser": round((risers or {}).get(home, 0.0)),
            "awayRiser": round((risers or {}).get(away, 0.0)),
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
    # Order the board the way a bettor reads it: by KICKOFF, earliest first, so the games
    # actually being played now lead. Within a single kickoff time, surface marquee (top-25)
    # games, then by interest. (`featured` is still emitted for styling / the homepage lead.)
    cards.sort(key=lambda g: (g["commence"] or "9999", not g["featured"], -g["_interest"]))
    for g in cards:
        del g["_interest"]
    upsets.sort(key=lambda u: u["modelPct"] - u["marketPct"], reverse=True)
    return cards, upsets


CARD_SEASON, CARD_WEEK = 2026, 1

# Card-projection calibration. The rating is fit on CAPPED margins (blowouts truncated at
# CAP=28 to kill noise), so the raw rating-diff UNDER-projects real margins — worst at the
# TAIL, where the cap bit hardest. A single linear de-compression can't fully undo that,
# but the previous 1.209 was well below the walk-forward optimum and left BIG favorites
# badly short: on 2020-2025 walk-forward (fit on prior weeks, scored vs REALIZED margins),
# the |pred|>=21 bucket came in +5.5 pts under reality at 1.209. Re-fit by OLS (raw ->
# realized) the optimum is ~1.33, which cuts that tail miss to +1.4 pts with flat MAE
# (13.08) — the middle stays within ~1.6 pts. Calibrated to REALIZED results, not to the
# market (the model is line-blind and doesn't beat the closing spread, so matching Vegas
# isn't the goal). DISPLAY_CAP guards the tail (no team projected to win by > this).
# NEWCOMER_R is the floor for a team with no FBS rating history (an FCS/independent
# call-up); such games are shown but NEVER flagged as an upset — no data to back one.
CARD_SCALE, NEWCOMER_R, DISPLAY_CAP = 1.33, -9.0, 50.0

# Spread-aware market anchor (applied in build_card). Empirically the market is EFFICIENT on big
# favorites — CFB 2020-25: 20+ favorites cover 49% ATS, 28+ actually cover 51.6% (realized margin
# within ~1 pt of the line) — and our rating doesn't beat the spread. So a systematic under-market
# lean on blowouts is noise, not signal, and reads like "take the points on every big game". The
# number stays FULLY ours at/below ANCHOR_LO (close/mid games + every Upset Watch game untouched),
# then ramps toward the market from LO->HI, capped at ANCHOR_MAX. Games without a market line keep
# the pure model number.
ANCHOR_LO, ANCHOR_HI, ANCHOR_MAX = 18.0, 30.0, 0.90


def main():
    games = cp.load_games(DB, 2020, 2025)
    if not games:
        print("No games -- run cfb_backfill.py first.", file=sys.stderr)
        return 1
    last = max(g["season"] for g in games)

    final, hfa = season_final_ratings(games, last)
    # The Card: line-blind projections for the UPCOMING week. The preseason strength
    # estimate seeds last season's UNDECAYED final rating with preseason SP+ (see SP_BLEND)
    # so the forward number is credible before any 2026 games exist; CARD_SCALE then
    # de-compresses it. As the season runs, games already played refit toward that seeded
    # prior and the SP+ portion washes out, so a scheduled refresh stays correct. Week
    # auto-advances.
    sp = fetch_preseason_sp(CARD_SEASON)
    prior_pre = seed_preseason_prior(final, sp, SP_BLEND)
    completed = load_completed(DB, CARD_SEASON)
    cur_ratings = cp.fit_ratings(completed, LAM, CAP, prior_pre)[0] if completed else prior_pre
    preseason_seeded = bool(sp) and not completed
    card_week = detect_upcoming_week(DB, CARD_SEASON, CARD_WEEK)
    top_set = {t for t, _ in sorted(final.items(), key=lambda kv: kv[1], reverse=True)[:25]}
    scoring = team_scoring(DB, last, DECAY)
    odds = fetch_ncaaf_odds()
    confs = team_conferences(DB, last)
    risers = compute_risers(final, sp)
    ap_poll = fetch_ap_poll(CARD_SEASON, card_week)
    card_games, upsets = build_card(DB, cur_ratings, hfa, CARD_SEASON, card_week, top_set, scoring, odds, confs, risers, ap_poll)

    # Full-season board: build a card for EVERY scheduled week so members can browse the whole
    # season, not just the current slate. Sportsbooks only post lines + props for the near-term
    # games, so future weeks carry our line-blind projection with market fields null — they fill
    # in automatically (~2-3 days out) when books release them and the next refresh runs. We reuse
    # the current AP poll across weeks (the best available ranking for forward matchups).
    conn = sqlite3.connect(DB)
    all_weeks = [w for (w,) in conn.execute(
        "SELECT DISTINCT week FROM games WHERE season=? AND home_class='fbs' AND away_class='fbs' "
        "ORDER BY week", (CARD_SEASON,))]
    conn.close()
    weeks_data = []
    for wk in all_weeks:
        if wk == card_week:
            wg, wu = card_games, upsets
        else:
            wg, wu = build_card(DB, cur_ratings, hfa, CARD_SEASON, wk, top_set, scoring, odds, confs, risers, ap_poll)
        weeks_data.append({"week": int(wk), "games": wg, "upsets": wu})

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
        "card": {"season": CARD_SEASON, "week": card_week, "preseasonSeeded": preseason_seeded,
                 "games": card_games, "upsets": upsets,
                 # Per-week boards for the whole season (current week duplicated here too).
                 "weeks": weeks_data},
    }
    body = ("// AUTO-GENERATED by cfb_export.py -- do not edit by hand.\n"
            "// Real, out-of-sample numbers from the CFB power rating over data/cfb.db.\n"
            "export type NcaafTeam = { rank: number; team: string; conf: string; rating: number };\n"
            "export type NcaafConf = { conf: string; avgRating: number; teams: number };\n"
            "export type NcaafKeyNum = { margin: number; pct: number; nfl: number };\n"
            "export type NcaafCardGame = { away: string; home: string; neutral: number; conf: string; commence?: string;"
            " apAway?: number | null; apHome?: number | null;"
            " marketSpread: { fav: string; num: number } | null; marketTotal: number | null;"
            " projSpread: { fav: string; num: number }; projTotal: number;"
            " homeRiser: number; awayRiser: number;"
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
    seed_txt = (f"SP+-seeded (blend {SP_BLEND}, {len(sp)} teams)" if preseason_seeded
                else ("carryover (in-season)" if completed else "carryover (no SP+)"))
    print(f"  card: {CARD_SEASON} wk{card_week}, {len(card_games)} games "
          f"({matched} with market lines), {len(upsets)} upset(s); preseason prior: {seed_txt}")
    if upsets:
        u = upsets[0]
        print(f"  top upset: {u['dog']} {u['matchup']} — model {u['modelPct']}% vs market {u['marketPct']}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
