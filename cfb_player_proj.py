"""
cfb_player_proj.py -- first-pass NCAAF player-prop projections for the games that already
have book props, mirroring the NFL player model (analysis/player_proj_export.py).

For every player with a posted prop, we build their game log from CFBD (/games/players,
per team per season), then report:
  - book         the current consensus line (from cfb_prop_snapshots)
  - proj         an honest PRIOR-SEASON baseline = the player's per-game average of that stat
                 last season (for anytime TD, their per-game TD rate). Line-blind: never uses
                 the book number.
  - career / prior / home / road hit-rates: how often they went OVER that line, historically.

Writes web/lib/ncaafPlayerProjections.ts (same shape as the NFL PlayerProj). Preseason /
first-pass -- not graded against closing lines yet, exactly like the NFL Week-1 estimate.

    python cfb_player_proj.py --probe   # list the posted players + match status
    python cfb_player_proj.py           # build + write the TS

Auth: CFBD_API_KEY + SUPABASE_URL/SUPABASE_SERVICE_KEY in .env. Stdlib + cfbd_client.
"""
import argparse
import concurrent.futures as cf
import json
import os
import re
import sqlite3
import sys
import unicodedata
import urllib.parse
import urllib.request

import cfbd_client as cc
import odds_client as oc

CUR_SEASON = 2026
PRIOR_SEASON = 2025
HIST_SEASONS = [2024, 2025]        # career = these; prior = PRIOR_SEASON only
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "cfb.db")

# Which markets to project for each depth-chart position, and how deep down the chart to go.
# Kept to the realistic starters/rotation so the board isn't padded with third-stringers.
POS_MARKETS = {
    "QB": ["pass_yds", "pass_tds", "anytime_td"],
    "RB": ["rush_yds", "receptions", "anytime_td"],
    "WR": ["rec_yds", "receptions", "anytime_td"],
    "TE": ["rec_yds", "receptions", "anytime_td"],
    "FB": ["rush_yds", "anytime_td"],
}
DEPTH_LIMIT = {"QB": 1, "RB": 2, "WR": 3, "TE": 1, "FB": 1}
# our market -> (page category, unit label)
MARKET_CAT = {
    "pass_yds": ("passing", "yds"), "pass_tds": ("passing", "TD"),
    "rush_yds": ("rushing", "yds"), "rec_yds": ("receiving", "yds"),
    "receptions": ("receptions", ""), "anytime_td": ("td", ""),
}

# CFB prop market -> (our market key, category, projection unit label, position)
MARKETS = {
    "player_pass_yds":       ("pass_yds", "passing", "yds", "QB"),
    "player_pass_tds":       ("pass_tds", "passing", "TD", "QB"),
    "player_rush_yds":       ("rush_yds", "rushing", "yds", "RB"),
    "player_reception_yds":  ("rec_yds", "receiving", "yds", "WR"),
    "player_receptions":     ("receptions", "receiving", "", "WR"),
    "player_anytime_td":     ("anytime_td", "td", "", "RB"),
}


