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
import math
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict

import numpy as np
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
    "player_pass_tds": ("passing", "pass_tds"),
    "player_anytime_td": ("td", "anytime_td"),
}


def implied_prob(american):
    """American odds -> implied probability (as a percent). Includes the book's margin —
    we only capture the Yes side, so this isn't de-vigged; it's the book's Yes price."""
    try:
        a = float(american)
    except (TypeError, ValueError):
        return None
    p = 100.0 / (a + 100.0) if a > 0 else (-a) / (-a + 100.0)
    return round(100.0 * p, 1)


def build_baselines(prior_seasons):
    """Position efficiency baselines from prior seasons only (YPC, catch rate, YPR, YPA)."""
    frames = []
    for y in prior_seasons:
        s = pd.read_csv(f"data/stats_{y}.csv", low_memory=False)
        frames.append(s[s.season_type == "REG"])
    d = pd.concat(frames, ignore_index=True)
    for c in ["carries", "rushing_yards", "targets", "receptions", "receiving_yards",
              "attempts", "passing_yards", "passing_tds", "rushing_tds", "receiving_tds"]:
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
            # league TD-per-touch rates by position. TD rate barely persists year to year, so
            # we use the league rate (volume x league efficiency), not the player's own rate.
            "tdr": pa.passing_tds.sum() / max(pa.attempts.sum(), 1),        # pass TD / attempt
            "rush_tdr": p.rushing_tds.sum() / max(p.carries.sum(), 1),      # rush TD / carry
            "rec_tdr": p.receiving_tds.sum() / max(p.receptions.sum(), 1),  # rec TD / reception
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


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo root
import odds_client as oc  # noqa: E402 — needs the path insert above

ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_%d.csv"


def current_teams(season):
    """{gsis_id: team} from THIS season's roster.

    `prior_year_rates` reads the player's team off his last game log, which is the team he played
    for LAST season. That is the wrong team for anyone who moved in the offseason, and the
    off-team guard below then drops him as "bad source row" — silently, and for exactly the
    players the books price most. Measured on the 2026 Week 1 board: A.J. Brown (PHI->NE), Mike
    Evans (TB->SF), DJ Moore (CHI->BUF), Geno Smith (LV->NYJ), Kyler Murray (ARI->MIN), Tua
    Tagovailoa (MIA->ATL), Travis Etienne (JAX->NO), David Montgomery (DET->HOU), Michael Pittman
    (IND->PIT), Rico Dowdle (CAR->PIT), Stefon Diggs (NE->WAS) and Jauan Jennings (SF->MIN) all
    had posted lines and no row on the board. The book had them on the right team the whole time;
    we were the ones holding last year's roster.

    Joined on gsis_id (== the `player_id` in the stats files), never on name. Best-effort: if the
    roster can't be fetched we fall back to last season's team, which is the old behaviour."""
    os.makedirs("data", exist_ok=True)
    path = f"data/roster_{season}.csv"
    if not os.path.exists(path):
        try:
            oc.ensure_ssl_certs()
            with urllib.request.urlopen(ROSTER_URL % season, timeout=120) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
        except Exception as e:  # noqa: BLE001 — roster is an improvement, never a hard dependency
            print(f"  WARNING: {season} roster unavailable ({e}); using prior-season teams "
                  f"— players who changed teams will be dropped", file=sys.stderr)
            return {}
    d = pd.read_csv(path, low_memory=False)
    d = d[d.gsis_id.notna()]
    if "status" in d.columns:                      # ACT/RES/... keep the active entry per player
        d = d.sort_values("status", key=lambda s: (s != "ACT").astype(int))
    return dict(zip(d.gsis_id.astype(str), d.team.astype(str)))


CAREER_STAT = {"pass_yds": "passing_yards", "rush_yds": "rushing_yards",
               "rec_yds": "receiving_yards", "receptions": "receptions",
               "pass_tds": "passing_tds"}


