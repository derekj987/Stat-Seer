"""
mlb_game_model.py -- projected runs for tonight's games: a total, and each side's share.

    python mlb_game_model.py --validate    # walk-forward scoring, writes nothing
    python mlb_game_model.py               # -> web/lib/mlbGameModel.ts

THE MODEL.

    runs(A) = league x (A offence / league) x (B defence / league) x (B's starter factor)
    total   = runs(A) + runs(B)

Everything is computed from games STRICTLY BEFORE the one being predicted. Each club is shrunk
toward its OWN prior-season rate (rescaled into this season's run environment), not toward the
league mean -- so a team starts the year as itself rather than as average. That is worth +0.34% on
margin MAE and nothing on totals; see PRIOR_REGRESS for the twelve-configuration sweep.

WHAT IT IS WORTH -- and this is the headline, not a footnote. Measured on 554 held-out games,
constants swept on the first 70% of dates:

    model                              MAE (runs)   vs baseline
    league mean total (causal, 8.96)       3.5634            --
    team offence x defence, shrunk         3.5611         -0.0%
    + starting pitcher                     3.5317         +0.9%
    + prior-season team prior              3.5355         +0.8%   <- ships

MARGINS are the other half, and the reason the prior is in at all. Against a coin flip (predicting
a zero margin every game): 3.3490 -> 3.3377 MAE, +2.35% -> +2.68%, and mean |margin| 0.71 -> 0.79.
Our margins still average well under real ones (3.43), which is the honest shape of a model whose
team-quality term is worth almost nothing: it rarely makes anyone a big favourite.

(An exploratory pass scored +1.2%; this script's own --validate says +0.9%, and the smaller number
is the one that ships. A figure you cannot reproduce by running the code is not a measurement.)

Mean signed error against actual totals is +0.02 runs -- unbiased. That matters because the board
leans OVER the market's total on 13 of 15 games, median +0.7 runs: the market is pricing this
slate at 8.20 against a season that has realized 8.96. Which of the two is right is not knowable
yet -- MLB odds capture began 7 September -- so the board publishes both numbers and no pick.

TEAM QUALITY ALONE IS WORTH NOTHING. Offence x defence lands exactly on the league mean, and the
shrinkage sweep chose k=150 against ~140 games per team -- the optimiser's way of saying "ignore
the teams". Only the starting pitcher adds anything, and it adds 0.9%; the prior-season prior
then trades a tenth of that back for a better margin.

That is not a modelling failure, it is the sport. A single MLB game has a mean total of 8.96 runs
with a standard deviation of 4.53. Game-to-game variance swamps every team-quality difference
there is, which is exactly why baseball needs 162 games to sort its standings and football needs
17. Anyone publishing a confident MLB total is publishing noise with a decimal point on it.

Home-field advantage measured +0.06 runs across 2,165 games -- essentially nil, and far smaller
proportionally than football's. It is not in the model because it is not distinguishable from zero.

SO WHAT IS THIS FOR. The same thing the football game boards are for: a line-blind number,
published before the game, graded afterwards. It is the trust engine, not the edge. The edge, if
there is one, is in Value Finder, where the arithmetic works regardless of how noisy the sport is.
A run line is NOT published: the run line is a fixed +/-1.5 and turning a 0.8% total improvement
into a side pick would be inventing precision this model does not have.

Stdlib only. statsapi.mlb.com is public and keyless.
"""
import argparse
import collections
import datetime as _dt
import json
import os
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor

import mlb_availability as av

API = "https://statsapi.mlb.com/api/v1"
CACHE_T = os.path.join("data", "mlb_team_runs.json")
CACHE_P = os.path.join("data", "mlb_sp_runs.json")
K_TEAM, K_SP, W_SP = 150, 300, 1.0     # swept on the train split only
MIN_TEAM_GAMES, MIN_SP_OUTS = 20, 60
# League run environment: an EXPANDING causal mean (a season is ~2,430 games, so the window never
# truncates within one). It is a deque rather than a running total because the sweep below wanted
# to test short windows -- and found nothing.
#
# SWEPT ON THE TRAIN SPLIT (n=1,199), model MAE by window: 150 -> 3.5328, 300 -> 3.5506,
# 450 -> 3.5489, 600 -> 3.5468, 900 -> 3.5446, expanding -> 3.5444. That is a 0.3% spread across a
# 9x range of windows and it is NOT monotonic, which is what noise looks like. Recency in the
# league mean is not a lever. The window exists to make `lg` causal, not to make it accurate.
LG_WIN, LG_MIN = 4000, 200
SEASON = 2026

