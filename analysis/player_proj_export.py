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
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict

import pandas as pd

GAMES_LOCAL = "data/games.csv"
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"


def load_venue_sets():
    """(season, week, team) sets for HOME and AWAY games, from the nflverse schedule, so a
    career game log can be split by venue for the home/road hit-rate columns. Degrades to
    empty (no split) if the schedule can't be loaded."""
    try:
        if os.path.exists(GAMES_LOCAL):
            g = pd.read_csv(GAMES_LOCAL, low_memory=False)
        else:
            req = urllib.request.Request(GAMES_URL, headers={"User-Agent": "statseer/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                g = pd.read_csv(io.StringIO(r.read().decode("utf-8", "replace")), low_memory=False)
    except Exception as e:  # noqa: BLE001 — degrade to no venue split
        print(f"  games.csv unavailable ({e}); home/road split skipped", file=sys.stderr)
        return set(), set()
    g = g.dropna(subset=["season", "week", "home_team", "away_team"])
    wk = pd.to_numeric(g["week"], errors="coerce")
    g = g[wk.notna()]
    s = g["season"].astype(int)
    w = pd.to_numeric(g["week"]).astype(int)
    home = set(zip(s, w, g["home_team"].astype(str)))
    away = set(zip(s, w, g["away_team"].astype(str)))
    return home, away

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
        # Transient-retry: a Supabase 5xx / network blip is retried with backoff; a
        # persistent failure or a genuine 4xx raises so a real outage still surfaces.
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    page = json.loads(r.read())
                break
            except (urllib.error.URLError, urllib.error.HTTPError) as e:
                code = getattr(e, "code", None)
                if (code and code < 500) or attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
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
    "player_pass_tds": ("td", "pass_tds"),
}


def build_baselines(prior_seasons):
    """Position efficiency baselines from prior seasons only (YPC, catch rate, YPR, YPA)."""
    frames = []
    for y in prior_seasons:
        s = pd.read_csv(f"data/stats_{y}.csv", low_memory=False)
        frames.append(s[s.season_type == "REG"])
    d = pd.concat(frames, ignore_index=True)
    for c in ["carries", "rushing_yards", "targets", "receptions", "receiving_yards",
              "attempts", "passing_yards", "passing_tds"]:
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0.0)
    base = {}
    for pos in ["RB", "FB", "WR", "TE", "QB"]:
        p = d[d.position == pos]
        pa = p[p.attempts >= 15]   # starter games only, for a fair passing-YPA / TD-rate baseline
        base[pos] = {
            "ypc": p.rushing_yards.sum() / max(p.carries.sum(), 1),
            "catch": p.receptions.sum() / max(p.targets.sum(), 1),
            "ypr": p.receiving_yards.sum() / max(p.receptions.sum(), 1),
            "ypa": pa.passing_yards.sum() / max(pa.attempts.sum(), 1),
            # league passing-TD-per-attempt. TD rate barely persists year to year, so we use
            # the league starter rate (volume x league efficiency), not the QB's own rate.
            "tdr": pa.passing_tds.sum() / max(pa.attempts.sum(), 1),
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
            "pid": row.player_id,
            "carries_pg": g.carries.sum() / n, "targets_pg": g.targets.sum() / n,
            "att_pg": g.attempts.sum() / n,
            "pass_att": g.attempts.sum(), "pass_ypa": g.passing_yards.sum() / max(g.attempts.sum(), 1),
        }
    return rates


CAREER_STAT = {"pass_yds": "passing_yards", "rush_yds": "rushing_yards",
               "rec_yds": "receiving_yards", "receptions": "receptions",
               "pass_tds": "passing_tds"}