def load_career(seasons, home_set=frozenset(), away_set=frozenset()):
    """Every game log we have (REG + POST) per player, for the hit-rate columns. Each row is
    tagged venue "H"/"A"/"?" via the schedule so the hit-rate can be split home vs road."""
    keep = ["player_id", "season", "week", "team", "recent_team", "season_type", "attempts",
            "passing_yards", "rushing_yards", "receiving_yards", "receptions", "passing_tds",
            "rushing_tds", "receiving_tds"]
    frames = []
    for y in seasons:
        s = pd.read_csv(f"data/stats_{y}.csv", low_memory=False)
        frames.append(s[[c for c in keep if c in s.columns]].copy())
    d = pd.concat(frames, ignore_index=True)
    for c in ["attempts", "passing_yards", "rushing_yards", "receiving_yards", "receptions",
              "passing_tds", "rushing_tds", "receiving_tds"]:
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
    if g is None:
        return (0, 0)
    if market == "anytime_td":
        # hit = the player scored (rush or rec TD) that game; the "line" (book prob) is N/A.
        scored = (g["rushing_tds"] + g["receiving_tds"]) >= 1
        return int(scored.sum()), int(len(g))
    if line is None:
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


DEPTH_URL = ("https://github.com/nflverse/nflverse-data/releases/download/"
             "depth_charts/depth_charts_{season}.csv")
# Games of the ROLE's typical volume mixed into a player's own prior-season volume. Measured, not
# picked: predicting each player's actual per-game volume from the season before, n=700
# player-seasons across 2024-25 —
#     prior volume only   MAE 1.609
#     blended, k=8              1.201
#     blended, k=12             1.158   <- used
#     role median only          1.302
# The blend beats BOTH extremes, which is the tell that a player's own history and his current role
# each carry information the other lacks.
ROLE_K = 12.0
# Games of the volume-implied TD probability mixed into a player's own scoring rate. Scoring is the
# one thing that genuinely does not persist (receiving TD r=0.093, CLAUDE.md), so the prior is
# heavy: Brier on 33,861 player-games in 2024-25 was 0.14028 volume-only, 0.13895 at k=40, and
# 0.15160 using the player's own rate alone. Own rate helps a little; trusting it would be worse.
TD_K = 40.0


def current_ranks(season):
    """{gsis_id or norm-name: (pos, rank)} from this season's nflverse depth chart.

    Same source as analysis/depth_export.py. Fetched independently rather than reading the
    generated depthChart.ts, so this does not depend on which script ran first."""
    try:
        oc.ensure_ssl_certs()
        req = urllib.request.Request(DEPTH_URL.format(season=season),
                                     headers={"User-Agent": "statseer-proj/1.0"})
        with urllib.request.urlopen(req, timeout=90) as r:
            d = pd.read_csv(io.StringIO(r.read().decode("utf-8", "replace")), low_memory=False)
    except Exception as e:  # noqa: BLE001 — the correction degrades off rather than failing
        print(f"  WARNING: depth chart unavailable ({e}); volume not role-adjusted", file=sys.stderr)
        return {}
    # Column names are nflverse's, not the obvious ones: the position is `pos_abb` (not
    # `position`) and the name is `player_name` (not `full_name`). Getting this wrong does not
    # raise — it silently matches nothing and returns an empty map, so the whole correction turns
    # itself off while the run still looks successful. Hence the assertion below.
    d = d[pd.to_numeric(d.get("pos_rank"), errors="coerce").notna()]
    d = d[d.get("pos_abb").isin(["QB", "RB", "WR", "TE", "FB"])]
    if "dt" in d.columns:                       # 498k rows = every weekly snapshot; keep the newest
        d = d.sort_values("dt").groupby(["gsis_id", "pos_abb"], as_index=False).last()
    out = {}
    for _, r in d.iterrows():
        pos, rank = str(r["pos_abb"]), int(r["pos_rank"])
        gid = str(r.get("gsis_id") or "")
        for key in (gid if gid and gid != "nan" else None, norm(str(r.get("player_name", "")))):
            if not key:
                continue
            if key not in out or rank < out[key][1]:
                out[key] = (pos, rank)
    if not out:
        print("  WARNING: depth chart parsed to ZERO entries — column names may have changed",
              file=sys.stderr)
    return out


