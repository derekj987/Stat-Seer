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
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request

import cfbd_client as cc
import odds_client as oc

CUR_SEASON = 2026
PRIOR_SEASON = 2025
HIST_SEASONS = [2024, 2025]        # career = these; prior = PRIOR_SEASON only

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
    url, key = oc.load_env().get("SUPABASE_URL"), oc.load_env().get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env")
    req = urllib.request.Request(url.rstrip("/") + "/rest/v1/" + path,
                                 headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


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


def team_logs(teams, key):
    """Per-athlete game logs for the given teams across HIST_SEASONS.
    -> { norm_name: {"team": t, "games": [ {season, homeAway, pass_yds, pass_tds, rush_yds,
                                            rec_yds, receptions, td} ] } }"""
    logs = {}
    for team in sorted(set(teams)):
        for season in HIST_SEASONS:
            st, data = cc.cfbd_get("/games/players", {"year": season, "team": team}, key)
            if st != 200 or not isinstance(data, list):
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
                                nm = norm(a.get("name"))
                                if not nm:
                                    continue
                                slot = per.setdefault(nm, {"display": a.get("name")})
                                if cname == "passing" and tname == "C/ATT":
                                    m = re.match(r"\s*\d+\s*/\s*(\d+)", str(a.get("stat") or ""))
                                    slot[("passing", "ATT")] = float(m.group(1)) if m else None
                                else:
                                    slot[(cname, tname)] = _num(a.get("stat"))
                    for nm, slot in per.items():
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
                        e = logs.setdefault(nm, {"team": team, "display": slot["display"], "games": []})
                        e["games"].append(rec)
    # chronological order (season, then ESPN game id) so recency weighting sees the true
    # end-of-season role — a late-season promotion is the most recent games.
    for e in logs.values():
        e["games"].sort(key=lambda g: (g["season"], g["gid"]))
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
        return max(base, _recent_avg(games, field, decay) or 0.0), decay

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


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--probe", action="store_true", help="list props + match status, write nothing")
    ap.add_argument("--out", default="web/lib/ncaafPlayerProjections.ts")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    key = oc.load_env().get("CFBD_API_KEY")
    if not key:
        print("ERROR: CFBD_API_KEY missing in .env", file=sys.stderr); return 1

    props = fetch_props()
    if not props:
        print("No NCAAF props posted yet (cfb_prop_snapshots empty) — nothing to project.", file=sys.stderr)
        return 0
    # Convert Odds API team names to CFBD school names so the game-log pull + match line up.
    cmap = cfbd_team_map([t for p in props for t in (p["home"], p["away"])], key)
    for p in props:
        p["home"], p["away"] = cmap.get(p["home"], p["home"]), cmap.get(p["away"], p["away"])
    print(f"{len(props)} posted props across "
          f"{len({(p['home'], p['away']) for p in props})} games.")

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

    rows, matched, missed = build(props, key, depth)
    print(f"  matched {matched} to a CFBD game log, missed {missed}. {len(rows)} projection rows.")

    if args.probe:
        for r in rows[:25]:
            print(f"  {r['player']:22} {r['market']:11} book {r['book']:>5} proj {r['proj']:>6} "
                  f"| career {r['cOver']}/{r['cG']} prior {r['pOver']}/{r['pG']}")
        return 0

    body = (
        "// AUTO-GENERATED by cfb_player_proj.py -- do not edit by hand.\n"
        "// First-pass NCAAF player-prop projections: prior-season per-game baseline (line-blind)\n"
        "// + historical over-rates vs the current book line. PRESEASON — not graded yet.\n"
        "import type { PlayerProj } from \"./playerProjections\";\n"
        f"export const NCAAF_PROJ_SEASON = {CUR_SEASON};\n"
        f"export const NCAAF_PROJ_PRIOR = {PRIOR_SEASON};\n"
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
