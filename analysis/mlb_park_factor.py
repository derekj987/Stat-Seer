"""Does the STADIUM belong in the MLB run model?

Derek: "We have to look at team strength, defense, pitching, stadium, etc."

Park is the one on that list the model has never had. mlb_game_model's held-out card lists what was
tried and rejected -- lineup strength, bullpen, recent form, home field -- and the venue is not on
it. That is a gap worth closing or closing out, because park factor is the single best-established
effect on run scoring in baseball, and the model currently beats a flat league-mean guess by 0.8%.

THE TEST. A park factor is only worth shipping if it predicts runs OUT OF SAMPLE, so:

    train   games before the split date   -> fit one factor per venue, choose the regression
    held    games on or after it          -> report only

Both against the same baseline the model reports against: guessing the league mean every time.
A factor fitted and scored on the same games always looks good; this project has manufactured a
signal that way before (depth-chart movement, +0.85 pooled -> +0.10 split).

REGRESSION. A venue with 40 games is a small sample against a 4.3-run standard deviation, so the
raw ratio is mostly noise. Each factor is pulled toward 1.0 by n / (n + K), and K is swept on the
TRAIN split alone.

RESULT (2026-09-25, split 2026-08-01) — PARK DOES NOT SHIP.

The effect is real and the factors are physically right: Coors Field 1.184 at the top, T-Mobile
0.870 and Petco 0.898 at the bottom, 3.0 runs between the extremes. Nothing wrong with the
measurement. But:

    against a flat league mean      train +2.05%   held-out  +0.33%
    ON TOP OF THE MODEL             train +1.45%   held-out  -0.13%

On top of the model it is NEGATIVE out of sample. The reason is that the model's team rates are
already park-contaminated: a club plays half its games in its own stadium, so its offence and
defence rates carry that stadium inside them, and multiplying by an explicit park factor counts it
twice. The train number looks like a win for exactly the reason the train number always looks like
a win — this project has manufactured a signal that way before (depth-chart movement, +0.85 pooled
against +0.10 split).

So the answer to "we have to look at ... stadium" is that the stadium IS in the model, implicitly,
and bolting an explicit factor on top makes it worse.

WHAT WOULD ACTUALLY TEST IT. Park-adjust the team rates FIRST — divide each club's runs
scored/allowed by the factor of the park each game was played in, so the rates describe the team
rather than the team-plus-its-stadium — and only then apply the venue factor at projection time.
That is a change to State, not a multiplier bolted on the end, and it is the only version of this
worth building. Until someone does that, this file's finding stands: no park factor.

    python analysis/mlb_park_factor.py
    python analysis/mlb_park_factor.py --vs-model --split 2026-08-01
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import statistics as st
import sys
import urllib.request
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "analysis"))
sys.path.insert(0, ROOT)

API = "https://statsapi.mlb.com/api/v1"
SEASON = 2026
KS = [0, 20, 40, 80, 150, 300, 600]
CACHE = os.path.join(ROOT, "data", f"mlb_park_games_{SEASON}.json")


def load_games(refresh=False):
    """(date, venue, home, away, total runs) for every completed regular-season game."""
    if os.path.exists(CACHE) and not refresh:
        return json.load(open(CACHE, encoding="utf-8"))
    try:
        import odds_client as oc
        oc.ensure_ssl_certs()
    except Exception:  # noqa: BLE001
        pass
    out = []
    d, end = dt.date(SEASON, 3, 1), dt.date.today()
    while d <= end:
        hi = min(d + dt.timedelta(days=20), end)
        u = f"{API}/schedule?sportId=1&startDate={d}&endDate={hi}&gameType=R"
        j = json.load(urllib.request.urlopen(u, timeout=90))
        for day in j.get("dates", []):
            for g in day.get("games", []):
                if g.get("status", {}).get("abstractGameState") != "Final":
                    continue
                try:
                    out.append({
                        "date": g["gameDate"][:10],
                        "pk": str(g["gamePk"]),
                        "venue": (g.get("venue") or {}).get("name") or "?",
                        "home": g["teams"]["home"]["team"]["name"],
                        "away": g["teams"]["away"]["team"]["name"],
                        "runs": g["teams"]["home"]["score"] + g["teams"]["away"]["score"],
                    })
                except KeyError:
                    continue
        d = hi + dt.timedelta(days=1)
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    json.dump(out, open(CACHE, "w", encoding="utf-8"))
    return out


def factors(rows, k):
    """{venue: multiplier} regressed toward 1.0 by n / (n + k)."""
    lg = st.mean(r["runs"] for r in rows)
    by = defaultdict(list)
    for r in rows:
        by[r["venue"]].append(r["runs"])
    out = {}
    for v, rs in by.items():
        raw = st.mean(rs) / lg
        w = len(rs) / (len(rs) + k) if (len(rs) + k) else 0.0
        out[v] = 1.0 + w * (raw - 1.0)
    return out, lg


def mae(rows, predict):
    return st.mean(abs(r["runs"] - predict(r)) for r in rows)


def vs_model(rows, split):
    """The question that decides shipping: does park add anything ON TOP of the model?

    Against a flat league mean park is worth a little. But the model already carries each club's
    offence and defence and the starting pitcher, and a club plays half its games in its own park —
    so part of the park effect may already be inside those team rates, and measuring park against
    the league mean would then double-count it.

    The honest test is the model's OWN residual: at this venue, what is actual ÷ projected? Fitted
    on the train split, applied to held-out. The walk below reproduces mlb_game_model.validate()
    exactly — State.advance after every game — so no projection sees its own result."""
    import collections
    import datetime as _dt

    import mlb_availability as av
    import mlb_game_model as M

    venue = {r["pk"]: r["venue"] for r in rows}
    lineups = av.season_lineups(_dt.date(M.SEASON, 3, 20), _dt.date.today())
    starters = {(r["gamePk"], r["team"]): r["sp"] for r in lineups if r.get("sp")}
    trows = M.team_runs()
    sp = M.sp_runs(sorted({v for v in starters.values() if v}))
    spby = collections.defaultdict(list)
    for r in sp:
        spby[(r["date"], r["pid"])].append(r)
    games = M.pair_games(trows, starters)
    prior = M.prior_rates(M.prior_team_runs())
    state = M.State(games, *prior)

    recs = []
    for g in games:
        p = state.project(g["home"], g["away"], g["hsp"], g["asp"])
        v = venue.get(str(g["pk"]))
        if p and v:
            recs.append({"date": g["date"], "venue": v, "y": g["total"], "p": p["total"]})
        state.advance(g, spby)

    tr = [r for r in recs if r["date"] < split]
    ho = [r for r in recs if r["date"] >= split]
    print(f"\n=== PARK ON TOP OF THE MODEL ===")
    print(f"{len(recs):,} projected games — train {len(tr):,}, held-out {len(ho):,}")
    if len(tr) < 400 or len(ho) < 150:
        print("  not enough on one side of the split")
        return

    # mae() above keys the truth on "runs"; these records use "y".
    def mae2(rs, predict):
        return st.mean(abs(r["y"] - predict(r)) for r in rs)

    def resid_factors(rs, k):
        by = collections.defaultdict(list)
        for r in rs:
            if r["p"]:
                by[r["venue"]].append(r["y"] / r["p"])
        return {v: 1.0 + (len(x) / (len(x) + k)) * (st.mean(x) - 1.0) for v, x in by.items()}

    base = mae2(tr, lambda r: r["p"])
    print(f"\n  {'K':>5s} {'train MAE':>10s} {'vs model':>9s}")
    best = None
    for k in KS:
        f = resid_factors(tr, k)
        m = mae2(tr, lambda r: r["p"] * f.get(r["venue"], 1.0))
        print(f"  {k:5d} {m:10.4f} {(base - m) / base * 100:+8.2f}%")
        if best is None or m < best[1]:
            best = (k, m)
    k = best[0]
    f = resid_factors(tr, k)
    b_ho = mae2(ho, lambda r: r["p"])
    p_ho = mae2(ho, lambda r: r["p"] * f.get(r["venue"], 1.0))
    print(f"\n  chosen on train: K = {k}")
    print(f"  HELD OUT  model alone   MAE {b_ho:.4f}")
    print(f"            model x park  MAE {p_ho:.4f}   {(b_ho - p_ho) / b_ho * 100:+.2f}%")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default=f"{SEASON}-08-01",
                    help="first date of the held-out period")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--vs-model", action="store_true",
                    help="also test park ON TOP of the model, not just against the league mean")
    args = ap.parse_args()

    rows = load_games(args.refresh)
    tr = [r for r in rows if r["date"] < args.split]
    ho = [r for r in rows if r["date"] >= args.split]
    print(f"{len(rows):,} completed {SEASON} games — train {len(tr):,} (before {args.split}), "
          f"held-out {len(ho):,}")
    if len(tr) < 500 or len(ho) < 200:
        print("not enough games on one side of the split to choose anything")
        return 0

    lg_tr = st.mean(r["runs"] for r in tr)
    print(f"league mean on train: {lg_tr:.3f} runs\n")

    print(f"  {'K':>5s} {'train MAE':>10s} {'vs mean':>9s}")
    base_tr = mae(tr, lambda r: lg_tr)
    best = None
    for k in KS:
        f, _ = factors(tr, k)
        m = mae(tr, lambda r: lg_tr * f.get(r["venue"], 1.0))
        gain = (base_tr - m) / base_tr * 100
        print(f"  {k:5d} {m:10.4f} {gain:+8.2f}%")
        if best is None or m < best[1]:
            best = (k, m)
    k = best[0]
    print(f"\n  chosen on train: K = {k}")

    # HELD OUT — the factors are the train ones, untouched.
    f, _ = factors(tr, k)
    base_ho = mae(ho, lambda r: lg_tr)
    park_ho = mae(ho, lambda r: lg_tr * f.get(r["venue"], 1.0))
    gain = (base_ho - park_ho) / base_ho * 100
    print(f"\nHELD OUT ({len(ho):,} games from {args.split})")
    print(f"  league mean every game : MAE {base_ho:.4f}")
    print(f"  league mean x park     : MAE {park_ho:.4f}   {gain:+.2f}%")
    print(f"\n  the model's own held-out gain over the same baseline is +0.8%")

    spread = sorted(f.items(), key=lambda kv: -kv[1])
    print(f"\n  park factors, K={k} (train only) — widest {len(spread)} venues")
    for v, x in spread[:5]:
        print(f"    {v[:34]:34s} {x:.3f}")
    print("    ...")
    for v, x in spread[-5:]:
        print(f"    {v[:34]:34s} {x:.3f}")
    print(f"\n  spread {spread[-1][1]:.3f} .. {spread[0][1]:.3f}  "
          f"= {(spread[0][1] - spread[-1][1]) * lg_tr:.2f} runs between the extremes")
    if args.vs_model:
        vs_model(rows, args.split)
    return 0


if __name__ == "__main__":
    sys.exit(main())