def role_volume(rates, ranks):
    """{(pos, rank): median per-game volume} from the prior season's own players.

    The yardstick for "what does an RB3 actually get" comes from the same data the projections do,
    so it moves with the league instead of being a constant someone has to remember to retune."""
    buckets = {}
    for r in rates.values():
        key = ranks.get(str(r.get("pid"))) or ranks.get(norm(r["name"]))
        if not key:
            continue
        pos, rank = key
        vol = r["carries_pg"] if pos in ("RB", "FB") else r["targets_pg"] if pos in ("WR", "TE") else r["att_pg"]
        buckets.setdefault((pos, rank), []).append(vol)
    return {k: float(np.median(v)) for k, v in buckets.items() if len(v) >= 5}


def apply_role(rates, ranks, rolevol):
    """Blend each player's prior per-game volume toward his CURRENT role's typical volume.

    This is the fix for the most visible defect on the prop board: Jawhar Jordan played 4 games in
    2025 at 10.8 carries and is RB3 now, so projecting his 2025 volume gave a 31.9% anytime-TD
    number against a 7.7% market — while the row beside it read "0 TD in 0/4 games". A typical RB3
    gets 2.7 carries. The projection was not wrong about the arithmetic; it was projecting last
    year's role.

    Line-blind: the role comes from our own depth chart and the yardstick from our own history.
    The book's number is never consulted — only whether a prop EXISTS decides who appears."""
    moved = 0
    for r in rates.values():
        key = ranks.get(str(r.get("pid"))) or ranks.get(norm(r["name"]))
        if not key:
            continue
        pos, rank = key
        target = rolevol.get((pos, rank))
        if target is None:
            continue
        n = max(r.get("games", 0), 0)
        for field, applies in (("carries_pg", pos in ("RB", "FB")),
                               ("targets_pg", pos in ("WR", "TE", "RB")),
                               ("att_pg", pos == "QB")):
            if not applies or field not in r:
                continue
            # Only the volume that DEFINES the role is pulled to the role's median; a running
            # back's targets are pulled toward his own share of it rather than a receiver's.
            t = target if (field == "carries_pg" and pos in ("RB", "FB")) or \
                          (field == "targets_pg" and pos in ("WR", "TE")) or \
                          (field == "att_pg" and pos == "QB") else r[field]
            before = r[field]
            r[field] = (before * n + t * ROLE_K) / (n + ROLE_K)
            if abs(r[field] - before) > 0.5:
                moved += 1
    return moved


# ---- Matchup: how a defence has handled this POSITION (Context, never a projection input) ----
# Replaces the old "better/tougher spot" pill, which was built on envDelta (the change in a team's
# implied total vs the player's prior-season norm). Measured head to head against how much a player
# beat his OWN in-season baseline, 2021-25:
#
#     opponent defence vs position   corr +0.0581
#     envDelta (what we were showing) corr +0.0053   <- no measurable signal
#     the two combined                     +0.0459   <- worse than defence alone
#
# Effect by position, yards vs the player's own baseline:
#     RB   bad -1.42 | toss-up +1.47 | good +5.61      (the real one)
#     TE   bad -0.03 | toss-up +1.71 | good +3.58
#     WR   bad -1.38 | toss-up -0.43 | good +1.00      (weak)
#
# Small, honest, and Context ONLY: it is not folded into the projection and it is not an edge
# claim. A ~5-yard tilt for a running back is worth knowing and nowhere near worth betting alone.
MATCHUP_LO, MATCHUP_HI = 0.94, 1.06   # terciles of defence-allowed relative to league average


