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
    curve = gm.win_curve(g)
    rows = []
    for season in seasons:
        prior = gm.ratings(g, season - 1)
        if not prior:
            continue
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
    url = f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/{table}{query}"
    key = env["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def fetch_fresh_games():
    """Download the latest nflverse games.csv (updated with results during the season)."""
    oc.ensure_ssl_certs()
    req = urllib.request.Request(oc.GAMES_URL, headers={"User-Agent": "statseer/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    with open(GAMES_LOCAL, "wb") as fh:
        fh.write(data)
    return pd.read_csv(GAMES_LOCAL, low_memory=False)


def live(write, fetch):
    env = oc.load_env()
    oc.ensure_ssl_certs()
    g = fetch_fresh_games() if fetch else pd.read_csv(GAMES_LOCAL, low_memory=False)

    # subject is the HOME team; model_prob is P(home wins). We grade WIN/LOSS on the
    # home team so it lines up with the public_calibration view (which calibrates
    # model_prob against the home outcome).
    preds = _get(env, "prediction_ledger",
                 "?section=eq.MODEL&select=id,event_id,season,week,subject,model_prob&limit=5000")
    graded = {r["prediction_id"] for r in
              _get(env, "prediction_results", "?select=prediction_id&limit=10000")}

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