def _ascii(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()


def norm(name):
    """Player-name key: ascii, alpha only (so 'C.J. Carr' == 'CJ Carr')."""
    return re.sub(r"[^a-z]", "", _ascii(name).lower())


def tnorm(s):
    """Team-name key: ascii words (for Odds-full-name <-> CFBD-short-name matching)."""
    return " ".join("".join(c if c.isalnum() else " " for c in _ascii(s).lower()).split())


def cfbd_team_map(odds_names, key):
    """Map each Odds API team name ('USC Trojans') to its CFBD school name ('USC') by the
    same prefix rule cfb_export uses. Falls back to the original name if no match."""
    st, teams = cc.cfbd_get("/teams/fbs", {"year": CUR_SEASON}, key)
    schools = [t.get("school") for t in teams if t.get("school")] if isinstance(teams, list) else []
    out = {}
    for od in set(odds_names):
        on = tnorm(od)
        best = None
        for sc in schools:
            cn = tnorm(sc)
            if cn == on or on.startswith(cn + " ") or cn.startswith(on + " "):
                if best is None or len(tnorm(best)) < len(cn):
                    best = sc
        out[od] = best or od
    return out


def sb_get(path):
    """PostgREST read, PAGED.

    This used to be a single un-ranged request, which silently capped at PostgREST's default 1000
    rows. Measured on the 2026-09-05 slate: the latest snapshot held 4,167 rows, sb_get returned
    exactly 1,000 of them, and because the query is unordered *which* 1,000 was arbitrary. The
    downstream effect was that fetch_props() saw 7 of 35 games and 145 of 716 priced players, so
    28 games had no prop coverage and starters the book had a line on -- Keelon Russell's 244.5
    passing yards among them -- had no row on the board at all.

    A response that comes back exactly at the page size is indistinguishable from a complete one, so
    the only safe read is to keep asking until a short page arrives. Same fix as pg() in
    analysis/player_proj_export.py, which already did this correctly."""
    url, key = oc.load_env().get("SUPABASE_URL"), oc.load_env().get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env")
    out, PAGE, off = [], 1000, 0
    while True:
        req = urllib.request.Request(url.rstrip("/") + "/rest/v1/" + path,
                                     headers={"apikey": key, "Authorization": f"Bearer {key}",
                                              "Range-Unit": "items",
                                              "Range": f"{off}-{off + PAGE - 1}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            page = json.loads(r.read())
        out += page
        if len(page) < PAGE:
            return out
        off += PAGE
        if off >= 200000:                     # runaway guard; a slate is ~5k rows
            print(f"  WARNING: sb_get stopped at {off} rows for {path[:60]} -- result may be partial")
            return out


def implied_pct(american):
    """American odds -> implied probability as a percent (book's Yes price, vig included)."""
    a = float(american)
    p = (100.0 / (a + 100.0)) if a > 0 else (-a / (-a + 100.0))
    return round(100.0 * p, 1)


def fetch_props():
    """Current NCAAF props from the latest cfb_prop_snapshots snapshot -> one consensus line
    per (event, market, player). Consensus = median line (yardage/receptions) or median
    implied % from the Yes price (anytime TD)."""
    latest = sb_get("cfb_prop_snapshots?select=snapshot_at&order=snapshot_at.desc&limit=1")
    if not latest:
        return []
    snap = latest[0]["snapshot_at"]
    rows = sb_get("cfb_prop_snapshots?snapshot_at=eq." + urllib.parse.quote(snap) +
                  "&select=event_id,commence,home_team,away_team,market,player,side,line,price")
    agg = {}
    for r in rows:
        mk = r.get("market")
        if mk not in MARKETS:
            continue
        side = r.get("side")
        if mk == "player_anytime_td":
            if side != "Yes":
                continue
        elif side != "Over":
            continue
        key = (r["event_id"], mk, r["player"])
        d = agg.setdefault(key, {"event": r["event_id"], "market": mk, "player": r["player"],
                                 "home": r.get("home_team"), "away": r.get("away_team"),
                                 "commence": r.get("commence"), "lines": [], "prices": []})
        if r.get("line") is not None:
            d["lines"].append(float(r["line"]))
        if r.get("price") is not None:
            d["prices"].append(int(r["price"]))
    out = []
    for d in agg.values():
        lines = sorted(d["lines"])
        d["line"] = (lines[len(lines) // 2] if lines else None)   # None for anytime TD
        if d["market"] == "player_anytime_td":
            pr = sorted(d["prices"])
            d["book"] = implied_pct(pr[len(pr) // 2]) if pr else 0    # book's Yes %
        else:
            d["book"] = d["line"] if d["line"] is not None else 0
        out.append(d)
    return out


def _num(x):
    try:
        return float(str(x).replace(",", ""))
    except (TypeError, ValueError):
        return None


LOG_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "cfb_logs")


def _cache_path(team, season):
    safe = re.sub(r"[^A-Za-z0-9]+", "_", team).strip("_") or "team"
    return os.path.join(LOG_CACHE, str(season), f"{safe}.json")


def _cached_team_season(team, season):
    """Read a cached /games/players payload, or None.

    Only COMPLETED seasons are cached. HIST_SEASONS is [2024, 2025] against a CUR_SEASON of 2026,
    so every payload here is finished and immutable — a game log for 2024 will never change.

    This exists because fixing the 1000-row truncation in sb_get raised the slate from 7 games to
    35, and team_logs walks TEAMS: 14 -> 86, i.e. 172 CFBD calls per run instead of ~28. That does
    not fit in the workflow's 25-minute budget, so the correct fix is to stop re-downloading data
    that cannot change rather than to raise the timeout."""
    if season >= CUR_SEASON:                     # in-progress season: always fetch fresh
        return None
    p = _cache_path(team, season)
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _cache_team_season(team, season, data):
    if season >= CUR_SEASON:
        return
    p = _cache_path(team, season)
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)   # data/ is gitignored -> may not exist
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except OSError:
        pass                                     # cache is an optimisation, never a dependency


CFBD_WORKERS = 8      # concurrent /games/players pulls; see _fetch_all_logs


def _fetch_one(team, season, key):
    """Cache-first fetch of one team-season payload. Returns (team, season, data|None)."""
    data = _cached_team_season(team, season)
    if data is not None:
        return team, season, data
    st, data = cc.cfbd_get("/games/players", {"year": season, "team": team}, key)
    if st != 200 or not isinstance(data, list):
        return team, season, None
    _cache_team_season(team, season, data)
    return team, season, data


def _fetch_all_logs(teams, key):
    """Pull every (team, season) payload CONCURRENTLY.

    These calls are pure network wait — the old loop issued them one at a time, so a 86-team slate
    spent ~40 minutes with the CPU idle. cfbd_get is stateless per call (it builds its own Request)
    and already retries 429/5xx with backoff, so it is safe to run in a thread pool.

    Workers are kept modest deliberately: the point is to overlap latency, not to hammer CFBD.
    Eight in flight turns ~172 sequential round-trips into ~22 waves. Cached team-seasons return
    without a request at all, so a warm run barely touches the pool.

    Returns {(team, season): payload}; failures are simply absent, exactly as the sequential
    version skipped them via `continue`."""
    jobs = [(t, s) for t in sorted(set(teams)) for s in HIST_SEASONS]
    out, failed = {}, 0
    oc.ensure_ssl_certs()          # once, up front — not from inside every worker
    with cf.ThreadPoolExecutor(max_workers=CFBD_WORKERS) as ex:
        futures = [ex.submit(_fetch_one, t, s, key) for t, s in jobs]
        for fut in cf.as_completed(futures):
            team, season, data = fut.result()
            if data is None:
                failed += 1
            else:
                out[(team, season)] = data
    if failed:
        print(f"  WARNING: {failed} of {len(jobs)} team-season log pulls failed (skipped)")
    return out


def team_logs(teams, key, cur_team=None):
    """Per-athlete game logs for the given teams across HIST_SEASONS.
    -> { norm_name: {"team": t, "display": name, "games": [ {season, homeAway, pass_yds, ...} ] } }

    `cur_team` ({norm_name: team}, from the depth chart) is used only to break name collisions --
    see the collapse step at the end."""
    payloads = _fetch_all_logs(teams, key)
    by_id = {}
    # Parse SEQUENTIALLY in a fixed (team, season) order. Only the network is parallel: `logs` is
    # built by appending to shared lists, and the ordering feeds recency weighting downstream, so
    # parsing off the completion order would make the output depend on which request finished first.
    for team in sorted(set(teams)):
        for season in HIST_SEASONS:
            data = payloads.get((team, season))
            if not isinstance(data, list):
                continue
            for g in data:
                gid = g.get("id") or 0
                for tm in g.get("teams", []):
                    if tm.get("team") != team:
                        continue
                    ha = tm.get("homeAway")
                    # gather this team's per-athlete stats for this game
                    per = {}   # norm_name -> {stat: value, display: name}
                    for cat in tm.get("categories", []):
                        cname = cat.get("name")
                        for typ in cat.get("types", []):
                            tname = typ.get("name")
                            for a in typ.get("athletes", []):
                                # Key on CFBD's athlete id, not the name. Once logs are pulled for
                                # every FBS team rather than just the slate, name collisions are
                                # routine, and a name-keyed dict merges two different players'
                                # games into one projection.
                                aid = str(a.get("id") or "") or ("name:" + norm(a.get("name")))
                                if not norm(a.get("name")):
                                    continue
                                slot = per.setdefault(aid, {"display": a.get("name")})
                                if cname == "passing" and tname == "C/ATT":
                                    m = re.match(r"\s*\d+\s*/\s*(\d+)", str(a.get("stat") or ""))
                                    slot[("passing", "ATT")] = float(m.group(1)) if m else None
                                else:
                                    slot[(cname, tname)] = _num(a.get("stat"))
                    for aid, slot in per.items():
                        td = (slot.get(("rushing", "TD")) or 0) + (slot.get(("receiving", "TD")) or 0)
                        rec = {
                            "season": season, "homeAway": ha, "gid": gid,
                            "pass_yds": slot.get(("passing", "YDS")),
                            "pass_att": slot.get(("passing", "ATT")),   # parsed from C/ATT below
                            "pass_tds": slot.get(("passing", "TD")),
                            "rush_yds": slot.get(("rushing", "YDS")),
                            "carries": slot.get(("rushing", "CAR")),
                            "rec_yds": slot.get(("receiving", "YDS")),
                            "receptions": slot.get(("receiving", "REC")),
                            "td": td, "scored": (1 if td > 0 else 0),
                        }
                        e = by_id.setdefault(aid, {"team": team, "display": slot["display"],
                                                   "teams": set(), "games": []})
                        e["teams"].add(team)
                        e["games"].append(rec)

    # chronological order (season, then ESPN game id) so recency weighting sees the true
    # end-of-season role — a late-season promotion is the most recent games.
    for e in by_id.values():
        e["games"].sort(key=lambda g: (g["season"], g["gid"]))

    # Collapse athlete-id records to the name key the rest of the module looks up by.
    #
    # Two DIFFERENT players can normalise to the same name across 138 teams, so when that happens
    # pick deliberately rather than letting the last one win: prefer the athlete whose schools
    # include the team the depth chart says this name is on now, and otherwise the one with the
    # most games. A transfer is NOT this case -- he is one athlete id with two schools, and his
    # games from both are kept, which is what we want to project from.
    logs, by_name = {}, {}
    for aid, e in by_id.items():
        by_name.setdefault(norm(e["display"]), []).append(e)
    collisions = 0
    for nm, cands in by_name.items():
        if len(cands) > 1:
            collisions += 1
            want = (cur_team or {}).get(nm)
            cands = sorted(cands, key=lambda e: ((want in e["teams"]) if want else False,
                                                 len(e["games"])), reverse=True)
        e = cands[0]
        logs[nm] = {"team": e["team"], "display": e["display"], "games": e["games"]}
    if collisions:
        print(f"  {collisions} name collisions across athlete ids, resolved by current team + games")
    return logs


def series(games, market):
    """The per-game values for a market (games where the player actually recorded it)."""
    if market == "anytime_td":
        return [(1 if (g["td"] or 0) > 0 else 0) for g in games if g["td"] is not None]
    vals = [g[market] for g in games if g.get(market) is not None]
    return vals


def over_split(games, market, line, pred):
    """(times over, games) over the subset of games matching pred(g)."""
    gs = [g for g in games if pred(g)]
    if market == "anytime_td":
        vals = [1 if (g["td"] or 0) > 0 else 0 for g in gs if g["td"] is not None]
        return sum(vals), len(vals)                          # "over" = scored
    if line is None:
        return 0, 0
    vals = [g[market] for g in gs if g.get(market) is not None]
    return sum(1 for v in vals if v > line), len(vals)


def infer_td_pos(games):
    """Position for an anytime-TD scorer from their usage: a clear passer is a QB, otherwise
    RB vs WR by whether they gain more rushing or receiving yards over their game log."""
    passing = sum(g["pass_yds"] or 0 for g in games)
    rush = sum(g["rush_yds"] or 0 for g in games)
    rec = sum(g["rec_yds"] or 0 for g in games)
    if passing >= 300 and passing > rush + rec:
        return "QB"
    return "RB" if rush >= rec else "WR"


DECAY = 0.82           # default recency weight (each game back counts DECAY x)
DECAY_MOVED = 0.78     # promoted / new starter: the recent role dominates
DECAY_RETURN = 0.94    # returning starter: mostly their full body of work
LEAGUE_EFF = {"ypc": 4.7, "ypr": 12.0, "ypa": 7.6, "tdpt": 0.05, "passtd": 0.045}
REG = {"ypc": 40.0, "ypr": 24.0, "ypa": 80.0, "tdpt": 22.0, "passtd": 25.0}


def _recent_avg(games, field, decay=DECAY):
    """Recency-weighted per-game average (games are chronological; recent ones weigh more)."""
    gs = [g for g in games if g.get(field) is not None]
    n = len(gs)
    if not n:
        return None
    ws = [decay ** (n - 1 - i) for i in range(n)]
    return sum(w * (gs[i][field] or 0) for i, w in enumerate(ws)) / sum(ws)


def _flat_avg(games, field):
    gs = [g for g in games if g.get(field) is not None]
    return (sum(g[field] or 0 for g in gs) / len(gs)) if gs else 0.0


def _recent_rate(games, num_f, den_f, prior, k, decay=DECAY):
    """Recency-weighted efficiency num/den, regressed toward a league prior (k 'prior touches')."""
    gs = [g for g in games if g.get(den_f) is not None]
    n = len(gs)
    if not n:
        return prior
    ws = [decay ** (n - 1 - i) for i in range(n)]
    num = sum(w * (gs[i].get(num_f) or 0) for i, w in enumerate(ws))
    den = sum(w * (gs[i].get(den_f) or 0) for i, w in enumerate(ws))
    return (num + k * prior) / (den + k) if (den + k) > 0 else prior


def _decay_for(games, field, role_vol):
    """How hard to weight recency for THIS player+stat. A new/promoted starter — whose role
    (baseline) or recent workload sits well above their season-long average — leans on recent
    games; a returning starter, already at that workload, leans on their fuller history."""
    flat = _flat_avg(games, field)
    if flat <= 0:
        return DECAY_MOVED
    recent = _recent_avg(games, field, DECAY_MOVED) or 0.0
    if role_vol > 1.30 * flat or recent > 1.35 * flat:
        return DECAY_MOVED
    return DECAY_RETURN


def project(games, market):
    """Line-blind baseline, recency-weighted so a player's recent form and end-of-season role
    lead over a flat season average (per-game TD rate for anytime TD)."""
    if market == "anytime_td":
        r = _recent_avg(games, "scored")
        return None if r is None else round(100.0 * r, 1)
    r = _recent_avg(games, market)
    return None if r is None else round(r, 1)


# ---- Role-adjusted volume ----------------------------------------------------------------
# "Volume persists, efficiency doesn't." A player's per-game average bakes in the role they
# HELD (e.g. an RB2's carries). Given their CURRENT depth-chart rank we re-scale volume to the
# role they now HOLD, keeping their own efficiency: proj = own_per_game x (role_vol / own_vol).
# So a back-up promoted to starter is projected on a starter's workload, not last year's.
POOL = {"QB": "QB", "RB": "RB", "WR": "WR", "TE": "WR", "FB": "RB"}
VOL_FIELD = {"QB": "pass_att", "RB": "carries", "WR": "receptions"}  # stat that RANKS a pool
FIELDS = ["carries", "receptions", "pass_att"]                       # volumes we baseline
TE_VOL_FACTOR = 0.72          # a TE1 sees fewer targets than a WR1 at the same "rank"
DEFAULT_VOL = {"carries": 10.0, "receptions": 3.6, "pass_att": 28.0}   # per-game fallback

# How far the ROLE's baseline workload may exceed the volume a player has actually demonstrated.
#
# rolevol() takes max(role_baseline, own_recent), so it can only ratchet volume UP -- a player whose
# depth slot is generous is handed the role's workload even when his own history is far below it.
# That is what put a TE1 on 4.9 receptions/game (exactly Miami's WR1 baseline x TE_VOL_FACTOR) when
# he had cleared a 1.5-reception line in 9 of 19 games, and turned a 16.5-yard receiving line into a
# 56.7-yard projection -- 3.4x a number his own median sits right on.
#
# Measured before this cap: median(proj / book line) for well-sampled players whose line IS their
# median (they clear it 40-60% of the time) was 1.52 in NCAAF against 1.01 in the NFL, whose depth
# and game samples are rich enough that this never bites.
#
# This is a BLUNT INSTRUMENT and deliberately so -- it clamps the symptom while the underlying
# question (why CFB own-volume reads so low against the role baseline) is still open. A genuine
# promotion still lifts a player, just not without limit.
ROLE_VOL_CAP = 1.6
# ...and how many games of that stat we need before the cap is allowed to bite at all.
#
# The cap is multiplicative on a player's own volume, so on a near-zero own volume ANY multiple is
# still near zero. Applied unconditionally it wrecked exactly the players it should have left alone:
# a promoted QB1 with 3 games of mop-up duty was clamped to 39.2 passing yards against a 155.5 line.
# Measured, median(proj / line) split cleanly by sample size -- 0.52 for players with <=4 games
# against 1.07 for those with >=10. With two or three games a player's own volume is noise and the
# ROLE baseline is the better estimate, which is what project_role did before the cap existed.
CAP_MIN_GAMES = 8


def _sum(games, f):
    return sum(g[f] or 0 for g in games if g.get(f) is not None)


def _gp(games, f):
    return len([g for g in games if g.get(f) is not None])


def _pos_from_usage(games):
    p, ru, re_ = _sum(games, "pass_yds"), _sum(games, "rush_yds"), _sum(games, "rec_yds")
    if p >= 300 and p > ru + re_:
        return "QB"
    return "RB" if ru >= re_ else "WR"


def rank_baselines(logs):
    """From game logs, the per-game VOLUME the holder of each (pool, rank) averaged — per team
    and a league fallback. Rank each team's players (by most-recent-season volume) within their
    pool; the top gets rank 1, etc. This is the workload a role implies, independent of who filled it."""
    by_team = {}
    for e in logs.values():
        by_team.setdefault(e["team"], []).append(e)
    per_team, league = {}, {}
    for team, entries in by_team.items():
        by_pool = {}
        for e in entries:
            recent = [g for g in e["games"] if g["season"] == PRIOR_SEASON] or e["games"]
            pool = POOL.get(_pos_from_usage(recent), "WR")
            gp = _gp(recent, VOL_FIELD[pool])          # rank by the pool's primary volume
            if not gp:
                continue
            prim = _sum(recent, VOL_FIELD[pool]) / gp
            if prim <= 0:
                continue
            # record EVERY field's per-game volume for this ranked player (an RB1 has both a
            # carries baseline and a receptions baseline)
            fields = {f: (_sum(recent, f) / _gp(recent, f) if _gp(recent, f) else 0.0) for f in FIELDS}
            by_pool.setdefault(pool, []).append((prim, fields))
        tb = {}
        for pool, lst in by_pool.items():
            for i, (_, fields) in enumerate(sorted(lst, key=lambda x: -x[0])):
                tb[(pool, i + 1)] = fields
                league.setdefault((pool, i + 1), []).append(fields)
        per_team[team] = tb
    lg = {k: {f: sum(d[f] for d in lst) / len(lst) for f in FIELDS} for k, lst in league.items()}
    return per_team, lg


def expected_volume(team, pool, rank, field, per_team, league):
    """Per-game volume of `field` for the holder of (pool, rank): team baseline, else league,
    else a flat default."""
    d = per_team.get(team, {}).get((pool, rank))
    if d is None:
        for rr in (rank, rank - 1, rank + 1, 1, 2):
            if (pool, rr) in league:
                d = league[(pool, rr)]; break
    return (d or {}).get(field, DEFAULT_VOL.get(field, 3.5)) or DEFAULT_VOL.get(field, 3.5)


def project_role(games, market, pos, rank, team, per_team, league):
    """Volume x efficiency. Volume = the GREATER of the depth role's baseline workload and the
    player's recent workload (so a depth-chart promotion OR a late-season surge lifts it);
    efficiency is recency-weighted. Recency is weighted harder for a promoted/new starter than
    for a returning one. A promoted back is projected on a starter's carries at his own YPC,
    not last year's back-up average."""
    pool = POOL.get(pos, "WR")

    def rolevol(field):
        # QB volumes are ranked among QBs; a receiver's/back's field baseline is at their rank.
        use_rank = 1 if pool == "QB" and field == "pass_att" else rank
        use_pool = "QB" if field == "pass_att" else pool
        base = expected_volume(team, use_pool, use_rank, field, per_team, league)
        if pos == "TE" and field == "receptions":
            base *= TE_VOL_FACTOR
        decay = _decay_for(games, field, base)
        own = _recent_avg(games, field, decay) or 0.0
        v = max(base, own)
        # Cap the role lift against what the player has actually done -- but only when his own
        # volume is worth trusting. Too few games and this clamps a genuine promotion to his
        # backup workload; see CAP_MIN_GAMES.
        if own > 0 and _gp(games, field) >= CAP_MIN_GAMES:
            v = min(v, ROLE_VOL_CAP * own)
        return v, decay

    if market == "pass_yds":
        v, dec = rolevol("pass_att")
        return round(v * _recent_rate(games, "pass_yds", "pass_att", LEAGUE_EFF["ypa"], REG["ypa"], dec), 1)
    if market == "pass_tds":
        v, dec = rolevol("pass_att")
        return round(v * _recent_rate(games, "pass_tds", "pass_att", LEAGUE_EFF["passtd"], REG["passtd"], dec), 1)
    if market == "rush_yds":
        v, dec = rolevol("carries")
        return round(v * _recent_rate(games, "rush_yds", "carries", LEAGUE_EFF["ypc"], REG["ypc"], dec), 1)
    if market == "rec_yds":
        v, dec = rolevol("receptions")
        return round(v * _recent_rate(games, "rec_yds", "receptions", LEAGUE_EFF["ypr"], REG["ypr"], dec), 1)
    if market == "receptions":
        v, _ = rolevol("receptions")
        return round(v, 1)
    if market == "anytime_td":
        field = "carries" if pool == "RB" else "receptions"
        touches, dec = rolevol(field)
        tpt = min(0.45, _recent_rate(games, "td", field, LEAGUE_EFF["tdpt"], REG["tdpt"], dec))
        rate = 1 - (1 - tpt) ** max(0.1, touches)          # P(≥1 TD) at the projected workload
        return round(100.0 * min(0.99, rate), 1)
    return project(games, market)


# ---- Matchup: how a defence has handled this CATEGORY (Context, never a projection input) ----
# Same idea as the NFL tag, measured separately on CFB rather than assumed to transfer — and it is
# STRONGER here, which is what you would expect when the talent gap between defences is enormous.
# Opponent defence vs category, against how much a player beat his OWN baseline, 2024-25:
#
#     passing    corr +0.1036   bad -10.55 | toss-up  +1.75 | good +10.81   (yds vs own baseline)
#     rushing    corr +0.1258   bad  -4.34 | toss-up  +0.81 | good  +5.35
#     receiving  corr +0.0541   bad  -1.78 | toss-up  +0.62 | good  +1.80
#     overall    corr +0.0842   (the NFL equivalent is +0.0581)
#
# CFB box scores carry no position, so the groups are the stat categories themselves. That is also
# why PASSING gets a tag here while NFL QBs do not: it was measured here and has not been there.
#
# Context only. Not folded into any projection, not an edge claim.
CFB_MATCHUP_LO, CFB_MATCHUP_HI = 0.94, 1.06
# our market -> the defensive category that matters for it
MARKET_GRP = {"pass_yds": "passing", "pass_tds": "passing",
              "rush_yds": "rushing", "rec_yds": "receiving", "receptions": "receiving"}
# anytime TD spans both, so it follows the player's depth-chart position instead
POS_GRP = {"QB": "passing", "RB": "rushing", "FB": "rushing", "WR": "receiving", "TE": "receiving"}


def defence_by_category(payloads, meta):
    """{(team, category): yards allowed per game relative to the league} from completed games.

    Built from the SAME cached team-season payloads team_logs already pulled, so it costs no extra
    CFBD calls. Uses the prior season, because this runs before the current one has games."""
    allowed, played = {}, {}
    for (team, season), games in payloads.items():
        if season != PRIOR_SEASON:
            continue
        for g in games or []:
            tms = g.get("teams") or []
            if len(tms) != 2:
                continue
            for i, tm in enumerate(tms):
                opp = tms[1 - i].get("team")
                if not opp:
                    continue
                for cat in tm.get("categories", []):
                    if cat.get("name") not in ("passing", "rushing", "receiving"):
                        continue
                    for ty in cat.get("types", []):
                        if ty.get("name") != "YDS":
                            continue
                        tot = 0.0
                        for a in ty.get("athletes", []):
                            try:
                                tot += float(str(a.get("stat") or "").replace(",", ""))
                            except ValueError:
                                pass
                        k = (opp, cat["name"])
                        allowed[k] = allowed.get(k, 0.0) + tot
                        played[k] = played.get(k, 0) + 1
    per = {k: allowed[k] / played[k] for k in allowed if played[k] >= 4}
    out = {}
    for cat in ("passing", "rushing", "receiving"):
        vals = [v for (t, c), v in per.items() if c == cat]
        if not vals:
            continue
        lg = sum(vals) / len(vals)
        if lg <= 0:
            continue
        for (t, c), v in per.items():
            if c == cat:
                out[(t, c)] = v / lg
    return out


def cfb_matchup(defmap, opponent, market, pos):
    """'good' | 'toss' | 'bad', or None when this opponent has no rate yet."""
    grp = MARKET_GRP.get(market) or POS_GRP.get(pos)
    if not grp:
        return None
    rel = defmap.get((str(opponent), grp))
    if rel is None:
        return None
    return "good" if rel >= CFB_MATCHUP_HI else "bad" if rel <= CFB_MATCHUP_LO else "toss"


def current_team_map(depth):
    """{norm_name: team} — the team a player is on NOW, from the scraped depth charts.

    team_logs takes a player's team from his CFBD GAME LOGS, i.e. wherever he last played. In
    college that is wrong constantly: the transfer portal moves thousands of players a year, and
    `logs` is built with setdefault over an alphabetically sorted team list, so a transfer's team
    is whichever of his schools sorts first. Tayven Jackson showed on the board as "QB1, Indiana"
    while the depth chart had him at North Texas — Indiana simply sorts earlier.

    Two failures came out of that, and the second is much worse than the first:
      1. Visible: the wrong team printed next to a player's slot.
      2. Invisible: build_slate drops a player whose logged team is not in the game. For a
         transfer that is the OLD school, so unless he happens to be facing it he vanishes.
         Measured on the 2026-09-05 slate: 345 priced players who ARE on the current depth chart
         had no row — 35 QB1s, 30 RB1s, 36 WR1s, 35 TE1s. The board carried 292 of 716 priced
         players.

    The depth chart is scraped fresh, so it is the authority on who is on which roster now. His
    game LOGS still come from wherever he played them — that is the projection — only the team
    LABEL and the in-game check are corrected."""
    out = {}
    for team, groups in (depth or {}).items():
        for names in (groups or {}).values():
            for name in names or []:
                out.setdefault(norm(name), team)
    return out


def depth_lookup(depth):
    """{(cfbd_team, norm_name): (pos, rank)} from the scraped depth charts."""
    out = {}
    for team, groups in (depth or {}).items():
        for pos, names in groups.items():
            for i, n in enumerate(names):
                out[(team, norm(n))] = (pos, i + 1)
    return out


def build(props, key, depth):
    teams = set()
    for p in props:
        teams.add(p["home"]); teams.add(p["away"])
    logs = team_logs(teams, key)
    # Re-tag every player with the team he is on NOW. Must happen BEFORE rank_baselines and before
    # either pass reads e["team"] — the role baselines and both in-game guards key off it.
    # See current_team_map().
    retagged = 0
    for _nm, _e in logs.items():
        _t = cur.get(_nm)
        if _t and _t != _e["team"]:
            _e["team"] = _t
            retagged += 1
    print(f"  re-tagged {retagged} players to their current team from the depth chart")
    per_team, league = rank_baselines(logs)
    dlook = depth_lookup(depth)

    out, matched, missed, roled = [], 0, 0, 0
    for p in props:
        mk, cat, unit, pos = MARKETS[p["market"]]
        # match the prop player within the two teams in this game
        e = logs.get(norm(p["player"]))
        if not e or e["team"] not in (p["home"], p["away"]):
            missed += 1
            continue
        games = e["games"]
        if not series(games, mk):
            missed += 1
            continue
        matched += 1
        team = e["team"]
        # current role from the depth chart (accurate), falling back to usage inference
        dpos, drank = dlook.get((team, norm(p["player"])), (None, None))
        if mk == "anytime_td":
            pos = dpos or infer_td_pos(games)
        else:
            pos = dpos or pos
        line = p["line"]
        cO, cG = over_split(games, mk, line, lambda g: True)
        pO, pG = over_split(games, mk, line, lambda g: g["season"] == PRIOR_SEASON)
        hO, hG = over_split(games, mk, line, lambda g: g["homeAway"] == "home")
        rO, rG = over_split(games, mk, line, lambda g: g["homeAway"] == "away")
        # Role-adjust the projection when we know the player's current depth rank; otherwise
        # fall back to their raw per-game baseline.
        if drank:
            proj = project_role(games, mk, pos, drank, team, per_team, league)
            roled += 1
        else:
            proj = project(games, mk)
        if proj is None:
            continue
        out.append({
            "game": f"{p['away']} @ {p['home']}",
            "commence": p["commence"], "player": e["display"], "team": e["team"], "pos": pos,
            "cat": cat, "market": mk, "book": p["book"],
            "proj": proj, "g": len([g for g in games if g.get(mk) is not None]) if mk != "anytime_td" else len(games),
            "cOver": cO, "cG": cG, "pOver": pO, "pG": pG, "hOver": hO, "hG": hG, "rOver": rO, "rG": rG,
        })
    print(f"  role-adjusted {roled} of {matched} matched rows from the depth chart")
    return out, matched, missed


def upcoming_games(db, season):
    """The soonest not-yet-played week's FBS-vs-FBS games (away, home, start_date). Already-played
    games are excluded — the player model is forward-looking."""
    if not os.path.exists(db):
        return None, []
    conn = sqlite3.connect(db)
    row = conn.execute(
        "SELECT MIN(week) FROM games WHERE season=? AND home_class='fbs' AND away_class='fbs' "
        "AND home_points IS NULL", (season,)).fetchone()
    wk = row[0] if row else None
    if wk is None:
        conn.close()
        return None, []
    games = conn.execute(
        "SELECT away_team, home_team, start_date FROM games WHERE season=? AND week=? "
        "AND home_class='fbs' AND away_class='fbs' AND home_points IS NULL ORDER BY start_date",
        (season, wk)).fetchall()
    conn.close()
    return wk, games


def build_slate(slate, depth, prop_index, key):
    """Depth-chart-driven projections for an upcoming slate. For every game we project the realistic
    starters/rotation on each side (DEPTH_LIMIT), whether or not a book has posted a prop yet — so
    the board is full of our line-blind numbers ahead of the market. A posted prop attaches its line
    (`book`); otherwise `book` is None and the over-rates use our own projection as the reference."""
    # Pull logs for EVERY team on the depth chart, not just the teams playing this week.
    #
    # A transfer's history lives under his OLD school. Fetching only slate teams meant that unless
    # he happened to be facing that school we had no log for him at all, so he was dropped -- 274
    # priced players on the 2026-09-05 slate, after the team re-tag had already recovered 150.
    # Completed seasons are immutable and cached per team-season, so the extra teams cost CFBD
    # calls exactly once and nothing on every run after.
    slate_teams = set()
    for away, home, _ in slate:
        slate_teams.add(away)
        slate_teams.add(home)
    cur = current_team_map(depth)
    teams = set(depth or {}) | slate_teams
    print(f"  pulling game logs for {len(teams)} teams ({len(slate_teams)} on this slate)")
    logs = team_logs(teams, key, cur)
    # Re-tag every player with the team he is on NOW. Must happen BEFORE rank_baselines and before
    # either pass reads e["team"] — the role baselines and both in-game guards key off it.
    # See current_team_map().
    retagged = 0
    for _nm, _e in logs.items():
        _t = cur.get(_nm)
        if _t and _t != _e["team"]:
            _e["team"] = _t
            retagged += 1
    print(f"  re-tagged {retagged} players to their current team from the depth chart")
    # Context matchup tag. _fetch_all_logs reads the same per-team-season cache team_logs just
    # used, so this is disk-only — no extra CFBD calls. See defence_by_category().
    defmap = defence_by_category(_fetch_all_logs(teams, key), None)
    print(f"  matchup: {len(defmap)} team-category defence rates from {PRIOR_SEASON}")
    per_team, league = rank_baselines(logs)

    out, seen = [], set()
    for away, home, commence in slate:
        gk = f"{away} @ {home}"
        for team in (away, home):
            for pos, names in (depth.get(team) or {}).items():
                lim = DEPTH_LIMIT.get(pos, 0)
                for rank, name in enumerate(names[:lim], start=1):
                    e = logs.get(norm(name))
                    if not e or e["team"] != team:
                        continue                      # no CFBD game log (e.g. true freshman) -> skip
                    games = e["games"]
                    for mk in POS_MARKETS.get(pos, []):
                        if mk != "anytime_td" and not series(games, mk):
                            continue                  # no history for this stat
                        sig = (gk, norm(name), mk)
                        if sig in seen:
                            continue
                        proj = project_role(games, mk, pos, rank, team, per_team, league)
                        if proj is None:
                            continue
                        book = prop_index.get(sig)    # posted line/% if a book has it, else None
                        # Hit-rates are "% over the LINE", so they only mean something when a book
                        # has posted one. TD rate needs no line (it counts scoring games), so it
                        # always shows. Yardage/receptions rates stay blank until the line posts.
                        if mk == "anytime_td":
                            cO, cG = over_split(games, mk, None, lambda g: True)
                            pO, pG = over_split(games, mk, None, lambda g: g["season"] == PRIOR_SEASON)
                            hO, hG = over_split(games, mk, None, lambda g: g["homeAway"] == "home")
                            rO, rG = over_split(games, mk, None, lambda g: g["homeAway"] == "away")
                        elif book is not None:
                            cO, cG = over_split(games, mk, book, lambda g: True)
                            pO, pG = over_split(games, mk, book, lambda g: g["season"] == PRIOR_SEASON)
                            hO, hG = over_split(games, mk, book, lambda g: g["homeAway"] == "home")
                            rO, rG = over_split(games, mk, book, lambda g: g["homeAway"] == "away")
                        else:
                            cO = cG = pO = pG = hO = hG = rO = rG = 0   # no line yet -> "—"
                        cat, _unit = MARKET_CAT[mk]
                        out.append({
                            "game": gk, "commence": commence, "player": e["display"],
                            "team": team, "pos": pos, "cat": cat, "market": mk, "book": book,
                            "proj": proj,
                            "g": len([g for g in games if g.get(mk) is not None]) if mk != "anytime_td" else len(games),
                            "cOver": cO, "cG": cG, "pOver": pO, "pG": pG,
                            "hOver": hO, "hG": hG, "rOver": rO, "rG": rG,
                            "matchup": cfb_matchup(defmap, home if team == away else away, mk, pos),
                        })
                        seen.add(sig)

    # ---- Second pass: players the MARKET priced but the depth chart never mentioned ------------
    # The loop above walks the depth chart only, so a player missing from it is invisible no matter
    # how the books price him. Measured on one snapshot: 195 of 813 players with posted props (24%)
    # are absent from the scraped chart -- including Malachi Toney, whom the market had at -250 to
    # score, second shortest in his game, while our chart's "WR1" sat at +350 and Toney had no row
    # at all. Ourlads lags the transfer portal and early-season depth moves, and it lists only a
    # handful per position, so "not in the chart" says nothing about whether a player matters.
    #
    # A posted prop is the market telling us he matters, so he gets projected. This does NOT make
    # the model line-aware: we use the EXISTENCE of a prop to decide who appears -- coverage, which
    # was already prop-driven -- never its VALUE, which would break the line-blind rule. And with no
    # depth rank there is no role baseline to scale to, so these rows use the player's own history
    # straight, which also keeps them clear of the role-volume ratchet.
    for away, home, commence in slate:
        gk = f"{away} @ {home}"
        for (pgk, pname, mk), book in prop_index.items():
            if pgk != gk:
                continue
            sig = (gk, pname, mk)
            if sig in seen:
                continue
            e = logs.get(pname)
            if not e or e["team"] not in (away, home):
                continue                          # no CFBD game log -> nothing to project from
            games = e["games"]
            if mk != "anytime_td" and not series(games, mk):
                continue
            proj = project(games, mk)             # own history, NO role re-scaling (no rank known)
            if proj is None:
                continue
            if mk == "anytime_td":
                cO, cG = over_split(games, mk, None, lambda g: True)
                pO, pG = over_split(games, mk, None, lambda g: g["season"] == PRIOR_SEASON)
                hO, hG = over_split(games, mk, None, lambda g: g["homeAway"] == "home")
                rO, rG = over_split(games, mk, None, lambda g: g["homeAway"] == "away")
            else:
                cO, cG = over_split(games, mk, book, lambda g: True)
                pO, pG = over_split(games, mk, book, lambda g: g["season"] == PRIOR_SEASON)
                hO, hG = over_split(games, mk, book, lambda g: g["homeAway"] == "home")
                rO, rG = over_split(games, mk, book, lambda g: g["homeAway"] == "away")
            cat, _unit = MARKET_CAT[mk]
            out.append({
                "game": gk, "commence": commence, "player": e["display"],
                "team": e["team"], "pos": _pos_from_usage(games), "cat": cat, "market": mk,
                "book": book, "proj": proj,
                "g": len([g for g in games if g.get(mk) is not None]) if mk != "anytime_td" else len(games),
                "cOver": cO, "cG": cG, "pOver": pO, "pG": pG,
                "hOver": hO, "hG": hG, "rOver": rO, "rG": rG,
                # No depth rank on this path (that is what makes it the second pass), so the
                # anytime-TD tag falls back to the position inferred from usage.
                "matchup": cfb_matchup(defmap, home if e["team"] == away else away, mk,
                                       _pos_from_usage(games)),
            })
            seen.add(sig)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--probe", action="store_true", help="list props + match status, write nothing")
    ap.add_argument("--out", default="web/lib/ncaafPlayerProjections.ts")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    key = oc.load_env().get("CFBD_API_KEY")
    if not key:
        print("ERROR: CFBD_API_KEY missing in .env", file=sys.stderr); return 1

    # Posted props are OPTIONAL now: they attach a book line where a book has one, but the board is
    # driven by the upcoming schedule + depth charts, so it fills in even before any prop posts.
    props = fetch_props()
    if props:
        # Convert Odds API team names to CFBD school names so the game-log pull + match line up.
        cmap = cfbd_team_map([t for p in props for t in (p["home"], p["away"])], key)
        for p in props:
            p["home"], p["away"] = cmap.get(p["home"], p["home"]), cmap.get(p["away"], p["away"])
        print(f"{len(props)} posted props across "
              f"{len({(p['home'], p['away']) for p in props})} games.")
    else:
        print("No NCAAF props posted yet — projecting the upcoming slate line-blind (book = —).")
    # Index posted props by (game, player, our-market) so build_slate can attach the book line.
    prop_index = {}
    for p in props:
        mk = MARKETS[p["market"]][0]
        prop_index[(f"{p['away']} @ {p['home']}", norm(p["player"]), mk)] = p["book"]

    # Current depth charts (scraped by cfb_depth) drive role-adjusted volume. Prefer the
    # committed cfb_depth.json; scrape live if it's missing.
    depth = {}
    dj = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cfb_depth.json")
    if os.path.exists(dj):
        with open(dj, encoding="utf-8") as f:
            depth = json.load(f)
        print(f"  loaded depth charts for {len(depth)} teams from cfb_depth.json")
    else:
        try:
            import cfb_depth as cd
            st, teams = cc.cfbd_get("/teams/fbs", {"year": CUR_SEASON}, key)
            schools = [t.get("school") for t in teams if t.get("school")] if isinstance(teams, list) else []
            depth = cd.scrape_all(schools, log=lambda *a: None)
            print(f"  scraped depth charts for {len(depth)} teams (no cfb_depth.json found)")
        except Exception as e:                                   # noqa: BLE001
            print(f"  depth-chart unavailable ({e}); projections fall back to raw per-game averages")

    wk, slate = upcoming_games(DB, CUR_SEASON)
    if not slate:
        print(f"No upcoming FBS games found in {DB} (run cfb_backfill.py first).", file=sys.stderr)
        return 0
    print(f"  upcoming week {wk}: {len(slate)} games to project.")
    rows = build_slate(slate, depth, prop_index, key)
    lined = sum(1 for r in rows if r["book"] is not None)
    print(f"  {len(rows)} projection rows ({lined} with a posted book line, {len(rows) - lined} line-blind).")

    # ---- Publish ONLY players a sportsbook actually lists -------------------------------------
    # build_slate walks the whole depth chart, so it also emits rows for players no book has priced
    # (book = None, rendered as a "—" line). That was deliberate — line-blind numbers ahead of the
    # market — but it fills the board with players a bettor cannot bet: on the 2026-09-05 slate 649
    # of 756 rows (86%) had no posted line. A prop board is read against a sportsbook, so a name
    # that is not in the book's app is noise on it.
    #
    # This is a COVERAGE filter, not a model input: it uses the EXISTENCE of a posted prop to decide
    # who appears, never its VALUE. Same line the second pass in build_slate already draws, applied
    # in the other direction. Our number is still produced line-blind and is not altered here.
    #
    # Consequence to keep in mind: a game with no posted props shows no players at all, and a slate
    # captured before the books post will be thin. That is the intended reading — it says the market
    # has not priced this game yet, rather than showing rows nobody can act on.
    rows = [r for r in rows if r["book"] is not None]
    print(f"  publishing {len(rows)} rows the sportsbook lists "
          f"({len({(r['game']) for r in rows})} games with posted props).")

    if args.probe:
        for r in rows[:25]:
            bk = "—" if r["book"] is None else r["book"]
            print(f"  {r['player']:22} {r['market']:11} book {bk:>5} proj {r['proj']:>6} "
                  f"| career {r['cOver']}/{r['cG']} prior {r['pOver']}/{r['pG']}")
        return 0

    body = (
        "// AUTO-GENERATED by cfb_player_proj.py -- do not edit by hand.\n"
        "// First-pass NCAAF player-prop projections: prior-season per-game baseline (line-blind)\n"
        "// + historical over-rates vs the current book line. PRESEASON — not graded yet.\n"
        "import type { PlayerProj } from \"./playerProjections\";\n"
        f"export const NCAAF_PROJ_SEASON = {CUR_SEASON};\n"
        f"export const NCAAF_PROJ_PRIOR = {PRIOR_SEASON};\n"
        # The week this slate was built for. Without it the board had no way to tell which week the
        # rows belong to, so it showed them on EVERY week — week 5 rendered week 1's games.
        f"export const NCAAF_PROJ_WEEK = {wk};\n"
        "export const NCAAF_PLAYER_PROJECTIONS: PlayerProj[] = [\n"
        + "".join("  " + json.dumps(r) + ",\n" for r in rows)
        + "];\n"
    )
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(body)
    print(f"Wrote {args.out} ({len(rows)} rows).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
