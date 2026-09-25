"""
Grading & calibration engine — the payoff of the trust engine.

Two modes:

  # VALIDATE the calibration math today, against historical seasons (no DB):
  python grade_predictions.py --backtest

  # LIVE: grade locked Model predictions whose games are final, write prediction_results:
  python grade_predictions.py --live            # dry run (prints what it would grade)
  python grade_predictions.py --live --write    # append grades (permanent)

The line-blind model publishes a win probability per game, locked before kickoff
(publish_predictions.py). After a game is final this reads the result, records
whether the favored side won, and the public_calibration view aggregates it into
"when we say 60%, does it hit ~60%?" — the honest, not-lucky check anyone can audit.

Calibration is on the FAVORED team's win probability (always >= 0.5).
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

import numpy as np
import pandas as pd

import odds_client as oc

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "analysis"))
import game_model as gm  # noqa: E402

GAMES_LOCAL = os.path.join("data", "games.csv")
BUCKETS = [(0.50, 0.55), (0.55, 0.60), (0.60, 0.65), (0.65, 0.70),
           (0.70, 0.75), (0.75, 0.80), (0.80, 0.90), (0.90, 1.01)]


# ---------- shared grading math ----------

def grade_game(fav, home, home_margin, model_prob_home, pred_margin_home):
    """Return (fav_prob, fav_won, pred_fav_margin, actual_fav_margin) or None for a push."""
    if home_margin == 0:
        return None  # push — not a win/loss for calibration
    fav_is_home = fav == home
    fav_prob = model_prob_home if fav_is_home else 1.0 - model_prob_home
    fav_won = (home_margin > 0) if fav_is_home else (home_margin < 0)
    actual_fav_margin = home_margin if fav_is_home else -home_margin
    pred_fav_margin = abs(pred_margin_home)
    return fav_prob, bool(fav_won), pred_fav_margin, actual_fav_margin


def calibration_table(df):
    """df has columns fav_prob, fav_won. Print a bucketed reliability table + summary."""
    print(f"\n{'predicted':>12}{'actual':>9}{'n':>7}{'gap':>8}")
    for lo, hi in BUCKETS:
        sel = df[(df.fav_prob >= lo) & (df.fav_prob < hi)]
        if not len(sel):
            continue
        mp, ma, n = sel.fav_prob.mean(), sel.fav_won.mean(), len(sel)
        print(f"{mp*100:>11.1f}%{ma*100:>8.1f}%{n:>7}{(ma-mp)*100:>+7.1f}")
    brier = float(np.mean((df.fav_prob - df.fav_won.astype(float)) ** 2))
    print(f"\n  n={len(df):,}  overall predicted {df.fav_prob.mean()*100:.1f}%  "
          f"actual {df.fav_won.mean()*100:.1f}%  (calibration-in-the-large)")
    print(f"  Brier score: {brier:.4f}  (0=perfect, 0.25=coin flip at 50%)")


# ---------- backtest (validation, no DB) ----------

def backtest(seasons):
    g = pd.read_csv(GAMES_LOCAL, low_memory=False)
    rows = []
    for season in seasons:
        prior = gm.ratings(g, season - 1)
        if not prior:
            continue
        curve = gm.model_win_curve(g, before_season=season)  # self-calibrated on prior seasons
        s = g[(g.season == season) & (g.game_type == "REG") & g.home_score.notna()]
        for _, r in s.iterrows():
            h, a = r.home_team, r.away_team
            neutral = str(r.get("location")) == "Neutral"
            hfa = 0.0 if neutral else gm.HFA
            margin = gm.REGRESS * (prior.get(h, 0.0) - prior.get(a, 0.0)) + hfa
            fav = h if margin >= 0 else a
            p_home = gm.winprob(abs(margin), curve) if margin >= 0 else 1 - gm.winprob(abs(margin), curve)
            graded = grade_game(fav, h, r.home_score - r.away_score, p_home, margin)
            if graded is None:
                continue
            rows.append({"fav_prob": graded[0], "fav_won": graded[1]})
    df = pd.DataFrame(rows)
    print(f"Backtest — model {gm.MODEL_VERSION}, seasons {min(seasons)}-{max(seasons)}")
    calibration_table(df)


# ---------- live grading (reads ledger + results, writes grades) ----------

def _get(env, table, query):
    """PostgREST read, PAGED.

    A `limit=` in the query string does NOT raise the ceiling: the server caps every response at
    1000 rows, so `&limit=10000` returns 1000 and looks complete. That matters most for the
    `graded` set below — it is the dedupe of prediction_ids already scored, so a truncated read
    would silently re-grade predictions and write duplicate rows into the published track record.
    Paging until a short page arrives is the only read that is safe as the ledger grows."""
    key = env["SUPABASE_SERVICE_KEY"]
    base = f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/{table}{query}"
    out, PAGE, off = [], 1000, 0
    while True:
        req = urllib.request.Request(base, headers={"apikey": key, "Authorization": f"Bearer {key}",
                                                    "Range-Unit": "items",
                                                    "Range": f"{off}-{off + PAGE - 1}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            page = json.loads(r.read())
        out += page
        if len(page) < PAGE:
            return out
        off += PAGE


def fetch_fresh_games():
    """Download the latest nflverse games.csv (updated with results during the season).
    Returns None on a transient fetch failure so the caller can fall back / skip."""
    oc.ensure_ssl_certs()
    req = urllib.request.Request(oc.GAMES_URL, headers={"User-Agent": "statseer/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except (urllib.error.URLError, urllib.error.HTTPError):
        return None
    # `data/` is gitignored, so on a fresh CI checkout the DIRECTORY does not exist and this open()
    # raised FileNotFoundError -- which the transient guard above doesn't catch (it only covers
    # network errors), so the run died with a traceback and emailed a FAILURE even though the
    # download had succeeded. Every other script writing under data/ already does this.
    os.makedirs(os.path.dirname(GAMES_LOCAL) or ".", exist_ok=True)
    with open(GAMES_LOCAL, "wb") as fh:
        fh.write(data)
    return pd.read_csv(GAMES_LOCAL, low_memory=False)


def live(write, fetch):
    env = oc.load_env()
    oc.ensure_ssl_certs()
    if fetch:
        g = fetch_fresh_games()
        if g is None:   # transient fetch failure — use local copy, or skip today
            if os.path.exists(GAMES_LOCAL):
                print("games.csv fetch failed (transient) — using local copy")
                g = pd.read_csv(GAMES_LOCAL, low_memory=False)
            else:
                print("games.csv fetch failed (transient) and no local copy — skipping today")
                return 0
    else:
        g = pd.read_csv(GAMES_LOCAL, low_memory=False)

    # subject is the HOME team; model_prob is P(home wins). We grade WIN/LOSS on the
    # home team so it lines up with the public_calibration view (which calibrates
    # model_prob against the home outcome).
    # Only grade the current model version — superseded versions (e.g. the pre-
    # calibration v1) stay in the ledger as an audit trail but out of the record.
    try:
        preds = _get(env, "prediction_ledger",
                     f"?section=eq.MODEL&model_version=eq.{gm.MODEL_VERSION}"
                     "&select=id,event_id,season,week,subject,model_prob,published_at"
                     "&order=published_at&limit=5000")
        # One grade per GAME, not per ledger row. A game is republished when its number moves
        # (see publish_predictions.REVISE_MARGIN), so grading every row would count the same game
        # two or three times and quietly inflate the published record -- the opposite of what the
        # ledger exists for. Ascending by published_at, the last row per game wins: the number we
        # actually stood behind going into kickoff. The superseded rows stay unGRADED, not deleted.
        _latest = {}
        for _r in preds:
            _latest[(_r["event_id"], _r["subject"])] = _r
        preds = list(_latest.values())
        graded = {r["prediction_id"] for r in
                  _get(env, "prediction_results", "?select=prediction_id&limit=10000")}
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        # Transient Supabase read failure — skip today rather than email a FAILURE.
        # A persistent outage just means grades land on the next daily run.
        print(f"Supabase read failed (transient): {e} — skipping today")
        return 0

    fin = g[g.home_score.notna()]
    results = {(int(r.season), int(r.week), r.home_team): r for _, r in fin.iterrows()}

    new_rows, pending, done = [], 0, 0
    for p in preds:
        if p["id"] in graded:
            done += 1
            continue
        game = results.get((int(p["season"]), int(p["week"]), p["subject"]))
        if game is None:
            pending += 1  # not final yet
            continue
        margin = game.home_score - game.away_score  # home perspective
        outcome = "PUSH" if margin == 0 else ("WIN" if margin > 0 else "LOSS")
        new_rows.append({"prediction_id": p["id"], "outcome": outcome})

    print(f"grading MODEL predictions: {len(new_rows)} newly final, "
          f"{pending} pending (not played), {done} already graded")
    for p, r in zip((x for x in preds if x["id"] in {n["prediction_id"] for n in new_rows}), new_rows):
        print(f"  + {p['subject']} (home, model {float(p['model_prob'])*100:.0f}%): {r['outcome']}")

    if not write:
        print("\nDRY RUN — nothing written. Add --write to append grades.")
        return 0
    if not new_rows:
        print("\nnothing new to grade.")
        return 0

    endpoint = (f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/prediction_results"
                "?on_conflict=prediction_id")
    key = env["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(
        endpoint, data=json.dumps(new_rows).encode("utf-8"),
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "Prefer": "return=minimal,resolution=ignore-duplicates"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            ok = r.getcode() in (200, 201, 204)
        print(f"\nappended {len(new_rows)} grades" if ok else "\nwrite failed")
    except urllib.error.HTTPError as e:
        print(f"\nWRITE FAILED {e.code}: {e.read().decode()[:400]}", file=sys.stderr)
        return 1
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--backtest", action="store_true", help="validate calibration on past seasons")
    ap.add_argument("--live", action="store_true", help="grade locked predictions from the ledger")
    ap.add_argument("--write", action="store_true", help="append grades (live mode)")
    ap.add_argument("--no-fetch", action="store_true", help="don't download fresh games.csv (live)")
    ap.add_argument("--seasons", default="2021-2025", help="backtest season range")
    args = ap.parse_args(argv)

    if args.backtest:
        lo, hi = (int(x) for x in args.seasons.split("-"))
        backtest(range(lo, hi + 1))
        return 0
    if args.live:
        return live(args.write, not args.no_fetch)
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