def defence_by_position(season):
    """{(team, pos): allowed-per-game relative to league average} from the most recent completed
    season. >1 means that defence gave up MORE than average to that position.

    Prior season rather than season-to-date because this runs before Week 1; once the season is
    under way the same shape can be recomputed from games played so far."""
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return {}
    s = pd.read_csv(path, low_memory=False)
    s = s[(s.season_type == "REG") & s.position.isin(["RB", "WR", "TE"])].copy()
    if "opponent_team" not in s.columns:
        return {}
    for c in ("rushing_yards", "receiving_yards"):
        s[c] = pd.to_numeric(s.get(c), errors="coerce").fillna(0.0)
    s["prod"] = np.where(s.position == "RB", s.rushing_yards, s.receiving_yards)
    out = {}
    for pos, grp in s.groupby("position"):
        per = grp.groupby(["opponent_team", "week"], as_index=False)["prod"].sum()
        allowed = per.groupby("opponent_team")["prod"].mean()
        lg = allowed.mean()
        if lg <= 0:
            continue
        for team, v in allowed.items():
            out[(str(team), str(pos))] = float(v / lg)
    return out


def matchup_tag(defmap, opponent, pos):
    """'good' | 'toss' | 'bad' for this player against this opponent, or None when unknown.

    QBs are deliberately excluded: the measurement covered RB/WR/TE, and a passing matchup is a
    different quantity that has not been tested here. Showing a tag we have not measured would be
    the same mistake as the env pill this replaces."""
    rel = defmap.get((str(opponent), str(pos)))
    if rel is None:
        return None
    return "good" if rel >= MATCHUP_HI else "bad" if rel <= MATCHUP_LO else "toss"


def project(rate, base):
    b = base.get(rate["pos"], base["WR"])
    # Passing: volume x the QB's own YPA regressed toward the starter league YPA. Using pure
    # league YPA underrated every starting QB (they're an above-average sample) -> all "unders".
    pa = rate.get("pass_att", 0.0)
    reg_ypa = (rate.get("pass_ypa", b["ypa"]) * pa + b["ypa"] * PASS_K) / (pa + PASS_K)
    # Anytime TD: expected TDs this game = projected carries x league rush-TD/carry +
    # projected receptions x league rec-TD/reception, then P(>=1 TD) = 1 - e^-lambda
    # (Poisson). League TD-per-touch rates (scoring doesn't persist), so the signal is who
    # gets the VOLUME near league scoring rates — not a goal-line-role guess we can't see.
    rec_pg = rate["targets_pg"] * b["catch"]
    lam = rate["carries_pg"] * b.get("rush_tdr", 0.0) + rec_pg * b.get("rec_tdr", 0.0)
    return {
        "rush_yds": round(rate["carries_pg"] * b["ypc"], 1),
        "rec_yds": round(rate["targets_pg"] * b["catch"] * b["ypr"], 1),
        "receptions": round(rate["targets_pg"] * b["catch"], 1),
        "pass_yds": round(rate["att_pg"] * reg_ypa, 1),
        # Passing TDs: projected attempts x the LEAGUE starter TD-per-attempt rate. Unlike
        # YPA, a QB's TD rate doesn't persist, so we don't credit his own rate — this lands
        # near the book line by design (scoring is not where a projection edge lives).
        "pass_tds": round(rate["att_pg"] * b.get("tdr", 0.0), 2),
        # anytime-TD probability, as a percent. Blended with the player's OWN scoring rate in
        # main() — see TD_K. Kept raw here so `project` stays a pure volume x efficiency function.
        "anytime_td": round(100.0 * (1.0 - math.exp(-lam)), 1),
    }