# PRIOR-SEASON TEAM PRIOR. Each club is shrunk toward its OWN last-season rate rather than toward
# the league mean, so a team starts the year as itself instead of as average and is still partly
# itself in September (K_TEAM=150 against ~140 games played is a heavy pull).
#
# MEASURED, chosen on TRAIN and reported on TEST across 12 configurations
# (regress x K = {0.35,0.5,0.65} x {150,300,600,1200}):
#
#     margin MAE   3.3178 -> 3.3064   (+0.34%)     gain vs a zero margin: +2.29% -> +2.62%
#     total  MAE   3.5569 -> 3.5577   (-0.02%, i.e. unchanged)
#     mean |margin| 0.72 -> 0.80      (less timid, which was the point)
#
# Small, but all twelve configurations beat the baseline on test margin and the train split agreed,
# so the SIGN is trustworthy even though the size is not exciting.
#
# Discipline note kept deliberately: selecting on the TEST split instead would have chosen
# regress=0.5/K=1200 and reported +2.90% -- nearly double. That gap is the cost of choosing on the
# data you report, and it is why these two constants come from the train split.
#
# Still untested against a closing line. MLB price capture began 2026-09-07; beating the market is
# a separate question that needs history we do not have.
PRIOR_SEASON = SEASON - 1
PRIOR_REGRESS = 0.65                   # pull last season toward league before using it as a prior
MIN_PRIOR_GAMES = 50                   # below this a club has no usable prior; fall back to league
CACHE_PRIOR = os.path.join("data", f"mlb_team_runs_{PRIOR_SEASON}.json")

# Held out over 554 games, straight from this script's own --validate. Kept here so the board
# cannot drift from what was measured. `resid` is the mean signed error against ACTUAL totals --
# published because the board leans over the MARKET, and this is the number that says that lean is
# not the model drifting high.
#
# WITH the prior-season prior (ships) vs WITHOUT it (run with PRIOR_REGRESS = 1.0, which collapses
# the prior to the league mean and reproduces the old model exactly):
#
#                        total MAE   total gain   margin MAE   margin gain   mean |margin|
#     league prior only     3.5317        +0.9%       3.3490        +2.35%            0.71
#     + 2025 team prior     3.5355        +0.8%       3.3377        +2.68%            0.79
#
# The trade is explicit: a tenth of a point of total accuracy for a third of a point of margin, and
# a model that is meaningfully less timid. Margins are where the prior was expected to help and
# where it does.
SCORES = {"model": 3.5355, "base": 3.5634, "gain": 0.8, "sd": 4.52, "meanTotal": 8.96,
          "n": 554, "resid": 0.02,
          "marModel": 3.3377, "marBase": 3.4296, "marGain": 2.7, "marMean": 0.79, "marActual": 3.43}


def _outs(ip):
    try:
        w, f = str(ip).split(".")
        return int(w) * 3 + int(f)
    except Exception:
        return 0


def team_runs(refresh=False):
    if not refresh and os.path.exists(CACHE_T):
        try:
            return json.load(open(CACHE_T, encoding="utf-8"))
        except Exception:
            pass
    teams = (av._get(f"{API}/teams?sportId=1") or {}).get("teams", [])

    def one(t):
        j = av._get(f"{API}/teams/{t['id']}/stats?stats=gameLog&group=hitting&season={SEASON}")
        out = []
        for blk in (j or {}).get("stats", []):
            for s in blk.get("splits", []):
                out.append({"team": t["id"], "name": t["name"], "date": s.get("date"),
                            "gamePk": (s.get("game") or {}).get("gamePk"),
                            "home": bool(s.get("isHome")), "runs": s["stat"].get("runs", 0)})
        return out
    rows = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for got in ex.map(one, teams):
            rows += got
    rows.sort(key=lambda r: (r["date"], r["gamePk"] or 0))
    os.makedirs(os.path.dirname(CACHE_T), exist_ok=True)
    json.dump(rows, open(CACHE_T, "w", encoding="utf-8"), ensure_ascii=False)
    return rows


