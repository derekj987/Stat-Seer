"""
Player Prop Model — first-pass projections for the games that already have book props.

PRESEASON REALITY: it's before Week 1, so there is no 2026 in-season usage. These are
PRIOR-SEASON BASELINE projections (volume x regressed efficiency, prior seasons only) —
exactly the honest Week-1 estimate. We project VOLUME from last season's per-game rate and
multiply by a POSITION efficiency baseline (never the player's own recent efficiency).

Reads the posted props from Supabase (prop_snapshots), matches players to nflverse stats,
projects the markets books have up, and writes web/lib/player-projections.json.

    python analysis/player_proj_export.py --probe   # just list the posted players
    python analysis/player_proj_export.py            # build + write the JSON
"""
import argparse
import json
import os
import sys
import urllib.request
from collections import defaultdict

import pandas as pd

try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except Exception:
    pass


def load_env(path=".env"):
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def pg(query):
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_KEY"]
    out, PAGE = [], 1000
    for off in range(0, 100000, PAGE):
        req = urllib.request.Request(
            f"{url}/rest/v1/prop_snapshots{query}",
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Range": f"{off}-{off+PAGE-1}", "Range-Unit": "items"})
        with urllib.request.urlopen(req, timeout=60) as r:
            page = json.loads(r.read())
        out += page
        if len(page) < PAGE:
            break
    return out


def latest_week(season):
    rows = pg(f"?season=eq.{season}&select=week&order=week.desc&limit=1")
    return rows[0]["week"] if rows else 1


def fetch_props(season, week):
    cols = "event_id,commence_time,home_team,away_team,book,market,player_name,side,line,price_american,snapshot_at"
    rows = pg(f"?season=eq.{season}&week=eq.{week}&event_id=neq.test&select={cols}&order=snapshot_at.desc")
    # keep the latest snapshot per (event,market,player,side,line,book)
    latest = {}
    for r in rows:
        k = (r["event_id"], r["market"], r["player_name"], r["side"], r["line"], r["book"])
        if k not in latest or r["snapshot_at"] > latest[k]["snapshot_at"]:
            latest[k] = r
    return list(latest.values())


import re
import statistics

SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b\.?", re.I)


def norm(name):
    n = name.lower().replace(".", "").replace("'", "").replace("-", " ")
    n = SUFFIX.sub("", n)
    return " ".join(n.split())


# market -> (category, projection key)
MARKET_MAP = {
    "player_rush_yds": ("rushing", "rush_yds"),
    "player_reception_yds": ("receiving", "rec_yds"),
    "player_receptions": ("receptions", "receptions"),
    "player_pass_yds": ("passing", "pass_yds"),
}


def build_baselines(prior_seasons):
    """Position efficiency baselines from prior seasons only (YPC, catch rate, YPR, YPA)."""
    frames = []
    for y in prior_seasons:
        s = pd.read_csv(f"data/stats_{y}.csv", low_memory=False)
        frames.append(s[s.season_type == "REG"])
    d = pd.concat(frames, ignore_index=True)
    for c in ["carries", "rushing_yards", "targets", "receptions", "receiving_yards", "attempts", "passing_yards"]:
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0.0)
    base = {}
    for pos in ["RB", "FB", "WR", "TE", "QB"]:
        p = d[d.position == pos]
        base[pos] = {
            "ypc": p.rushing_yards.sum() / max(p.carries.sum(), 1),
            "catch": p.receptions.sum() / max(p.targets.sum(), 1),
            "ypr": p.receiving_yards.sum() / max(p.receptions.sum(), 1),
            "ypa": p.passing_yards.sum() / max(p.attempts.sum(), 1),
        }
    return base


def prior_year_rates(prior):
    """Per-player per-game volume from the single prior season (their own usage rate)."""
    s = pd.read_csv(f"data/stats_{prior}.csv", low_memory=False)
    s = s[s.season_type == "REG"].copy()
    for c in ["carries", "targets", "receptions", "attempts", "rushing_yards", "receiving_yards", "passing_yards"]:
        s[c] = pd.to_numeric(s.get(c), errors="coerce").fillna(0.0)
    rates = {}
    for pid, g in s.groupby("player_id"):
        n = g.week.nunique()
        if n == 0:
            continue
        row = g.iloc[-1]
        rates[norm(str(row.player_display_name))] = {
            "name": row.player_display_name, "pos": row.position, "team": row.team, "games": int(n),
            "carries_pg": g.carries.sum() / n, "targets_pg": g.targets.sum() / n,
            "att_pg": g.attempts.sum() / n,
        }
    return rates