def load_career(seasons, home_set=frozenset(), away_set=frozenset()):
    """Every game log we have (REG + POST) per player, for the hit-rate columns. Each row is
    tagged venue "H"/"A"/"?" via the schedule so the hit-rate can be split home vs road."""
    keep = ["player_id", "season", "week", "team", "recent_team", "season_type", "attempts",
            "passing_yards", "rushing_yards", "receiving_yards", "receptions", "passing_tds"]
    frames = []
    for y in seasons:
        s = pd.read_csv(f"data/stats_{y}.csv", low_memory=False)
        frames.append(s[[c for c in keep if c in s.columns]].copy())
    d = pd.concat(frames, ignore_index=True)
    for c in ["attempts", "passing_yards", "rushing_yards", "receiving_yards", "receptions", "passing_tds"]:
        d[c] = pd.to_numeric(d.get(c), errors="coerce").fillna(0.0)
    # unify the team column (older releases used recent_team)
    if "team" not in d.columns:
        d["team"] = d.get("recent_team", "")
    elif "recent_team" in d.columns:
        d["team"] = d["team"].fillna(d["recent_team"])
    if (home_set or away_set) and "week" in d.columns:
        wk = pd.to_numeric(d["week"], errors="coerce").fillna(-1).astype(int)
        key = list(zip(d["season"].astype(int), wk, d["team"].astype(str)))
        d["venue"] = ["H" if k in home_set else ("A" if k in away_set else "?") for k in key]
    else:
        d["venue"] = "?"
    return {pid: g for pid, g in d.groupby("player_id")}


def _over(g, market, line):
    if g is None or line is None:
        return (0, 0)
    if market in ("pass_yds", "pass_tds"):
        g = g[g.attempts >= 1]      # only games he actually threw
    vals = g[CAREER_STAT[market]]
    return int((vals > line).sum()), int(len(vals))


def career_over(career_by_pid, pid, market, line):
    """(times over, games) across every game we have — the full career hit-rate."""
    return _over(career_by_pid.get(pid), market, line)


def prior_over(career_by_pid, pid, market, line, prior):
    """(times over, games) in the prior season only — reflects the player's CURRENT role."""
    g = career_by_pid.get(pid)
    return _over(g[g.season == prior] if g is not None else None, market, line)


def home_road_over(career_by_pid, pid, market, line):
    """(home_over, home_games, road_over, road_games) across the career — how often the
    player cleared this line at home vs on the road."""
    g = career_by_pid.get(pid)
    if g is None or "venue" not in g.columns:
        return (0, 0, 0, 0)
    ho, hg = _over(g[g.venue == "H"], market, line)
    ao, ag = _over(g[g.venue == "A"], market, line)
    return (ho, hg, ao, ag)


PASS_K = 300.0   # QB YPA persists (unlike RB/WR efficiency), so we regress the player's OWN
                 # YPA toward the starter baseline by ~300 attempts, not strip it to league avg.


def project(rate, base):
    b = base.get(rate["pos"], base["WR"])
    # Passing: volume x the QB's own YPA regressed toward the starter league YPA. Using pure
    # league YPA underrated every starting QB (they're an above-average sample) -> all "unders".
    pa = rate.get("pass_att", 0.0)
    reg_ypa = (rate.get("pass_ypa", b["ypa"]) * pa + b["ypa"] * PASS_K) / (pa + PASS_K)
    return {
        "rush_yds": round(rate["carries_pg"] * b["ypc"], 1),
        "rec_yds": round(rate["targets_pg"] * b["catch"] * b["ypr"], 1),
        "receptions": round(rate["targets_pg"] * b["catch"], 1),
        "pass_yds": round(rate["att_pg"] * reg_ypa, 1),
        # Passing TDs: projected attempts x the LEAGUE starter TD-per-attempt rate. Unlike
        # YPA, a QB's TD rate doesn't persist, so we don't credit his own rate — this lands
        # near the book line by design (scoring is not where a projection edge lives).
        "pass_tds": round(rate["att_pg"] * b.get("tdr", 0.0), 2),
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
    career = load_career(range(2016, args.season), *load_venue_sets())   # all game logs, venue-tagged

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
        cover, cgames = career_over(career, rate["pid"], key, book)
        pover, pgames = prior_over(career, rate["pid"], key, book, prior)
        hOver, hG, rOver, rG = home_road_over(career, rate["pid"], key, book)
        matched += 1
        out.append({
            "game": game, "commence": commence, "player": rate["name"], "team": rate["team"],
            "pos": rate["pos"], "cat": cat, "market": key, "book": book, "proj": proj,
            "g": rate["games"], "cOver": cover, "cG": cgames, "pOver": pover, "pG": pgames,
            "hOver": hOver, "hG": hG, "rOver": rOver, "rG": rG,
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
    ts += "  pos: string; cat: string; market: string; book: number; proj: number; g: number;\n"
    ts += "  cOver: number; cG: number; pOver: number; pG: number;\n"
    ts += "  hOver: number; hG: number; rOver: number; rG: number }\n"
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
