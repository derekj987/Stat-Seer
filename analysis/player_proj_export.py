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
import datetime as dt
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


class TransientRead(Exception):
    """Supabase kept answering 5xx through the retries. Upstream, not ours: the run is skipped
    (exit 0) and the next scheduled run — 6 hours later — regenerates. Two runs died this way on
    2026-09-14/15, both while the in-play capture sweeps were writing (18:21 and 01:10 UTC), each
    with a full traceback and a failure email for an outage that cleared within minutes. A 4xx
    (bad key, quota) still raises and still emails: that is a break on our side."""


def pg(query):
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_KEY"]
    out, PAGE = [], 1000
    for off in range(0, 100000, PAGE):
        req = urllib.request.Request(
            f"{url}/rest/v1/prop_snapshots{query}",
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Range": f"{off}-{off+PAGE-1}", "Range-Unit": "items"})
        # Transient-retry: a Supabase 5xx / network blip is retried with backoff (5s, 15s, 45s —
        # the old 2s/4s never outlasted a real blip); a genuine 4xx raises so a break on our side
        # still surfaces; a 5xx that outlasts the retries becomes TransientRead (skip the run).
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    page = json.loads(r.read())
                break
            except (urllib.error.URLError, urllib.error.HTTPError) as e:
                code = getattr(e, "code", None)
                if code and code < 500:
                    raise
                if attempt == 3:
                    raise TransientRead(f"Supabase {code or 'network'} persisted through 4 attempts: {e}")
                time.sleep(5 * 3 ** attempt)
        out += page
        if len(page) < PAGE:
            break
    return out


def latest_week(season):
    rows = pg(f"?season=eq.{season}&select=week&order=week.desc&limit=1")
    return rows[0]["week"] if rows else 1


def fetch_props(season, week):
    """The CURRENT board: only rows from the most recent capture of each event.

    The dedupe used to key on (event, market, player, side, LINE, book) and keep the newest row
    for each. Because the line is part of the key, a line a book has since moved off never expires
    — so the "current" set accumulated every line ever posted. Sam Darnold's passing yards carried
    22 distinct lines from 197.5 to 258.5, and the median across that pile came out 230.5 while
    every book actually on screen was at 228.5-229.5. Derek spotted it against FanDuel.

    `collected_at` is the true capture time (`snapshot_at` is the sweep key and equals kickoff on
    legacy rows, so max() on it picks the latest GAME, not the latest capture — a trap that has
    now cost two separate investigations). Keeping only the newest capture per event is what makes
    the board show what the books show right now."""
    cols = ("event_id,commence_time,home_team,away_team,book,market,player_name,side,line,"
            "price_american,snapshot_at,collected_at")
    rows = pg(f"?season=eq.{season}&week=eq.{week}&event_id=neq.test&select={cols}&order=snapshot_at.desc")
    # A sweep writes its rows in batches, each with its own collected_at, so "the newest capture"
    # is a WINDOW, not an equality test. Matching exactly kept only the final batch and cut the
    # slate from 16,901 quotes to 3,753 — a filter can be too sharp as easily as too blunt.
    # SWEEP_WINDOW comfortably spans one sweep and is far short of the 3-6h gap to the next.
    SWEEP_WINDOW = dt.timedelta(hours=1)
    def when(r):
        try:
            return dt.datetime.fromisoformat((r.get("collected_at") or "").replace("Z", "+00:00"))
        except ValueError:
            return None
    # PREGAME rows only. The books keep pricing a prop after kickoff — a LIVE line that tracks the
    # game — and the 6-hourly sweep captured it: Jalen Coker, priced at 37.5 receiving yards
    # before the Panthers kicked off, was captured at 130.5 three hours in (he finished with 138),
    # and 130.5 is what the board published as "the market". Derek: "I know Jalen Coker's market
    # receiving yards is not 130.5." A row captured at or after the game's start is not a market
    # line for the game; for a played game the newest PREGAME sweep is its close, which is the
    # number the report card grades against.
    def kick(r):
        try:
            return dt.datetime.fromisoformat((r.get("commence_time") or "").replace("Z", "+00:00"))
        except ValueError:
            return None
    n_all = len(rows)
    rows = [r for r in rows if (t := when(r)) is None or (k := kick(r)) is None or t < k]
    if n_all - len(rows):
        print(f"  dropped {n_all - len(rows):,} in-play prop rows (captured after kickoff)")
    newest = {}
    for r in rows:
        t = when(r)
        if t and (r["event_id"] not in newest or t > newest[r["event_id"]]):
            newest[r["event_id"]] = t
    cur = [r for r in rows
           if (t := when(r)) is not None and r["event_id"] in newest
           and newest[r["event_id"]] - t <= SWEEP_WINDOW]
    if not cur:                       # no usable collected_at (very old rows) — fall back
        cur = rows
    # Within one capture a book still posts each (side, line) once; dedupe defensively.
    latest = {}
    for r in cur:
        if r["book"] not in US_BOOKS:             # offshore books are captured, never shown
            continue
        latest[(r["event_id"], r["market"], r["player_name"], r["side"], r["line"], r["book"])] = r
    return list(latest.values())


import re

# The books a member can see — US-licensed only. The feed's "us" region also returns bovada,
# betonlineag, lowvig, mybookieag and betus; the board's fallback line (when FanDuel has no
# number) must never come from one of those. Mirror of web/lib/bookLabel.ts US_BOOKS.
US_BOOKS = {"draftkings", "fanduel", "betmgm", "williamhill_us", "fanatics", "betrivers",
            "espnbet", "hardrockbet", "ballybet", "betparx"}
import statistics

SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b\.?", re.I)


def norm(name):
    n = name.lower().replace(".", "").replace("'", "").replace("-", " ")
    n = SUFFIX.sub("", n)
    return " ".join(n.split())


# Market SIDES the books list as if they were players. "No Scorer" is a bet on nobody scoring and
# a team defence is not a person; both arrive in `player_name` and would otherwise become rows now
# that a priced name is no longer required to match a roster. "No Scorer" is priced in all 16
# games, which is the tell — a player appears in one.
NOT_A_PLAYER = re.compile(r"(d/?st|defense|no (scorer|touchdown)|test player)", re.I)


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
        # A QB's per-game passing volume counts games he PLAYED QUARTERBACK, not games he was
        # active. Derek: "we have no QBs going over on their TD pass projections."
        #
        # The two halves of the projection were measured on different populations. `tdr` and `ypa`
        # in build_baselines are computed over STARTS ONLY (`attempts >= 15`) — deliberately, so
        # relief cameos do not distort the rate — while this per-player volume was averaged over
        # every appearance, cameos included. Multiplying a starter rate by an all-games volume
        # understates every quarterback.
        #
        # Measured on 2025, 37 QBs with 6+ starts: 29.81 attempts per game over all appearances
        # against 31.61 over starts — 6% low on average, and far worse for anyone who split a
        # season (Mac Jones 26.3 vs 36.1, Joe Flacco 32.0 vs 41.0). Downstream that put our median
        # passing-TD projection at 1.35 against a 1.5 line, so 3 of 31 QBs projected over while
        # those same players had cleared that line in 49% of their own career games. The formula
        # itself was fine: 31.5 league attempts x 0.0469 TD/attempt = 1.48, which is exactly the
        # measured league mean of 1.477. Only the input was wrong.
        #
        # The general rule: THE DENOMINATOR OF A PER-GAME RATE MUST MATCH THE POPULATION THE
        # EFFICIENCY BASELINE WAS MEASURED ON. Rushing and receiving are unaffected — a back who
        # plays every week at low volume genuinely is low volume, and there is no "start" filter
        # on their baselines to disagree with.
        starts = g[g.attempts >= 15]
        ns = starts.week.nunique()
        att_pg = (starts.attempts.sum() / ns) if ns else (g.attempts.sum() / n)
        rates[norm(str(row.player_display_name))] = {
            "name": row.player_display_name, "pos": row.position, "team": row.team, "games": int(n),
            "pid": row.player_id,
            "carries_pg": g.carries.sum() / n, "targets_pg": g.targets.sum() / n,
            "att_pg": att_pg,
            "qb_starts": int(ns),
            "pass_att": g.attempts.sum(), "pass_ypa": g.passing_yards.sum() / max(g.attempts.sum(), 1),
            # The player's OWN receiving efficiency last season, kept raw so `project` can regress
            # it toward the league by REC_YPT_K. See that constant for why receivers get this and
            # running backs do not.
            "prev_tgt": float(g.targets.sum()), "prev_rec_yds": float(g.receiving_yards.sum()),
            "prev_car": float(g.carries.sum()), "prev_rush_yds": float(g.rushing_yards.sum()),
        }
    return rates


# Weight of the PRIOR season's per-game volume, in games of THIS season, when blending in the
# games a player has actually played this year:
#
#     volume_pg = (n * this_season_pg + CUR_K * prior_season_pg) / (n + CUR_K)
#
# The projections used to be prior-season volume only, all season long — so after Week 1 a back
# who had just carried 20 times as the new starter was still projected on last year's 6. Volume is
# the persistent thing (carries r=0.678, target share 0.623), and this season's usage is the
# freshest read of it. Measured on 2023-2025, predicting each player's NEXT game's volume from his
# prior-season mean and his season-to-date mean (weeks 2-10; RB carries / WR+TE targets / QB
# attempts), mean absolute error:
#
#                       prior only   K=8    K=5    K=2    K=1    K=0.5
#     RB carries 2025     3.87       3.46   3.35   3.19   3.13   3.12
#     WR targets 2025     2.05       1.95   1.93   1.92   1.93   1.96
#     TE targets 2025     1.64       1.54   1.52   1.49   1.49   1.50
#     QB attempts 2025    8.36       7.98   7.89   7.79   7.76   7.76
#
# Same shape in 2023 and 2024: the current season should carry equal weight after ONE game and
# dominate after two, and the optimum is flat across K = 1-2, so this is not balanced on an edge.
# Line-blind: it reads the player's own box scores, never a line.
#
# Re-swept with the recency weighting below (analysis/volume_sweep.py, train 2021-24 / held-out
# 2025-26). The surface is flat across K = 0.5-1.5 at every half-life, so this is a nudge, not a
# knife edge -- K = 1.0 was simply the floor.
CUR_K = 1.0

# Games of half-life for the season-to-date mean. THIS is the fix for the defect Derek caught on
# tonight's Green Bay backfield: Kaleb Johnson carried 0 times in week 1 and 8 times in week 2, and
# a simple mean called that 4. When a player's role changes mid-season -- which is the whole reason
# we look at current-season usage at all -- averaging the old role with the new one is the worst
# available estimator.
#
# Measured on 27,053 player-games, predicting each player's NEXT game's volume (RB carries / WR+TE
# targets / QB attempts) from data strictly before it. Train 2021-24 picked 2.5; the surface is
# flat from 2.0 to 3.0 so it is not balanced on an edge. Held-out 2025-26, MAE:
#
#                     simple mean   half-life 2.5
#     all positions      2.829         2.774      +1.9%
#     RB carries         3.329         3.257      +2.2%
#     WR targets         1.844         1.816      +1.6%
#     QB attempts        8.349         8.139      +2.5%
#     TE targets         1.476         1.471      +0.3%
#
# The board-wide gain is small. The gain where it matters is not: on players whose role had just
# stepped up, MAE improved 4.1% and -- the number that actually mattered -- the BIAS went from
# -1.88 to -0.96. We were projecting the newly-promoted roughly two carries/targets per game under
# what they went on to do, every week, which is exactly the complaint.
#
# Note what did NOT work, so nobody rebuilds it: weighting the last game alone is far worse than
# the simple mean (MAE 3.24 vs 2.93) -- the answer is "weight recent games more", not "use the
# recent game". And projecting volume as a share of team volume added nothing at all (2.939 vs
# 2.927), so there is no share layer here on purpose.
HALF_LIFE = 2.5


def _ewma(vals, half_life=HALF_LIFE):
    """Recency-weighted mean of a per-game series, oldest first."""
    vals = [float(v) for v in vals]
    if not vals:
        return 0.0
    lam = 0.5 ** (1.0 / half_life)
    w = np.array([lam ** i for i in range(len(vals) - 1, -1, -1)], dtype=float)
    return float(np.dot(w, vals) / w.sum())


def current_season_rates(season):
    """Per-player per-game volume from THIS season's completed games, same shape as
    prior_year_rates. Empty when the season's stats file is not there (Week 1)."""
    path = f"data/stats_{season}.csv"
    if not os.path.exists(path):
        return {}
    s = pd.read_csv(path, low_memory=False)
    s = s[s.season_type == "REG"].copy()
    for c in ["carries", "targets", "receptions", "attempts", "rushing_yards", "receiving_yards", "passing_yards"]:
        s[c] = pd.to_numeric(s.get(c), errors="coerce").fillna(0.0)
    out = {}
    for pid, g in s.groupby("player_id"):
        n = g.week.nunique()
        if n == 0 or not isinstance(g.iloc[-1].player_display_name, str):
            continue
        row = g.iloc[-1]
        starts = g[g.attempts >= 15]
        ns = starts.week.nunique()
        # Per-WEEK series, oldest first, so recent games can be weighted more heavily. A player who
        # appears twice in one week (rare data artifact) is summed, not double-counted as a game.
        wk = g.groupby("week", as_index=True)[["carries", "targets", "attempts"]].sum().sort_index()
        sw = starts.groupby("week", as_index=True)["attempts"].sum().sort_index()
        out[str(pid)] = {
            "name": row.player_display_name, "pos": row.position, "team": row.team, "games": int(n),
            "pid": row.player_id,
            "carries_pg": _ewma(wk.carries.tolist()), "targets_pg": _ewma(wk.targets.tolist()),
            "att_pg": _ewma(sw.tolist()) if ns else _ewma(wk.attempts.tolist()),
            "qb_starts": int(ns),
            "pass_att": g.attempts.sum(), "pass_ypa": g.passing_yards.sum() / max(g.attempts.sum(), 1),
        }
    return out


def blend_current(rates, cur):
    """Fold this season's games into each player's volume (CUR_K). A player with no prior-season
    row but games this season (a rookie starter) gets a row built from this season alone — the
    role blend downstream still pulls a one-game sample hard toward his depth slot."""
    blended, created = 0, 0
    by_pid = {str(r["pid"]): r for r in rates.values()}
    for pid, c in cur.items():
        r = by_pid.get(pid)
        n = c["games"]
        if r is not None:
            for f in ("carries_pg", "targets_pg", "att_pg"):
                r[f] = (n * c[f] + CUR_K * r[f]) / (n + CUR_K)
            # QB efficiency and attempts pool across both seasons; starts add up.
            r["pass_att"] = r.get("pass_att", 0.0) + c["pass_att"]
            if r["pass_att"] > 0:
                r["pass_ypa"] = ((r.get("pass_ypa", 0.0) * (r["pass_att"] - c["pass_att"]))
                                 + c["pass_ypa"] * c["pass_att"]) / r["pass_att"]
            r["qb_starts"] = r.get("qb_starts", 0) + c["qb_starts"]
            r["games"] = r.get("games", 0) + n
            r["cur_games"] = n
            blended += 1
        else:
            key = norm(c["name"])
            if key in rates:
                continue                      # same name, different id — leave the veteran's row
            rates[key] = dict(c, cur_games=n)
            created += 1
    return blended, created


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


def roster_profiles(season):
    """{norm(name): {name, team, pos, pid}} from THIS season's roster.

    The fallback for a player the books price who has NO prior-season game log — which is every
    ROOKIE. `prior_year_rates` is built from last season's stats, so a rookie simply is not in it,
    and the emit loop below dropped him. The loop even counted them: "N unmatched (rookies/no
    2025)". It was printed on every run and nobody read it.

    Measured on the 2026 Week 1 slate: 136 of 552 priced players (25%) had no row, and the misses
    included the FOUR SHORTEST anytime-TD prices on the whole slate — Mike Washington Jr. (-200),
    MarShawn Lloyd (-143), Jonathon Brooks (-140) and Jadarian Price (-115), Seattle's starting
    back with Zach Charbonnet out. A board that omits the market's clearest pick is not thin, it is
    wrong.

    Same rule as `current_teams` above, one step further: the roster is the authority on who is on
    a team NOW, so it can answer "who is this?" for someone our history has never seen. Keyed on
    the normalised name because the odds feed carries no gsis_id; the roster's own gsis_id rides
    along so downstream joins stay on the stable id."""
    path = f"data/roster_{season}.csv"
    if not os.path.exists(path):
        return {}
    d = pd.read_csv(path, low_memory=False)
    d = d[d.full_name.notna() & d.team.notna()]
    if "status" in d.columns:                      # prefer the ACTive entry for a repeated name
        d = d.sort_values("status", key=lambda s: (s != "ACT").astype(int))
    out = {}
    for _, r in d.iterrows():
        k = norm(str(r["full_name"]))
        if not k or k in out:
            continue
        out[k] = {"name": str(r["full_name"]), "team": str(r["team"]),
                  "pos": str(r.get("position") or r.get("depth_chart_position") or ""),
                  "pid": str(r["gsis_id"]) if pd.notna(r.get("gsis_id")) else None}
    return out


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


# QB YPA persists more strongly than anything else on the board (r = 0.384 season over season), so
# the player's own rate is regressed toward the starter baseline rather than stripped to it. The
# value moved 300 -> 1000 when the sweep was finally run against the right objective: at 300 we were
# over-crediting good quarterbacks by +12.4 yards relative to bad ones on held-out data, which is a
# bias in the opposite direction from the receiver bug and just as visible.
#
#     K        held-out MAE   held-out bias spread
#     league      40.958            -16.79
#     300         40.911            +12.37   <- what shipped
#     700         40.659             +2.12
#     1000        40.656             -1.79   <- chosen, best on BOTH
#     1500        40.698             -5.62
#
# CAVEAT, stated because this project has been bitten by it: the sweep used PRIOR-SEASON attempts,
# while production's `pass_att` pools prior plus current season. Production therefore gives a QB
# slightly more of his own rate than the fit did, pushing the bias a little positive. The MAE
# surface is flat from 700 to 1500 (0.1%), so the choice is not balanced on that edge.
PASS_K = 1000.0

# Targets of regression for a RECEIVER's own yards-per-target, same shape as PASS_K above.
#
# Derek, on the week-3 receiving board: "All of the main receivers are all unders and the bottom
# half players are all overs. That is not correct." He was right, and it took three wrong answers
# to find out why — the skew of the market, the current-season volume blend, and the projected-
# volume tiering were each measured first and each came back clean. It is this term.
#
# rec_yds was volume x a LEAGUE catch rate x a LEAGUE yards-per-reception, discarding the player's
# own efficiency entirely, on the founding finding that efficiency does not persist. That finding
# is about RUSHING — yards per carry correlates 0.058 year to year. Receiving is not the same
# quantity, because yards per target is substantially a ROLE (a deep threat and a check-down slot
# are not drawing from one distribution) and roles persist. Measured season-over-season, players
# with 25+ targets in both:
#
#     WR  r = 0.207 (n=447)     TE  r = 0.336 (n=183)     RB  r = 0.104 (n=156)     rushing 0.058
#
# So the league baseline systematically marks efficient receivers down and inefficient ones up,
# which is precisely the top-half-under / bottom-half-over board Derek was reading. Held-out
# 2025-26, per-game receiving yards with volume held identical so only this term moves:
#
#                              bias, league baseline    bias, own regressed
#     WR efficient (top third)        -3.29                   -1.63
#     WR inefficient (bottom)         +2.44                   +1.57
#     TE efficient (top third)        -3.64                   -1.06
#     TE inefficient (bottom)         +0.76                   -1.03
#
# Be honest about the size: MAE barely moves (WR +0.30%, TE +0.14%). This is a CALIBRATION fix, and
# calibration is what the board publishes — a number that is systematically 3.3 yards light on
# every good receiver is wrong in a way a reader can see, which is how it was found.
#
# K is deliberately heavy. At 500, a receiver with 100 prior targets gets 17% of his own rate; at
# 120 a tight end with 70 gets 37%. Both were chosen on train 2021-24 and confirmed on held-out.
# RB is ABSENT on purpose: r = 0.104 and held-out came back -0.10%, so backs keep the league rate.
REC_YPT_K = {"WR": 120.0, "TE": 120.0}

# The same treatment for a running back's yards per carry. The founding rule says rushing efficiency
# does not persist and cites r = 0.058 — measured per GAME. Measured the way a projection actually
# uses it, season to season on backs with 40+ carries in both, it is r = 0.194. Not large, and the
# league rate still does most of the work at K = 700, but enough that stripping a back's own rate
# entirely left the same good-players-marked-down bias the receivers had:
#
#     K        held-out MAE   held-out bias spread
#     league      13.219            -3.21
#     700         13.280            +0.08   <- chosen
#     300         13.357            +2.58
#
# This one costs a little accuracy (-0.46%) to remove the bias, which is the opposite trade from
# the receivers and quarterbacks, where the chosen K improved both. Taken deliberately: 0.46% of
# 13.2 yards is 0.06 yards of accuracy, against a 3.2-yard systematic gap between good and bad backs
# that a reader can see on every row of the board.
RUSH_YPC_K = 700.0


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


def role_k_for(cur_games):
    """How hard to pull a player toward his depth slot, given games played THIS season.

    ROLE_K = 12 was measured on the WEEK 1 problem -- predicting a season from the season before,
    with no current-season games in evidence at all. It was then left switched on all year, and
    that is the second half of the Green Bay defect: the depth-chart rank is a coarse, LAGGING
    proxy for volume, and once a player has actually carried the ball we are holding a direct
    measurement of the very thing the proxy estimates. MarShawn Lloyd's 19 carries in two games
    were being overwritten by a league-wide "what an RB1 typically gets" median, while Kaleb
    Johnson was anchored to the reserve role he had last year.

    Swept against next-game volume on 25,193 player-games with the depth chart as it stood going
    into each week (analysis/role_weight_backtest.py). Train 2021-24 MAE, by games played this
    season -- the pull is monotonically harmful from the second game onward:

        cur_n      K=0      K=2      K=4      K=8     K=12
            1   3.2227   3.1258   3.1758   3.2467   3.2987
            2   2.8594   2.9004   2.9783   3.0848   3.1574
            3   3.0976   3.1589   3.2466   3.3631   3.4403
          10+   2.9559   2.9624   2.9873   3.0490   3.1132

    The single-game pocket replicates on held-out 2025-26 (K=2 beats K=0 at every position, RB
    3.030 vs 3.268), so it is kept rather than rounded away. Everything past it goes to zero:
    held-out overall 2.858 -> 2.822, +1.3%, and RB +3.4%.

    Week 1 is untouched -- with no games played the rank is the only role information we have."""
    n = max(int(cur_games or 0), 0)
    return ROLE_K if n == 0 else 2.0 if n == 1 else 0.0
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
        role_k = role_k_for(r.get("cur_games", 0))
        if role_k <= 0:
            continue
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
            r[field] = (before * n + t * role_k) / (n + role_k)
            if abs(r[field] - before) > 0.5:
                moved += 1
    return moved


# Sharpening of the within-team CARRY split.
#
# Derek, repeatedly: "the top half players are all still unders and the bottom half are all overs."
# Chasing that turned up a real defect, though not the one expected. Our team-level totals agree
# with the market almost exactly (ATL receivers 181.6 vs the market's 177.0, GB 216.1 vs 205.5), so
# the LEVEL is right; what was wrong is how the total is split inside a room. Measured against what
# actually happened, 2,393 team-weeks, no market data involved:
#
#     share of a team's targets to its top receiver   ours 27.2%   reality 30.7%
#     ... top two                                          47.4%           52.3%
#     ... top three                                        62.8%           68.2%
#
# Three shrinkages stack — the prior-season blend, the depth-chart role prior and the recency
# weighting all pull a player toward the middle of his room, and nothing pulls back.
#
# The fix is a power transform on each player's share of the room, which concentrates the split
# while preserving the team total that is already right:  share' = share^G / sum(share^G).
#
# IT ONLY SHIPS FOR CARRIES. Swept on train against per-player volume error, held out on 2025-26:
#
#     carries   G=1.10   MAE 1.4455 -> 1.4373 (+0.56%)   top-1 share 56.5% -> 59.2% (actual 59.9%)
#     targets   every G > 1 made MAE WORSE (1.688 -> 1.722 at the G that matched concentration)
#
# The targets result is the interesting one and it is why this is not applied there. Sharpening
# fixes the concentration number and costs accuracy, because the top receiver in a room is a
# DIFFERENT PLAYER from week to week. Our flat split is not a failure to see the WR1; it is a hedge
# across which receiver leads that week, and hedging is what minimises absolute error. A backfield
# is more stable, so concentrating it pays.
CARRY_GAMMA = 1.10


def sharpen_carries(rates):
    """Concentrate each team's carry split toward its lead back, preserving the team total."""
    rooms = defaultdict(list)
    for r in rates.values():
        if str(r.get("pos")) in ("RB", "FB", "QB", "WR") and r.get("team"):
            rooms[str(r["team"])].append(r)
    moved = 0
    for room in rooms.values():
        vals = [float(r.get("carries_pg", 0.0) or 0.0) for r in room]
        tot = sum(vals)
        if tot <= 0 or len(room) < 4:
            continue
        shares = [v / tot for v in vals]
        powed = [x ** CARRY_GAMMA for x in shares]
        ps = sum(powed)
        if ps <= 0:
            continue
        for r, q in zip(room, powed):
            before = float(r.get("carries_pg", 0.0) or 0.0)
            r["carries_pg"] = q / ps * tot
            if abs(r["carries_pg"] - before) > 0.25:
                moved += 1
    return moved


# ---- Vacated volume: the man ahead of him is OUT, so his workload has to go somewhere --------
#
# Derek: "let's find a source for in-week role changes." This is one, and we already held it. The
# weekly injury report is the only in-week, pre-kickoff, line-blind feed we have that says a role
# is about to change, and we were using it in exactly one direction: to SUPPRESS the injured
# player's own projection. His carries were never pushed down to the backs who inherit them.
#
# Measured on 27,053 player-games, train 2021-24 and confirmed on held-out 2025-26. The quantity
# is the sum of our own projected volume for same-team, same-position team-mates ruled Out, and it
# only survives for two positions:
#
#                 train bias   held-out bias    fitted k    held-out MAE
#     RB  vac>0     +1.721        +1.924         +0.2065    4.111 -> 3.899  (+5.2%)
#     QB  vac>0     +8.529        +5.677         +0.2970   11.326 -> 10.693 (+5.6%)
#     WR  vac>0     +0.267        +0.312            --      no gain (-0.3%)
#     TE  vac>0     +0.458        +0.001            --      worse (-9.7%)
#
# So a running back whose team-mate is out was beating our number by ~1.9 carries and now does not
# (held-out bias -1.924 -> -0.119). WR and TE are not corrected: a receiving room redistributes
# across five players and a defence, and the effect is too small to fit without adding noise.
#
# k is well under 1 on purpose -- vacated volume is shared out among everyone still standing, and
# some of it leaves the position group entirely. The coefficient absorbs that; it is not a share.
#
# QB is deliberately NOT corrected, even though it fitted well (k = +0.2970, held-out MAE
# 11.326 -> 10.693). The fit does not transfer, and a week-2 replay is what exposed it: the
# backtest estimates a QB from attempts averaged over EVERY appearance, so a back-up sits near
# zero and the coefficient has to carry him all the way up to a starter's workload. Production's
# `att_pg` is averaged over STARTS ONLY -- Jacoby Brissett already reads 34.7 there -- so adding
# the same coefficient on top took him to 41.1, and Kirk Cousins from 30.0 to 39.1. Right
# coefficient, wrong quantity. A QB correction needs to be fitted against the starts-only rate, or
# framed as what it actually is -- a binary "is he starting now" -- and neither is measured yet.
#
# The lesson generalises and is in the audit skill: a coefficient is only valid for the exact
# quantity it was fitted against, and "attempts per game" meant two different things in two files.
#
# Only "Out" counts, not "Doubtful", because only "Out" was measured. `injury_adj.py` treats the
# two together for the GAME model, which is a separate calibration; matching it here would apply
# this correction more often than the fit that produced it.
VACATED_K = {"RB": 0.2065, "FB": 0.2065}
VACATED_FIELD = {"RB": "carries_pg", "FB": "carries_pg"}


# Sleeper spells two clubs differently and still tags a few players OAK.
SLEEPER_TEAM = {"LAR": "LA", "OAK": "LV"}
# Statuses that mean "he is not playing". "NA" is excluded: Sleeper uses it for "no information"
# and healthy starters carry it.
SLEEPER_OUT = {"OUT", "IR", "PUP", "NFI", "DNR", "SUS"}


def sleeper_out(rates):
    """gsis-free set of (norm name, team) Sleeper says will not play.

    The official injury report carries no designation before Friday and drops anyone moved to IR
    entirely, so on a Thursday it is nearly empty -- week 3 had five rows league-wide, all from the
    two teams playing that night. Sleeper moves on the beat reporting instead, which is how it had
    Jaxson Dart "Out, Knee - MCL, Surgery" while our report had him as an undesignated DNP.

    Returns an empty set on any failure: an unavailable feed must leave the board unchanged."""
    try:
        oc.ensure_ssl_certs()
        req = urllib.request.Request("https://api.sleeper.app/v1/players/nfl",
                                     headers={"User-Agent": "statseer-proj/1.0"})
        with urllib.request.urlopen(req, timeout=120) as r:
            all_players = json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:  # noqa: BLE001 — supplementary source, never fatal
        print(f"  WARNING: Sleeper unavailable ({e}); using the official report only",
              file=sys.stderr)
        return set()
    out = set()
    for pl in all_players.values():
        if not pl.get("active") or not pl.get("team") or not pl.get("full_name"):
            continue
        if str(pl.get("injury_status") or "").upper() not in SLEEPER_OUT:
            continue
        team = SLEEPER_TEAM.get(pl["team"], pl["team"])
        out.add((norm(str(pl["full_name"])), team))
    return out


def apply_vacated(rates, season, week):
    """Push an Out player's projected volume down to the team-mates who inherit it.

    Returns (players_adjusted, players_ruled_out). Degrades to (0, 0) when the report is not
    published yet -- a week with no injury report must leave the board unchanged, not fail."""
    # The official report first. A failure here must NOT skip Sleeper below — on a Thursday the
    # official report is nearly empty by design, which is the whole reason the second source exists.
    out_ids = set()
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from injury_adj import load_injuries
        inj = load_injuries(season, refresh=True)
        if inj is not None and "week" in inj.columns:
            wk = inj[(pd.to_numeric(inj.week, errors="coerce") == week)
                     & (inj.report_status.astype(str).str.strip().str.lower() == "out")]
            out_ids = set(wk.gsis_id.astype(str))
    except Exception as e:  # noqa: BLE001 — the correction degrades off rather than failing
        print(f"  WARNING: injury report unavailable ({e}); using Sleeper alone", file=sys.stderr)

    # The official report is joined on gsis_id; Sleeper has that field on only a fifth of players,
    # so it joins on normalised name + team — the weaker key, which is why the team has to agree
    # too. Extending the out-set beyond the designations the coefficient was fitted on is safe
    # here because it is SELF-LIMITING: a player who has been on IR for weeks has a recency-weighted
    # volume of ~0, so he vacates ~0. The rows this actually changes are starters newly ruled out,
    # which is exactly the fitted case, only found sooner.
    sleeper = sleeper_out(rates)
    out_keys = {(norm(str(r.get("name", ""))), str(r.get("team"))) for r in rates.values()
                if str(r.get("pid")) in out_ids} | sleeper
    if not out_keys:
        return 0, 0

    def is_out(r):
        return (str(r.get("pid")) in out_ids
                or (norm(str(r.get("name", ""))), str(r.get("team"))) in sleeper)

    # {(team, group): vacated volume}, summing only players we actually have a projection for.
    vacated = defaultdict(float)
    for r in rates.values():
        if not is_out(r) or VACATED_K.get(str(r.get("pos"))) is None:
            continue
        field = VACATED_FIELD[str(r["pos"])]
        vacated[(str(r.get("team")), str(r["pos"]))] += float(r.get(field, 0.0) or 0.0)

    moved = 0
    for r in rates.values():
        pos = str(r.get("pos"))
        k = VACATED_K.get(pos)
        if k is None or is_out(r):
            continue
        # RB and FB share one room.
        keys = [(str(r.get("team")), p) for p in (("RB", "FB") if pos in ("RB", "FB") else (pos,))]
        vac = sum(vacated.get(kk, 0.0) for kk in keys)
        if vac <= 0:
            continue
        field = VACATED_FIELD[pos]
        r[field] = float(r.get(field, 0.0) or 0.0) + k * vac
        r["vacated"] = round(vac, 2)
        moved += 1
    # Report both sources separately: "5 Out" from the official report on a Thursday is correct and
    # would look like a broken feed if it were the only number printed.
    return moved, (len(out_ids), len(sleeper))


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


# ---- What the board PUBLISHES: a 50/50 number, not an expected value ------------------------
#
# Derek, over and over: "all of the main receivers are all unders and the bottom half players are
# all overs." The cause was never a bad projection. It was a units clash. We computed a
# recency-weighted MEAN; a book sets its line near the MEDIAN, because that is where the two sides
# split. Receiving and rushing yards are right-skewed, so a mean sits above a median — a lot at the
# bottom of the board and barely at the top — and `proj > line` fires on the depth and misses on the
# stars, deterministically, with nothing wrong in the model.
#
# So the published number is converted to the same statistic the line is: the point where the
# player is as likely to go over as under.
#
# CALIBRATED ON THE PRICED POPULATION, which is the part that took two attempts. Fitting
# median(actual)/mean(projection) over every player-game in the league swung the board from 67%
# over to 33% over — books only post a line on players with a real role, and a WR5 whose median is
# zero drags the ratio down while never appearing on the board. Refitted on rows that actually
# carried a FanDuel line: train on the backfilled 2024 season (4,175 rows), held out on 2026 weeks
# 1-2. The test is not MAE, it is whether a reader comparing our column to theirs is told the truth:
#
#                        our number over the line        actual over     held-out MAE
#     rec_yds   held-out    67.5%  ->  51.4%                47.7%        22.90 -> 21.89
#     rush_yds  held-out    63.8%  ->  52.0%                44.1%        19.28 -> 18.84
#     pass_yds  held-out    41.3%  ->  49.2%                46.0%        72.06 -> 72.46
#
# Passing is the control and behaves like one: near-symmetric, so the ratio comes out 1.02 flat and
# the number barely moves. Absolute error improves on the two skewed markets because the median
# minimises absolute error where the mean minimises squared error — so the report cards, which grade
# absolute error against the close, get better too rather than worse.
#
# Receptions and anytime TD are NOT converted. Receptions is a small integer whose whole range fits
# in one band, and anytime TD is already a probability on the same scale as the book's.
# The bands are on the player's LEVEL, and the first cut of them was wrong in a way that hid
# itself. It bucketed by our own projected mean from a SIMPLIFIED estimator — not the number the
# board publishes — and came out nearly flat (1.02, 0.85, 0.88, 0.84, 0.87, 0.70). A flat ratio is
# a uniform shrink: it moves the board's average over-rate to 50% and leaves the TILT untouched,
# which is why Derek could still see it after the average said it was fixed:
#
#     top half of a game by line     26% over          <- after the "fix"
#     bottom half                    65% over
#
# Re-measured against the player's LEVEL rather than our estimate of it — 2,850 priced receiving
# rows and 1,329 rushing, 2024 plus 2026 weeks 1-2 — the real curve is steep, not flat. The skew is
# severe on small lines and nearly gone on big ones, which is exactly the tilt:
#
#     level     0-18   18-28   28-45   45-62   62-80    80+
#     rec_yds   0.68    0.81    0.87    0.92    0.94    1.02
#     rush_yds  0.69    0.87    0.87    0.90    0.96    0.96
#
# Passing is flat at 1.01 across every band, as it should be: near-symmetric market, no tilt to
# correct, and the number barely moves.
#
# Monotone by construction — skew can only shrink as the level rises — so a thin top band cannot
# invert the curve and push the stars back down.
PUBLISH_BANDS = [0.0, 18.0, 28.0, 45.0, 62.0, 80.0]
PUBLISH_RATIO = {
    "rec_yds":  [0.679, 0.812, 0.869, 0.917, 0.936, 1.023],
    "rush_yds": [0.690, 0.867, 0.867, 0.904, 0.965, 0.965],
    "pass_yds": [1.014, 1.014, 1.014, 1.014, 1.014, 1.014],
}


def to_fifty_fifty(market, mu):
    """Convert an expected value to the point a player is as likely to beat as not."""
    r = PUBLISH_RATIO.get(market)
    if not r or mu is None or mu <= 0:
        return mu
    i = 0
    while i + 1 < len(PUBLISH_BANDS) and mu >= PUBLISH_BANDS[i + 1]:
        i += 1
    return mu * r[min(i, len(r) - 1)]


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
    # Receiving: the league's yards-per-target, nudged toward what this player has actually done
    # with a target. A player with no prior-season targets falls back to the league rate exactly.
    lg_ypt = b["catch"] * b["ypr"]
    k = REC_YPT_K.get(rate["pos"])
    if k:
        pt, py = rate.get("prev_tgt", 0.0) or 0.0, rate.get("prev_rec_yds", 0.0) or 0.0
        ypt = (py + lg_ypt * k) / (pt + k)
    else:
        ypt = lg_ypt
    # Rushing: same shape as the receiving term above.
    pc, py_r = rate.get("prev_car", 0.0) or 0.0, rate.get("prev_rush_yds", 0.0) or 0.0
    ypc = (py_r + b["ypc"] * RUSH_YPC_K) / (pc + RUSH_YPC_K)
    return {
        "rush_yds": round(to_fifty_fifty("rush_yds", rate["carries_pg"] * ypc), 1),
        "rec_yds": round(to_fifty_fifty("rec_yds", rate["targets_pg"] * ypt), 1),
        "receptions": round(rate["targets_pg"] * b["catch"], 1),
        "pass_yds": round(to_fifty_fifty("pass_yds", rate["att_pg"] * reg_ypa), 1),
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

    try:
        week = latest_week(args.season)
        props = fetch_props(args.season, week)
    except TransientRead as e:
        print(f"{e} — skipping this run (the next scheduled run regenerates)")
        return 0
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
    # This season's games, blended in BEFORE the role blend so the role pull acts on the
    # freshest volume. See CUR_K.
    _cur = current_season_rates(args.season)
    if _cur:
        _b, _c = blend_current(rates, _cur)
        print(f"  blended {args.season} games into {_b} players' volume (K={CUR_K}); "
              f"{_c} rows built from this season alone")
    else:
        print(f"  no data/stats_{args.season}.csv — projecting from {prior} volume only")
    # Blend prior-season volume toward the player's CURRENT depth role. Without this the board
    # projects last year's usage: a former starter now third on the chart keeps a starter's number.
    _ranks = current_ranks(args.season)
    if _ranks:
        _rolevol = role_volume(rates, _ranks)
        _moved = apply_role(rates, _ranks, _rolevol)
        print(f"  role-adjusted volume for {_moved} player-fields "
              f"({len(_ranks)} on the depth chart, {len(_rolevol)} role baselines)")
    # AFTER the role blend, because this acts on the volume we are actually going to publish.
    _sharp = sharpen_carries(rates)
    print(f"  carry split sharpened (gamma={CARRY_GAMMA}) for {_sharp} players")
    _vac, (_official, _news) = apply_vacated(rates, args.season, week)
    if _official or _news:
        print(f"  vacated volume: {_official} ruled Out on the official report, {_news} on the news "
              f"feed; {_vac} team-mates inherited share")
    # All game logs, venue-tagged — including this season's, so the hit-rate columns count the
    # games already played this year (the row's "9/25 gm" moves with the season).
    _seasons = [y for y in range(2016, args.season + 1) if os.path.exists(f"data/stats_{y}.csv")]
    career = load_career(_seasons, *load_venue_sets())

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
    # (player, market, book) -> {line: {side: price}}. Grouped by BOOK because a book's alternate
    # ladder is not several opinions about the line — it is one main line plus derivatives priced
    # off it. Bovada posts seven rungs on a passing-yards market; pooling them with the two books
    # that post a single line each let one book cast seven votes and dragged the median away from
    # the number on screen.
    quotes = defaultdict(lambda: defaultdict(dict))
    for r in props:
        if r["market"] not in MARKET_MAP:
            continue
        if r["market"] == "player_anytime_td":
            ip = implied_prob(r["price_american"])   # Yes-side odds -> implied % (the "book")
            if ip is None:
                continue
            lines[(r["player_name"], r["market"])].append(ip)
        elif r["line"] is not None:
            quotes[(r["player_name"], r["market"], r["book"])][float(r["line"])][r["side"]] =                 r["price_american"]
        else:
            continue
        teams = {team_norm(r["away_team"]), team_norm(r["home_team"])}
        meta[r["player_name"]] = (f'{r["away_team"]} @ {r["home_team"]}', r["commence_time"], teams)

    # Collapse each book's ladder to its MAIN line: the rung whose two sides are closest to even
    # money. An alternate is priced away from even by construction (Bovada's 257.5 is +175/-240,
    # implying 36%), so the balanced rung is the book's actual number. A book posting one line
    # trivially wins its own comparison; a one-sided quote falls back to whatever it posted.
    main_by_book = defaultdict(dict)          # (player, market) -> {book: main line}
    for (player, market, book), ladder in quotes.items():
        best, best_gap = None, None
        for line, sides in ladder.items():
            po = implied_prob(sides.get("Over") or sides.get("over"))
            pu = implied_prob(sides.get("Under") or sides.get("under"))
            gap = abs(po - pu) if (po is not None and pu is not None) else 1e6 - line
            if best_gap is None or gap < best_gap:
                best, best_gap = line, gap
        if best is not None:
            main_by_book[(player, market)][book] = best

    # WHICH book's line do we print? Derek: "we need to match FanDuel... A.J. Brown listed at 61.5
    # and in FanDuel he is 64.5." A cross-book median is a number nobody can actually bet, and it
    # can be a number nobody even POSTS: with books at 64.5 and 65.5 the median is 65.0, which is
    # not a line that exists on a receiving-yards market. So:
    #   1. print FanDuel's line when FanDuel has posted one — the book the reader is looking at;
    #   2. otherwise take the median across books and SNAP it to the nearest line a book actually
    #      posts, so the board never shows a number that cannot be bet anywhere.
    # `src` carries the book so the row can say where its line came from rather than implying a
    # consensus it is not.
    PREFERRED_BOOK = "fanduel"
    line_src = {}
    for kk, per_book in main_by_book.items():
        if PREFERRED_BOOK in per_book:
            lines[kk].append(per_book[PREFERRED_BOOK])
            line_src[kk] = PREFERRED_BOOK
        else:
            vals = sorted(per_book.values())
            med = statistics.median(vals)
            snap = min(vals, key=lambda v: (abs(v - med), v))
            lines[kk].append(snap)
            line_src[kk] = next(b for b, v in sorted(per_book.items()) if v == snap)

    roster = roster_profiles(args.season)
    out, matched, unmatched, offteam, norow = [], 0, [], [], 0
    for (player, market), ls in sorted(lines.items()):
        if NOT_A_PLAYER.search(player):
            continue
        cat, key = MARKET_MAP[market]
        rate = rates.get(norm(player))
        game, commence, teams = meta[player]
        book = round(statistics.median(ls), 1)
        src = line_src.get((player, market))
        if not rate:
            # No prior-season history — a rookie, or someone who did not play last year. He still
            # gets a row: the EXISTENCE of a posted prop decides who appears (the market saying he
            # matters), never its VALUE, so line-blindness is untouched. The projection is null and
            # renders as a dash, exactly as a thin sample already does; what the reader gains is
            # the player, his line and the fact that we have nothing on him — which is honest and
            # is strictly better than silence.
            prof = roster.get(norm(player))
            if prof:
                norow += 1
                # Same rule as the veteran branch below: the book put him in this game, so he gets
                # a row; if the roster disagrees about which side, we say nothing rather than
                # something wrong.
                pteam = prof["team"] if team_norm(prof["team"]) in teams else ""
                out.append({
                    "game": game, "commence": commence, "player": prof["name"],
                    "team": pteam, "pos": prof["pos"], "cat": cat, "market": key,
                    "book": book, "src": src, "proj": None, "g": 0,
                    "cOver": 0, "cG": 0, "pOver": 0, "pG": 0,
                    "hOver": 0, "hG": 0, "rOver": 0, "rG": 0,
                    "env": None, "envDelta": None,
                    "matchup": matchup_tag(defmap,
                                           (teams - {team_norm(pteam)} or {None}).pop(),
                                           prof["pos"]) if pteam else None,
                })
                continue
            unmatched.append(player)
            continue
        # THE BOOK DECIDES WHICH GAME A PLAYER IS IN. Derek: "the books will always be the most
        # accurate." This used to drop any player whose roster team was not in the game as
        # "preseason odds noise", and measured on the 2026 Week 1 slate that guard was wrong about
        # nearly every row it removed: Jaleel McLaughlin (a Denver back, our roster said CLE
        # practice squad), Jaydon Blue (a Cowboys back, roster said PHI), Khalil Herbert and
        # Marquez Valdes-Scantling (not on our roster at all). These are recent signings and
        # practice-squad elevations — the books know the active roster days before the nflverse
        # release does, and neither the roster file nor the weekly depth chart had any of them.
        #
        # So he keeps his row. What we do NOT do is guess which SIDE he is on: an unresolved team
        # becomes "", and a row that says nothing about his team is honest where a row that says
        # "CLE" inside a DEN @ KC card is simply wrong. Everything that depends on knowing the
        # team — the opponent-defence tag, the scoring-environment number — is withheld with it.
        team = rate["team"]
        if team_norm(team) not in teams:
            prof = roster.get(norm(player))
            if prof and team_norm(prof["team"]) in teams:
                team = prof["team"]                      # roster is fresher than the game log
            else:
                team = ""
                offteam.append(f'{player} ({rate["team"]} not in {teams}) — team unresolved')
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
        _ce = cur_env.get((week, team_norm(team))) if team else None
        _eb = env_base.get(rate["pid"])
        env_delta = round(_ce - _eb, 1) if (_ce is not None and _eb is not None) else None
        matched += 1
        out.append({
            "game": game, "commence": commence, "player": rate["name"], "team": team,
            "pos": rate["pos"], "cat": cat, "market": key, "book": book, "src": src, "proj": proj,
            "g": rate["games"], "cOver": cover, "cG": cgames, "pOver": pover, "pG": pgames,
            "hOver": hOver, "hG": hG, "rOver": rOver, "rG": rG,
            "env": round(_ce, 1) if _ce is not None else None, "envDelta": env_delta,
            # Context: how this opponent has handled this position. RB/WR/TE only — a passing
            # matchup is a different quantity and has not been measured, so QBs get no tag.
            # No team resolved => no opponent => no matchup tag. A defence rate is a claim about
            # a specific opponent; inventing one for an unknown side would be worse than a blank.
            "matchup": matchup_tag(defmap, (teams - {team_norm(team)} or {None}).pop(),
                                   rate["pos"]) if team else None,
        })

    out.sort(key=lambda r: (r["commence"], r["game"], r["cat"], -(r["proj"] or 0)))
    print(f"matched {matched} player-markets; {norow} priced-but-no-history rows (rookies, "
          f"projection dashed); {len(set(unmatched))} still unmatched (not on the current roster); "
          f"{len(set(offteam))} dropped as off-team (moved or bad source row)")
    # A drop count is only useful if someone reads it. "unmatched (rookies/no 2025)" was printed
    # on every run for weeks while 25% of priced players were missing from the board, so the
    # counts that mean COVERAGE LOST now name the players instead of just counting them.
    for x in sorted(set(unmatched))[:20]:
        print("   no row:", x)
    for x in sorted(set(offteam))[:20]:
        print("   off-team:", x)

    ts = "// AUTO-GENERATED by analysis/player_proj_export.py — do not edit by hand.\n"
    ts += "// Prior-season (%d) baseline projections: volume x position efficiency. PRESEASON —\n" % prior
    ts += "// not graded against closing lines yet.\n"
    ts += "export interface PlayerProj { game: string; commence: string; player: string; team: string;\n"
    ts += "  pos: string; cat: string; market: string; book: number | null; src?: string | null;\n"
    # NCAAF stamps the player's usage-ranked depth slot ("WR2") on the row (cfb_player_proj.py
    # usage_ranks); the NFL side reads its slots from the depth chart at render and leaves it out.
    ts += "  slot?: string | null;\n"
    ts += "  proj: number | null; g: number;\n"
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