def prior_team_runs(refresh=False):
    """Last season's team game logs. A completed season is immutable, so this caches forever and
    costs 30 calls on a cold runner."""
    if not refresh and os.path.exists(CACHE_PRIOR):
        try:
            return json.load(open(CACHE_PRIOR, encoding="utf-8"))
        except Exception:
            pass
    teams = (av._get(f"{API}/teams?sportId=1") or {}).get("teams", [])

    def one(t):
        j = av._get(f"{API}/teams/{t['id']}/stats?stats=gameLog&group=hitting"
                    f"&season={PRIOR_SEASON}")
        out = []
        for blk in (j or {}).get("stats", []):
            for s in blk.get("splits", []):
                out.append({"team": t["id"], "gamePk": (s.get("game") or {}).get("gamePk"),
                            "runs": s["stat"].get("runs", 0)})
        return out
    rows = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for got in ex.map(one, teams):
            rows += got
    os.makedirs(os.path.dirname(CACHE_PRIOR), exist_ok=True)
    json.dump(rows, open(CACHE_PRIOR, "w", encoding="utf-8"))
    return rows


def prior_rates(rows):
    """Last season's runs scored / allowed per team per game, each pulled PRIOR_REGRESS of the way
    toward that season's league mean. Returns (off, dfn, league) — league is needed to rescale into
    THIS season's run environment, since the two years do not score alike.

    Returns empty maps when the prior season is unavailable, and the model then falls back to the
    league mean exactly as it did before. An empty result is a claim, so it says so out loud."""
    by = collections.defaultdict(list)
    for r in rows:
        by[r["gamePk"]].append(r)
    rs = collections.Counter(); ra = collections.Counter(); n = collections.Counter()
    for _pk, v in by.items():
        if len(v) != 2:
            continue
        a, b = v
        rs[a["team"]] += a["runs"]; ra[a["team"]] += b["runs"]; n[a["team"]] += 1
        rs[b["team"]] += b["runs"]; ra[b["team"]] += a["runs"]; n[b["team"]] += 1
    if not n:
        print(f"WARNING: no {PRIOR_SEASON} team games parsed — falling back to the league prior",
              file=sys.stderr)
        return {}, {}, 0.0
    lg = sum(rs.values()) / sum(n.values())
    off, dfn = {}, {}
    for t in n:
        if n[t] < MIN_PRIOR_GAMES:
            continue
        off[t] = (1 - PRIOR_REGRESS) * (rs[t] / n[t]) + PRIOR_REGRESS * lg
        dfn[t] = (1 - PRIOR_REGRESS) * (ra[t] / n[t]) + PRIOR_REGRESS * lg
    print(f"{PRIOR_SEASON} prior: {len(off)} teams, league {lg:.3f} runs/team/game")
    return off, dfn, lg


def sp_runs(ids, refresh=False):
    if not refresh and os.path.exists(CACHE_P):
        try:
            return json.load(open(CACHE_P, encoding="utf-8"))
        except Exception:
            pass

    def one(pid):
        j = av._get(f"{API}/people/{pid}/stats?stats=gameLog&group=pitching&season={SEASON}")
        out = []
        for blk in (j or {}).get("stats", []):
            for s in blk.get("splits", []):
                st = s["stat"]
                if not st.get("gamesStarted"):
                    continue
                out.append({"pid": pid, "date": s.get("date"),
                            "outs": _outs(st.get("inningsPitched", "0.0")),
                            "er": st.get("earnedRuns", 0)})
        return out
    rows = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for got in ex.map(one, ids):
            rows += got
    rows.sort(key=lambda r: r["date"])
    os.makedirs(os.path.dirname(CACHE_P), exist_ok=True)
    json.dump(rows, open(CACHE_P, "w", encoding="utf-8"), ensure_ascii=False)
    return rows