def project(rate, base):
    b = base.get(rate["pos"], base["WR"])
    return {
        "rush_yds": round(rate["carries_pg"] * b["ypc"], 1),
        "rec_yds": round(rate["targets_pg"] * b["catch"] * b["ypr"], 1),
        "receptions": round(rate["targets_pg"] * b["catch"], 1),
        "pass_yds": round(rate["att_pg"] * b["ypa"], 1),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--out", default="web/lib/playerProjections.ts")
    args = ap.parse_args()

    load_env()
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_KEY"):
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env", file=sys.stderr)
        sys.exit(1)

    week = latest_week(args.season)
    props = fetch_props(args.season, week)
    print(f"season={args.season} week={week}: {len(props)} prop quotes")

    if args.probe:
        by_game = defaultdict(lambda: defaultdict(set))
        games = {}
        for r in props:
            g = f'{r["away_team"]} @ {r["home_team"]}'
            games[g] = r["commence_time"]
            by_game[g][r["player_name"]].add(r["market"])
        for g in sorted(by_game, key=lambda x: games[x]):
            print(f"\n  {g} — {len(by_game[g])} players")
        return

    prior = args.season - 1
    base = build_baselines(range(args.season - 3, args.season))   # e.g. 2023-2025
    rates = prior_year_rates(prior)

    # median book line per (player, market) across books, for the yardage/reception markets
    ALIAS = {"LAR": "LA", "LAC": "LAC", "WSH": "WAS", "OAK": "LV", "SD": "LAC"}
    def team_norm(t): return ALIAS.get(t, t)
    lines = defaultdict(list)   # (player, market) -> [line]
    meta = {}                   # player -> (game, commence, {teams})
    for r in props:
        if r["market"] not in MARKET_MAP or r["line"] is None:
            continue
        lines[(r["player_name"], r["market"])].append(float(r["line"]))
        teams = {team_norm(r["away_team"]), team_norm(r["home_team"])}
        meta[r["player_name"]] = (f'{r["away_team"]} @ {r["home_team"]}', r["commence_time"], teams)

    out, matched, unmatched, offteam = [], 0, [], []
    for (player, market), ls in sorted(lines.items()):
        cat, key = MARKET_MAP[market]
        rate = rates.get(norm(player))
        game, commence, teams = meta[player]
        book = round(statistics.median(ls), 1)
        if not rate:
            unmatched.append(player)
            continue
        # Data-hygiene guard: the source occasionally attaches an out-of-game player to an
        # event (preseason odds noise). Keep only players whose prior-season team is in the game.
        if team_norm(rate["team"]) not in teams:
            offteam.append(f'{player} ({rate["team"]} not in {teams})')
            continue
        proj = project(rate, base)[key]
        matched += 1
        out.append({
            "game": game, "commence": commence, "player": rate["name"], "team": rate["team"],
            "pos": rate["pos"], "cat": cat, "market": key, "book": book, "proj": proj,
            "g": rate["games"],
        })

    out.sort(key=lambda r: (r["commence"], r["game"], r["cat"], -(r["proj"] or 0)))
    print(f"matched {matched} player-markets; {len(set(unmatched))} unmatched (rookies/no 2025); "
          f"{len(set(offteam))} dropped as off-team (moved or bad source row)")
    for x in sorted(set(offteam))[:20]:
        print("   off-team:", x)

    ts = "// AUTO-GENERATED by analysis/player_proj_export.py — do not edit by hand.\n"
    ts += "// Prior-season (%d) baseline projections: volume x position efficiency. PRESEASON —\n" % prior
    ts += "// not graded against closing lines yet.\n"
    ts += "export interface PlayerProj { game: string; commence: string; player: string; team: string;\n"
    ts += "  pos: string; cat: string; market: string; book: number; proj: number; g: number }\n"
    ts += f"export const PROJ_SEASON = {args.season};\nexport const PROJ_WEEK = {week};\nexport const PROJ_PRIOR = {prior};\n"
    ts += "export const PLAYER_PROJECTIONS: PlayerProj[] = [\n"
    for r in out:
        ts += "  " + json.dumps(r) + ",\n"
    ts += "];\n"
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"wrote {len(out)} rows -> {args.out}")


if __name__ == "__main__":
    main()