# ---- Forward-looking scoring environment (Context, not a projection driver) ----
# A team's implied total (the Vegas game total split by the spread) is how much scoring the
# market expects from its offense. We deliberately DON'T fold it into the projection: tested on
# 2021-24, adding the raw implied total barely beats the backward baseline out of sample (0.7%),
# and it isn't graded against the closing PROP line yet. But the CHANGE vs a player's own prior
# environment is a real, directional signal (residual corr +0.15; a "much better" spot beat the
# backward projection by ~+6 yds, "much worse" by ~-22) — it flags where our backward number is
# most likely stale (a new/improved, or worsened, spot). Emitted as Context only.
_ENV_ALIAS = {"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}
def _env_team(t): return _ENV_ALIAS.get(str(t), str(t))


def spread_sign(g):
    """nflverse spread_line sign: +1 if a positive spread_line means the HOME team is favored."""
    d = g[g.season >= 2020].dropna(subset=["spread_line", "home_score", "away_score"])
    if len(d) < 50:
        return 1.0
    return 1.0 if np.polyfit(d.spread_line, d.home_score - d.away_score, 1)[0] > 0 else -1.0


def season_implied(g, season, sign):
    """{(week, team): implied team total} for a season, from the Vegas game total + spread."""
    s = g[g.season == season].dropna(subset=["spread_line", "total_line"]).copy()
    s["ehm"] = sign * s["spread_line"]
    m = {}
    for _, r in s.iterrows():
        wk = pd.to_numeric(r["week"], errors="coerce")
        if pd.isna(wk):
            continue
        wk = int(wk)
        m[(wk, _env_team(r["home_team"]))] = float(r["total_line"]) / 2 + float(r["ehm"]) / 2
        m[(wk, _env_team(r["away_team"]))] = float(r["total_line"]) / 2 - float(r["ehm"]) / 2
    return m


def player_env_baseline(prior_season, prev_implied):
    """{player_id: mean prior-season implied team total} over the games the player appeared in —
    the scoring environment the backward projection is anchored to."""
    s = pd.read_csv(f"data/stats_{prior_season}.csv", low_memory=False)
    s = s[s.season_type == "REG"].copy()
    if "team" not in s.columns:
        s["team"] = s.get("recent_team", "")
    elif "recent_team" in s.columns:
        s["team"] = s["team"].fillna(s["recent_team"])
    base = {}
    for pid, grp in s.groupby("player_id"):
        vals = [prev_implied.get((int(w), _env_team(t)))
                for w, t in zip(pd.to_numeric(grp.week, errors="coerce"), grp.team) if not pd.isna(w)]
        vals = [v for v in vals if v is not None]
        if vals:
            base[pid] = float(np.mean(vals))
    return base


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
    # Re-tag every player with the team he is on NOW. His USAGE still comes from last season (that
    # is the projection); only the team label changes, which is what the off-team guard and the
    # scoring-environment lookup key off. See current_teams().
    cur_team = current_teams(args.season)
    moved = 0
    for r in rates.values():
        t = cur_team.get(str(r["pid"]))
        if t and t != r["team"]:
            r["team"] = t
            moved += 1
    print(f"  re-tagged {moved} players to their {args.season} team "
          f"({len(cur_team)} on the roster)")
    # Blend prior-season volume toward the player's CURRENT depth role. Without this the board
    # projects last year's usage: a former starter now third on the chart keeps a starter's number.
    _ranks = current_ranks(args.season)
    if _ranks:
        _rolevol = role_volume(rates, _ranks)
        _moved = apply_role(rates, _ranks, _rolevol)
        print(f"  role-adjusted volume for {_moved} player-fields "
              f"({len(_ranks)} on the depth chart, {len(_rolevol)} role baselines)")
    career = load_career(range(2016, args.season), *load_venue_sets())   # all game logs, venue-tagged

    # Forward scoring-environment context (Context flag, NOT a projection input). Degrades to
    # empty if the schedule/lines aren't available, so it can never block a projection.
    cur_env, env_base = {}, {}
    try:
        _g = pd.read_csv(GAMES_LOCAL, low_memory=False)
        _sign = spread_sign(_g)
        cur_env = season_implied(_g, args.season, _sign)              # this season's slate
        env_base = player_env_baseline(prior, season_implied(_g, prior, _sign))
    except Exception as e:  # noqa: BLE001 — env is optional context
        print(f"  env context unavailable ({e}); envDelta skipped", file=sys.stderr)

    # Opponent defence vs position, for the Context matchup tag. Prior season, since this runs
    # before Week 1. See defence_by_position().
    defmap = defence_by_position(prior)
    print(f"  matchup: {len(defmap)} team-position defence rates from {prior}")

    # median book line per (player, market) across books, for the yardage/reception markets
    ALIAS = {"LAR": "LA", "LAC": "LAC", "WSH": "WAS", "OAK": "LV", "SD": "LAC"}
    def team_norm(t): return ALIAS.get(t, t)
    lines = defaultdict(list)   # (player, market) -> [line]  (implied % for anytime_td)
    meta = {}                   # player -> (game, commence, {teams})
    for r in props:
        if r["market"] not in MARKET_MAP:
            continue
        if r["market"] == "player_anytime_td":
            ip = implied_prob(r["price_american"])   # Yes-side odds -> implied % (the "book")
            if ip is None:
                continue
            lines[(r["player_name"], r["market"])].append(ip)
        elif r["line"] is not None:
            lines[(r["player_name"], r["market"])].append(float(r["line"]))
        else:
            continue
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
        if key == "anytime_td" and cgames:
            # Blend the volume-implied probability with the player's OWN scoring rate over the
            # same history the row displays. Without this the board could print "0 TD in 41 games"
            # beside a 10.5% projection — a contradiction on one line. TD_K is heavy because
            # scoring genuinely does not persist; own rate alone scores WORSE (Brier .1516 vs
            # .1403 volume-only), so this nudges rather than overrides.
            proj = round((100.0 * cover + proj * TD_K) / (cgames + TD_K), 1)
        pover, pgames = prior_over(career, rate["pid"], key, book, prior)
        hOver, hG, rOver, rG = home_road_over(career, rate["pid"], key, book)
        # Forward scoring-environment change vs the player's prior-season norm (Context flag).
        _ce = cur_env.get((week, team_norm(rate["team"])))
        _eb = env_base.get(rate["pid"])
        env_delta = round(_ce - _eb, 1) if (_ce is not None and _eb is not None) else None
        matched += 1
        out.append({
            "game": game, "commence": commence, "player": rate["name"], "team": rate["team"],
            "pos": rate["pos"], "cat": cat, "market": key, "book": book, "proj": proj,
            "g": rate["games"], "cOver": cover, "cG": cgames, "pOver": pover, "pG": pgames,
            "hOver": hOver, "hG": hG, "rOver": rOver, "rG": rG,
            "env": round(_ce, 1) if _ce is not None else None, "envDelta": env_delta,
            # Context: how this opponent has handled this position. RB/WR/TE only — a passing
            # matchup is a different quantity and has not been measured, so QBs get no tag.
            "matchup": matchup_tag(defmap, (teams - {team_norm(rate["team"])} or {None}).pop(),
                                   rate["pos"]),
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
    ts += "  pos: string; cat: string; market: string; book: number | null; proj: number; g: number;\n"
    ts += "  cOver: number; cG: number; pOver: number; pG: number;\n"
    ts += "  hOver: number; hG: number; rOver: number; rG: number;\n"
    ts += "  env?: number | null; envDelta?: number | null;\n"
    # 'good' | 'toss' | 'bad' — how this opponent has handled this position. Context only, and
    # RB/WR/TE only: a passing matchup is a different quantity that has not been measured.
    ts += "  matchup?: 'good' | 'toss' | 'bad' | null }\n"
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
