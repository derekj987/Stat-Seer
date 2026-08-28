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
                                slot[(cname, tname)] = _num(a.get("stat"))
                    for nm, slot in per.items():
                        rec = {
                            "season": season, "homeAway": ha,
                            "pass_yds": slot.get(("passing", "YDS")),
                            "pass_tds": slot.get(("passing", "TD")),
                            "rush_yds": slot.get(("rushing", "YDS")),
                            "rec_yds": slot.get(("receiving", "YDS")),
                            "receptions": slot.get(("receiving", "REC")),
                            "td": (slot.get(("rushing", "TD")) or 0) + (slot.get(("receiving", "TD")) or 0),
                        }
                        e = logs.setdefault(nm, {"team": team, "display": slot["display"], "games": []})
                        e["games"].append(rec)
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


def project(games, market):
    """Line-blind baseline: prior-season per-game average (per-game TD rate for anytime TD)."""
    prior = [g for g in games if g["season"] == PRIOR_SEASON]
    use = prior or games
    vals = series(use, market)
    if not vals:
        return None
    avg = sum(vals) / len(vals)
    if market == "anytime_td":
        return round(100.0 * avg, 1)                          # per-game TD rate as a percent
    return round(avg, 1)


def build(props, key):
    teams = set()
    for p in props:
        teams.add(p["home"]); teams.add(p["away"])
    logs = team_logs(teams, key)

    out, matched, missed = [], 0, 0
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
        if mk == "anytime_td":
            pos = infer_td_pos(games)   # RB / WR / QB from actual usage, not a fixed default
        line = p["line"]
        cO, cG = over_split(games, mk, line, lambda g: True)
        pO, pG = over_split(games, mk, line, lambda g: g["season"] == PRIOR_SEASON)
        hO, hG = over_split(games, mk, line, lambda g: g["homeAway"] == "home")
        rO, rG = over_split(games, mk, line, lambda g: g["homeAway"] == "away")
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

    rows, matched, missed = build(props, key)
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
