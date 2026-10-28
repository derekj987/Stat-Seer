"""
nba_game_model.py -- a line-blind NBA game model: projected margin and projected total.

    python nba_game_model.py --validate     # hold-out check, writes nothing
    python nba_game_model.py --export       # write web/lib/nbaGameModel.ts

🚨 THIS MODEL IS NOT GRADED AGAINST THE CLOSING LINE, AND THE BOARD SAYS SO. The project's
standing rule is that a candidate enters the model only if it improves results AGAINST THE CLOSING
LINE, out of sample. This one cannot clear that bar yet for a reason that has nothing to do with
its quality: NBA odds capture began 2026-10-26, so there is no closing-line history to grade
against. What CAN be measured today is held-out accuracy against the actual margin, and that is
what --validate reports. The two are not the same claim and the page must never imply they are.

Grading begins once nba_odds_snapshots holds closing lines for completed games. Until then
/nba/model carries an explicit "not graded yet" note where every other sport shows a track record.

WHAT THE RATING IS, and what it deliberately is not:

  · POINT DIFFERENTIAL, NEVER WIN-LOSS. Measured in this project on football and recorded in
    CLAUDE.md: point differential completely subsumes record (coefficient -0.010 for W-L against
    +0.450 for differential). Basketball has no reason to differ and every reason not to -- an
    82-game season produces far more differential signal than it does record signal.

  · OPPONENT-ADJUSTED, by the standard simple-rating iteration: a team's rating is the average of
    (its margin, less home-court, plus the opponent's rating), solved by repeated passes. Without
    this an early schedule flatters whoever drew the worst opponents.

  · HOME COURT IS MEASURED, NOT ASSUMED. It is computed from the sample and printed, because a
    number everyone "knows" is exactly the kind this project has been wrong about before.

  · THE PRIOR SEASON IS THE PRIOR. Current-season ratings are shrunk toward last season's by
    n/(n+k) -- the same shape as the NFL in-season blend. A week into a season, almost all of a
    team's rating should still be last year's; the shrinkage makes that automatic rather than a
    hand-tuned switch-over date.

🚨 A GAUSSIAN IS DEFENSIBLE HERE AND IS NOT IN FOOTBALL. NFL margins pile onto 3 and 7 (15.0% and
9.1%), which is why this project forbids a normal where key numbers matter. Basketball margins are
near-continuous, so a symmetric spread around the projection is an honest description rather than
a convenient one. That difference is the whole reason /nba/lines has no Sweet Spots tab.

DATA. ESPN's public scoreboard, the same host nba_rosters.py and slate_audit.py already read.
Results are cached under data/ (gitignored) because a full season is ~170 requests; the cache is
refreshed for any date that is not yet complete.

Stdlib only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import statistics
import sys
import urllib.error
import urllib.request
from collections import defaultdict

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
CACHE = os.path.join(ROOT, "data", "nba_results.json")
OUT = os.path.join(ROOT, "web", "lib", "nbaGameModel.ts")

# Season windows, ET calendar dates. The NBA regular season runs late October to mid April.
PRIOR_SEASON = ("2025-10-21", "2026-04-13")
CUR_SEASON_START = "2026-10-20"

# n/(n+k), used for the SCORING rates (points for/against), where a team's own average is a far
# less noisy quantity than an opponent-adjusted rating and blending two seasons is safe.
SHRINK_K = 12.0
RATING_PASSES = 25

# How much a current-season game counts against a prior-season one in the single weighted rating
# fit. At 3, a team four games in carries ~12 games of current weight against 82 prior -- roughly
# 13% -- and that share grows on its own as the season runs, reaching about half by late January.
# Deliberately modest: see the note in model_from for what happened at an effective 24%.
CUR_GAME_WEIGHT = 3.0


def _get(url, timeout=45):
    req = urllib.request.Request(url, headers={"User-Agent": "statseer/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def daterange(lo, hi):
    a = dt.date.fromisoformat(lo)
    b = dt.date.fromisoformat(hi)
    while a <= b:
        yield a
        a += dt.timedelta(days=1)


def load_cache():
    if not os.path.exists(CACHE):
        return {}
    try:
        return json.load(open(CACHE, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def save_cache(c):
    # data/ is gitignored, so on a fresh checkout the DIRECTORY does not exist and open() for
    # write raises FileNotFoundError. That exact omission took two scheduled jobs down in this
    # repo (workflow-triage class 1), so every writer under data/ makes the directory first.
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(c, open(CACHE, "w", encoding="utf-8"), separators=(",", ":"))


def fetch_results(lo, hi, cache, refresh_from=None):
    """Completed games in [lo, hi] as (date, away, home, away_pts, home_pts).

    A date already in the cache is not re-fetched unless it is on or after `refresh_from` — a day
    whose games had not finished when it was cached must be re-read, or a season's tail freezes
    half-played."""
    out = []
    fetched = 0
    for d in daterange(lo, hi):
        key = d.isoformat()
        stale = refresh_from is not None and key >= refresh_from
        if key not in cache or stale:
            try:
                sb = _get(f"{BASE}/scoreboard?dates={d:%Y%m%d}")
            except Exception as e:  # noqa: BLE001
                print(f"  ! {key}: {e}", file=sys.stderr)
                continue
            games = []
            for ev in sb.get("events", []):
                st = ev.get("status", {}).get("type", {})
                if not st.get("completed"):
                    continue
                comp = (ev.get("competitions") or [{}])[0].get("competitors") or []
                h = next((c for c in comp if c.get("homeAway") == "home"), None)
                a = next((c for c in comp if c.get("homeAway") == "away"), None)
                if not h or not a:
                    continue
                try:
                    games.append([a["team"]["abbreviation"], h["team"]["abbreviation"],
                                  int(a["score"]), int(h["score"])])
                except Exception:  # noqa: BLE001
                    continue
            cache[key] = games
            fetched += 1
        for g in cache[key]:
            out.append((key, g[0], g[1], g[2], g[3]))
    if fetched:
        print(f"  fetched {fetched} new date(s)")
    return out


def home_edge(games):
    """Mean home margin — measured, never assumed."""
    return statistics.mean(h - a for _, _, _, a, h in games) if games else 0.0


def ratings(games, hca, passes=RATING_PASSES, weights=None):
    """Opponent-adjusted point-differential rating, by weighted simple iteration.

    rating[t] = weighted mean over t's games of (its margin less home-court, plus the opponent's
    rating). Repeated until it settles; the mean is removed each pass so the scale stays centred
    on 0 and a rating reads directly as 'points better than an average team on a neutral floor'.

    `weights` is a per-game multiplier, which is how the current season enters — see model_from."""
    teams = {t for _, a, h, _, _ in games for t in (a, h)}
    r = {t: 0.0 for t in teams}
    played = defaultdict(list)
    for i, (_, a, h, ap, hp) in enumerate(games):
        w = 1.0 if weights is None else weights[i]
        played[h].append((a, (hp - ap) - hca, w))   # home: strip the home edge out of the margin
        played[a].append((h, (ap - hp) + hca, w))
    for _ in range(passes):
        nxt = {}
        for t in teams:
            rows = played[t]
            tot = sum(w for _, _, w in rows)
            nxt[t] = 0.0 if not tot else sum((m + r[o]) * w for o, m, w in rows) / tot
        mean = statistics.mean(nxt.values())
        r = {t: v - mean for t, v in nxt.items()}
    return r


def scoring(games):
    """Per-team points scored and allowed per game, as deltas from the league average."""
    pf, pa = defaultdict(list), defaultdict(list)
    for _, a, h, ap, hp in games:
        pf[h].append(hp); pa[h].append(ap)
        pf[a].append(ap); pa[a].append(hp)
    allpts = [p for v in pf.values() for p in v]
    lg = statistics.mean(allpts) if allpts else 0.0
    off = {t: statistics.mean(v) - lg for t, v in pf.items()}
    dfn = {t: statistics.mean(v) - lg for t, v in pa.items()}
    return lg, off, dfn


def blend(cur, prior, counts, k=SHRINK_K):
    """n/(n+k) toward the prior season. A team with no current games is entirely its prior."""
    out = {}
    for t in set(cur) | set(prior):
        n = counts.get(t, 0)
        w = n / (n + k)
        out[t] = w * cur.get(t, 0.0) + (1 - w) * prior.get(t, 0.0)
    return out


def build(refresh_from=None):
    cache = load_cache()
    today = dt.date.today().isoformat()
    print("prior season:")
    prior_games = fetch_results(PRIOR_SEASON[0], PRIOR_SEASON[1], cache)
    print("current season:")
    cur_games = fetch_results(CUR_SEASON_START, today, cache,
                              refresh_from=refresh_from or CUR_SEASON_START)
    save_cache(cache)
    print(f"  {len(prior_games)} prior-season games, {len(cur_games)} this season")
    return prior_games, cur_games


def model_from(prior_games, cur_games):
    hca_p = home_edge(prior_games)
    hca_c = home_edge(cur_games)
    # One home-court number, weighted to the prior season while this one is young. Printed because
    # an assumed home edge is exactly the kind of number this project has been wrong about.
    n = len(cur_games)
    w = n / (n + 200.0)
    hca = w * hca_c + (1 - w) * hca_p
    counts = defaultdict(int)
    for _, a, h, _, _ in cur_games:
        counts[a] += 1; counts[h] += 1

    # 🚨 ONE WEIGHTED FIT OVER BOTH SEASONS, NOT TWO RATINGS BLENDED — AND THAT CHANGE WAS FORCED
    # BY A MEASUREMENT, NOT A PREFERENCE. The first cut rated each season separately and blended
    # them n/(n+12). Four games into a season that put 24% weight on a rating built from four
    # games, and an opponent-adjusted margin over four games is almost entirely noise: measured
    # 2026-10-28, the prior-season ratings had sd 5.78 (range -11.6..+11.0) while the
    # current-season ratings had sd 12.40 (range -26.5..+23.5). Blending in a quarter of THAT
    # inflated every projection -- mean |projected margin| 8.15 against the market's 6.50 on the
    # same twelve games, with our favourite bigger on all twelve. That is the shape of complaint
    # this project has already had twice ("all favorites winning by 5-10 more than the spread").
    #
    # Rating both seasons in ONE pass with the current games up-weighted fixes it at the root
    # rather than scaling the output afterwards: a team with four current games is still mostly
    # its 82 prior ones, the weight grows on its own as games accumulate, and the opponent
    # adjustment is solved once across everything instead of twice over two disjoint schedules.
    # No tuned switch-over date, and nothing to re-tune in January.
    #
    # The alternative considered and rejected: fit a scale factor to shrink the output. Measured
    # on 247 held-out games, the best scale was 1.20 and MAE fell monotonically as the scale rose
    # -- the PRIOR-ONLY model is not over-dispersed at all (held-out mean |pred| 6.68 vs the
    # market's 6.50). Scaling would have corrected a symptom the rating did not have, and would
    # have made the model worse everywhere except the opening fortnight.
    allg = prior_games + cur_games
    gw = [1.0] * len(prior_games) + [CUR_GAME_WEIGHT] * len(cur_games)
    rate = ratings(allg, hca, weights=gw)
    r_p = ratings(prior_games, hca_p)
    r_c = ratings(cur_games, hca_c) if cur_games else {}
    lg_p, off_p, def_p = scoring(prior_games)
    lg_c, off_c, def_c = scoring(cur_games) if cur_games else (lg_p, {}, {})
    lg = w * lg_c + (1 - w) * lg_p
    off = blend(off_c, off_p, counts)
    dfn = blend(def_c, def_p, counts)
    return dict(hca=hca, hca_prior=hca_p, hca_cur=hca_c, rate=rate, lg=lg, off=off, dfn=dfn,
                n_prior=len(prior_games), n_cur=len(cur_games))


def predict(m, away, home):
    """(margin for the HOME team, projected total)."""
    margin = m["rate"].get(home, 0.0) - m["rate"].get(away, 0.0) + m["hca"]
    hp = m["lg"] + m["off"].get(home, 0.0) + m["dfn"].get(away, 0.0)
    ap = m["lg"] + m["off"].get(away, 0.0) + m["dfn"].get(home, 0.0)
    return margin, hp + ap


def validate(prior_games, cur_games):
    """Hold out the prior season's last 20% and score the model against the ACTUAL MARGIN.

    🚨 THIS IS NOT A CLOSING-LINE RESULT AND MUST NOT BE REPORTED AS ONE. Beating a naive baseline
    on margin says the rating carries information; beating the market says it carries information
    the market has not already priced. This project's whole history is of the first being true and
    the second not. The second cannot be tested until NBA closing lines accumulate."""
    g = sorted(prior_games)
    cut = int(len(g) * 0.8)
    train, test = g[:cut], g[cut:]
    m = model_from(train, [])
    errs, base_errs, home_errs = [], [], []
    for _, a, h, ap, hp in test:
        actual = hp - ap
        pred, _ = predict(m, a, h)
        errs.append(abs(actual - pred))
        base_errs.append(abs(actual - 0.0))         # baseline 1: a coin-flip game
        home_errs.append(abs(actual - m["hca"]))    # baseline 2: home team by the measured edge
    tot_err, tot_n = [], 0
    for _, a, h, ap, hp in test:
        _, pt = predict(m, a, h)
        tot_err.append(abs((hp + ap) - pt)); tot_n += 1
    print(f"\n# Hold-out validation (prior season, last {len(test)} games, trained on {len(train)})")
    print(f"  measured home court: {m['hca']:+.2f} pts")
    print(f"  {'margin MAE  model':28} {statistics.mean(errs):6.2f}")
    print(f"  {'margin MAE  always pick-em':28} {statistics.mean(base_errs):6.2f}")
    print(f"  {'margin MAE  home by HCA':28} {statistics.mean(home_errs):6.2f}")
    gain = statistics.mean(home_errs) - statistics.mean(errs)
    print(f"  -> model beats the home-court baseline by {gain:+.2f} pts "
          f"({gain / statistics.mean(home_errs) * 100:+.1f}%)")
    print(f"  {'total MAE   model':28} {statistics.mean(tot_err):6.2f}")
    print("\n  NOT a closing-line result. Beating a naive baseline on margin says the rating")
    print("  carries information; beating the market says it carries information the market has")
    print("  not already priced. Only the first is tested here.")
    return statistics.mean(errs), gain


def upcoming(days=8):
    """Scheduled, not-yet-played games from ESPN -- the slate the board projects."""
    out = []
    today = dt.date.today()
    for i in range(days):
        d = today + dt.timedelta(days=i)
        try:
            sb = _get(f"{BASE}/scoreboard?dates={d:%Y%m%d}")
        except Exception:  # noqa: BLE001
            continue
        for ev in sb.get("events", []):
            if ev.get("status", {}).get("type", {}).get("completed"):
                continue
            comp = (ev.get("competitions") or [{}])[0].get("competitors") or []
            h = next((c for c in comp if c.get("homeAway") == "home"), None)
            a = next((c for c in comp if c.get("homeAway") == "away"), None)
            if not h or not a:
                continue
            out.append({"commence": ev["date"], "away": a["team"]["abbreviation"],
                        "home": h["team"]["abbreviation"],
                        "awayName": a["team"]["displayName"], "homeName": h["team"]["displayName"]})
    # One row per matchup; ESPN lists a game under its ET date, so a late tip can appear twice
    # across two queries when the UTC date rolls.
    seen, dedup = set(), []
    for g in sorted(out, key=lambda x: x["commence"]):
        k = (g["away"], g["home"], g["commence"][:10])
        if k in seen:
            continue
        seen.add(k)
        dedup.append(g)
    return dedup


def export(m, games, mae, gain):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    gen = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    rows = []
    for g in games:
        margin, total = predict(m, g["away"], g["home"])
        fav = g["home"] if margin >= 0 else g["away"]
        rows.append({
            "commence": g["commence"], "away": g["away"], "home": g["home"],
            "awayName": g["awayName"], "homeName": g["homeName"],
            "margin": round(margin, 1), "favored": fav,
            "spread": f"{fav} -{abs(margin):.1f}" if abs(margin) >= 0.05 else "pick'em",
            "total": round(total, 1),
        })
    lines = [
        "// AUTO-GENERATED by nba_game_model.py --export -- do not edit by hand.",
        "//",
        "// Line-blind NBA projections: the model never sees the betting line. Opponent-adjusted",
        "// POINT DIFFERENTIAL (never win-loss -- differential subsumes record, CLAUDE.md), with",
        "// the current season shrunk toward last season by n/(n+12), and a MEASURED home court.",
        "//",
        "// 🚨 NOT GRADED AGAINST THE CLOSING LINE. NBA odds capture began 2026-10-26, so there is",
        "// no closing-line history to grade against yet. The hold-out numbers below are against",
        "// the ACTUAL MARGIN, which is a different and weaker claim: beating a naive baseline",
        "// says the rating carries information, beating the market says it carries information",
        "// the market has not already priced. /nba/model says so on its face.",
        f"// Generated {gen}",
        "",
        "export interface NbaModelGame {",
        "  commence: string; away: string; home: string; awayName: string; homeName: string;",
        "  margin: number; favored: string; spread: string; total: number;",
        "}",
        "",
        "/** Hold-out accuracy against the actual margin -- NOT against the closing line. */",
        "export const NBA_MODEL_VALIDATION = {",
        f"  marginMae: {mae:.2f},",
        f"  gainVsHomeCourtBaseline: {gain:.2f},",
        f"  homeCourt: {m['hca']:.2f},",
        f"  priorGames: {m['n_prior']}, currentGames: {m['n_cur']},",
        "  gradedAgainstClosingLine: false,",
        "} as const;",
        "",
        "export const NBA_MODEL: NbaModelGame[] = [",
    ]
    for r in rows:
        lines.append(f"  {json.dumps(r)},")
    lines += ["];", ""]
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"\nwrote {OUT}  ({len(rows)} upcoming games)")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--export", action="store_true")
    ap.add_argument("--days", type=int, default=8)
    a = ap.parse_args(argv)

    prior_games, cur_games = build()
    if not prior_games:
        raise SystemExit("no prior-season games fetched - refusing to build a rating from nothing")

    mae, gain = validate(prior_games, cur_games)
    if a.validate and not a.export:
        return 0

    m = model_from(prior_games, cur_games)
    print(f"\n# Live model")
    print(f"  home court {m['hca']:+.2f} pts (prior {m['hca_prior']:+.2f}, "
          f"current {m['hca_cur']:+.2f} over {m['n_cur']} games)")
    top = sorted(m["rate"].items(), key=lambda kv: -kv[1])[:5]
    bot = sorted(m["rate"].items(), key=lambda kv: kv[1])[:3]
    print(f"  best:  " + ", ".join(f"{t} {v:+.1f}" for t, v in top))
    print(f"  worst: " + ", ".join(f"{t} {v:+.1f}" for t, v in bot))
    games = upcoming(a.days)
    print(f"  {len(games)} upcoming games in the next {a.days} days")
    for g in games[:4]:
        mg, tt = predict(m, g["away"], g["home"])
        fav = g["home"] if mg >= 0 else g["away"]
        print(f"    {g['away']} @ {g['home']}  {g['commence'][:10]}  "
              f"{fav} -{abs(mg):.1f}   total {tt:.1f}")
    if a.export:
        export(m, games, mae, gain)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