def pair_games(rows, starters):
    by = collections.defaultdict(list)
    for r in rows:
        by[r["gamePk"]].append(r)
    games = []
    for pk, v in by.items():
        if len(v) != 2:
            continue
        h = next((x for x in v if x["home"]), None)
        a = next((x for x in v if not x["home"]), None)
        if not h or not a:
            continue
        games.append({"date": h["date"], "pk": pk, "home": h["team"], "away": a["team"],
                      "homeName": h["name"], "awayName": a["name"],
                      "hr": h["runs"], "ar": a["runs"], "total": h["runs"] + a["runs"],
                      "hsp": starters.get((pk, h["team"])), "asp": starters.get((pk, a["team"]))})
    games.sort(key=lambda g: (g["date"], g["pk"]))
    return games


class State:
    def __init__(self, games, poff=None, pdfn=None, plg=0.0):
        # The league run environment, per team per game, accumulated from games ALREADY PLAYED.
        #
        # It used to be statistics.mean(g["total"] for g in games) / 2 -- the mean over the whole
        # list, held-out games included. Every projection was therefore anchored to a league mean
        # computed partly from games it was about to predict, and so was the baseline it had to
        # beat. A small leak, but it is a leak in both directions at once, and the direction it
        # flattered was the baseline's.
        #
        # Found by reading the board rather than the code: 13 of 15 games projected OVER the
        # market's total, median +0.7 runs. That turned out NOT to be this bug -- see the sweep at
        # LG_WIN, which says window length is worth nothing, and the residual below, which says the
        # model runs slightly LOW against actual runs rather than high. The lean is against the
        # MARKET, which is pricing this slate at 8.20 against a season that has realized 8.96, and
        # with one day of captured MLB odds there is no way yet to say which is right. Fixing the
        # leak was worth doing on its own; it did not explain the lean and is not claimed to.
        self._recent = collections.deque(maxlen=LG_WIN)
        self._prior = statistics.mean(g["total"] for g in games[:200]) / 2 if games else 4.5
        # Last season's per-team rates, and the league mean they were measured against. Both are
        # needed: the rate has to be rescaled into THIS season's run environment before it can be
        # used as a target. Empty => shrink toward the league mean, the old behaviour.
        self._poff = poff or {}
        self._pdfn = pdfn or {}
        self._plg = plg
        self.rs = collections.defaultdict(int); self.ra = collections.defaultdict(int)
        self.n = collections.defaultdict(int)
        self.er = collections.defaultdict(int); self.outs = collections.defaultdict(int)
        self.tot_er = 0; self.tot_outs = 0

    @property
    def lg(self):
        """Runs per team per game over the trailing window. Falls back to the opening prior until
        the window fills, so early-season projections are not built on twenty games."""
        if len(self._recent) < LG_MIN:
            return self._prior
        return statistics.mean(self._recent) / 2

    @property
    def lg_rpo(self):
        return self.tot_er / self.tot_outs if self.tot_outs else 0.0

    def _target(self, tbl, t):
        """What this club is shrunk TOWARD: its own prior-season rate, rescaled into this season's
        run environment, or the league mean when there is no usable prior (an expansion club, a
        missing fetch, a team with too few games last year)."""
        v = tbl.get(t)
        if v is None or not self._plg:
            return self.lg
        return v * (self.lg / self._plg)

    def off(self, t):
        return (self.rs[t] + K_TEAM * self._target(self._poff, t)) / (self.n[t] + K_TEAM)

    def dfn(self, t):
        return (self.ra[t] + K_TEAM * self._target(self._pdfn, t)) / (self.n[t] + K_TEAM)

    def sp_factor(self, pid):
        """>1 = this starter gives up more than league; <1 = suppresses runs. 1.0 when unknown,
        which is the honest default — an unknown starter is not an average one, but pretending
        otherwise beats inventing a number."""
        if not pid or self.outs[pid] < MIN_SP_OUTS or not self.tot_outs:
            return 1.0
        rate = (self.er[pid] + K_SP * self.lg_rpo) / (self.outs[pid] + K_SP)
        return rate / self.lg_rpo

    def project(self, home, away, hsp, asp):
        if self.n[home] < MIN_TEAM_GAMES or self.n[away] < MIN_TEAM_GAMES or self.tot_outs < 2000:
            return None
        fh, fa = self.sp_factor(asp), self.sp_factor(hsp)
        eh = self.off(home) * self.dfn(away) / self.lg * (1 + W_SP * (fh - 1))
        ea = self.off(away) * self.dfn(home) / self.lg * (1 + W_SP * (fa - 1))
        # NOT "home"/"away" — those keys already hold the TEAM NAMES on the exported row, and
        # spreading this dict over them silently replaced the names with run counts.
        return {"homeRuns": round(eh, 2), "awayRuns": round(ea, 2), "total": round(eh + ea, 2),
                "homeSpFactor": round(fa, 3), "awaySpFactor": round(fh, 3)}

    def advance(self, g, spby):
        self._recent.append(g["total"])
        self.rs[g["home"]] += g["hr"]; self.ra[g["home"]] += g["ar"]; self.n[g["home"]] += 1
        self.rs[g["away"]] += g["ar"]; self.ra[g["away"]] += g["hr"]; self.n[g["away"]] += 1
        for pid in (g["hsp"], g["asp"]):
            for e in spby.get((g["date"], pid), []):
                self.er[pid] += e["er"]; self.outs[pid] += e["outs"]
                self.tot_er += e["er"]; self.tot_outs += e["outs"]


def validate(games, spby, prior=None):
    st = State(games, *(prior or ()))
    rows = []
    for g in games:
        p = st.project(g["home"], g["away"], g["hsp"], g["asp"])
        if p:
            # The baseline is captured HERE, at prediction time. Scoring it against the final
            # league mean let the baseline see games it was being tested on -- a small leak, but
            # it flattered the thing the model has to beat, which is the wrong direction to be
            # wrong in.
            rows.append({"date": g["date"], "y": g["total"], "p": p["total"], "b": 2 * st.lg,
                         "yM": g["hr"] - g["ar"],
                         "pM": p["homeRuns"] - p["awayRuns"]})
        st.advance(g, spby)
    dates = sorted({r["date"] for r in rows})
    cut = dates[int(len(dates) * 0.70)]
    te = [r for r in rows if r["date"] > cut]
    mae = lambda f: statistics.mean(abs(f(r) - r["y"]) for r in te)
    base = mae(lambda r: r["b"])
    mod = mae(lambda r: r["p"])
    print(f"held out {len(te):,} games  (LG_WIN={LG_WIN})")
    print(f"  trailing league mean MAE {base:.4f}")
    print(f"  model                MAE {mod:.4f}   -> {(base-mod)/base*100:+.1f}%")
    # A one-sided board is a bug, not a signal. Against ACTUAL runs the model should sit on the
    # outcome about half the time; a persistent lean means the level is wrong, which is exactly
    # what the season-long league mean was doing.
    over = sum(1 for r in te if r["p"] > r["y"])
    print(f"  projected over the actual total on {over/len(te)*100:.1f}% of held-out games "
          f"(want ~50%); mean residual {statistics.mean(r['p']-r['y'] for r in te):+.2f} runs")
    print(f"  (mean total {2*st.lg:.2f}, single-game SD "
          f"{statistics.pstdev([r['y'] for r in rows]):.2f} - the variance is the story)")
    # MARGINS get their own block, because the prior-season prior was added FOR the margin and a
    # report that only shows totals cannot say whether it earned its place. Baseline is predicting
    # a zero margin, i.e. every game a coin flip -- the honest null for a sport this noisy.
    mm = lambda f: statistics.mean(abs(f(r) - r["yM"]) for r in te)
    m0, mmod = mm(lambda r: 0), mm(lambda r: r["pM"])
    print(f"  margin: MAE {mmod:.4f} vs {m0:.4f} for a coin flip -> {(m0-mmod)/m0*100:+.2f}%")
    print(f"          mean |ours| {statistics.mean(abs(r['pM']) for r in te):.2f} vs "
          f"|actual| {statistics.mean(abs(r['yM']) for r in te):.2f} "
          f"(SD {statistics.pstdev([r['yM'] for r in rows]):.2f})")
    return base, mod


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--days", type=int, default=2)
    ap.add_argument("--out", default=os.path.join("web", "lib", "mlbGameModel.ts"))
    args = ap.parse_args(argv)

    lineups = av.season_lineups(_dt.date(SEASON, 3, 20),
                                _dt.date.today() + _dt.timedelta(days=args.days))
    starters = {(r["gamePk"], r["team"]): r["sp"] for r in lineups if r.get("sp")}
    rows = team_runs(refresh=args.refresh)
    sp = sp_runs(sorted({v for v in starters.values() if v}), refresh=args.refresh)
    spby = collections.defaultdict(list)
    for r in sp:
        spby[(r["date"], r["pid"])].append(r)
    games = pair_games(rows, starters)
    # Each club is shrunk toward its OWN last-season rate rather than the league mean. Built once
    # and passed to every State so validation and the export cannot disagree — a model scored with
    # one prior and published with another is not the model that was measured.
    prior = prior_rates(prior_team_runs(refresh=args.refresh))
    print(f"{len(games):,} completed games, {len(sp):,} starts")
    if len(games) < 300:
        print("WARNING: too little history — refusing to write", file=sys.stderr)
        return 1
    if args.validate:
        validate(games, spby, prior)
        return 0

    st = State(games, *prior)
    for g in games:
        st.advance(g, spby)
    base, mod = validate(games, spby, prior)

    name = {r["team"]: r["name"] for r in rows}
    # Club abbreviations for the board: a pitcher's name means little without the club beside it,
    # and the full club name does not fit in a chart cell.
    abbr = {t["id"]: t.get("abbreviation") or ""
            for t in (av._get(f"{API}/teams?sportId=1") or {}).get("teams", [])}
    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    out = []
    seen = set()
    for r in lineups:
        if r["final"] or (r.get("commence") or "") < now or r["gamePk"] in seen:
            continue
        opp_id = next((x["team"] for x in lineups
                       if x["gamePk"] == r["gamePk"] and x["team"] != r["team"]), None)
        if opp_id is None:
            continue
        home_id = r["team"] if r["side"] == "home" else opp_id
        away_id = opp_id if r["side"] == "home" else r["team"]
        p = st.project(home_id, away_id,
                       starters.get((r["gamePk"], home_id)), starters.get((r["gamePk"], away_id)))
        if not p:
            continue
        seen.add(r["gamePk"])
        out.append({
            # Series-safe: the same clubs meet on consecutive nights, so the matchup is not an
            # identity. Nor is the UTC date plus the matchup — a 9:40pm Pacific first pitch is
            # already tomorrow in UTC, which put four of tonight's west-coast games on the same
            # key as tomorrow's game of their own series. gamePk is StatsAPI's own unique id.
            "gameKey": str(r["gamePk"]),
            "game": f"{name.get(away_id)} @ {name.get(home_id)}",
            "commence": r["commence"], "eventDate": (r["commence"] or "")[:10],
            "home": name.get(home_id), "away": name.get(away_id),
            "homeAbbr": abbr.get(home_id, ""), "awayAbbr": abbr.get(away_id, ""),
            "homeSpName": next((x["spName"] for x in lineups
                                if x["gamePk"] == r["gamePk"] and x["team"] == home_id), None),
            "awaySpName": next((x["spName"] for x in lineups
                                if x["gamePk"] == r["gamePk"] and x["team"] == away_id), None),
            **p,
        })
    out.sort(key=lambda x: (x["commence"], x["game"]))
    header = (f"// AUTO-GENERATED by mlb_game_model.py -- do not edit by hand.\n"
              f"// Projected runs. Held-out MAE {mod:.4f} vs {base:.4f} for the league mean total"
              f" ({(base-mod)/base*100:+.1f}%).\n"
              f"// Team quality alone was worth 0.0%; only the starting pitcher adds anything.\n"
              f"// Generated {_dt.datetime.now(_dt.timezone.utc).isoformat(timespec='seconds')}\n")
    ts = (header +
          "export type MlbGame = { gameKey: string; game: string; commence: string;\n"
          "  eventDate: string; home: string; away: string;\n"
          "  homeAbbr: string; awayAbbr: string; homeSpName: string | null;\n"
          "  awaySpName: string | null; homeSpFactor: number; awaySpFactor: number;\n"
          "  homeRuns: number; awayRuns: number; total: number };\n\n"
          f"export const MLB_GAMES: MlbGame[] = {json.dumps(out, ensure_ascii=False)};\n"
          f"export const MLB_GAME_SCORES = {json.dumps(SCORES)};\n")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    open(args.out, "w", encoding="utf-8", newline="\n").write(ts)
    print(f"\nwrote {len(out)} games -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
