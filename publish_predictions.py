"""
Publish line-blind Model predictions to prediction_ledger.

The ledger is the trust engine: write-once, append-only, published_at < commence_time
enforced at the DB, UPDATE/DELETE revoked. Once published, a prediction is locked and
calibration holds the model to it. This script publishes each game's model win
probability (for the HOME team) BEFORE kickoff.

    python publish_predictions.py --week 1            # dry run
    python publish_predictions.py --week 1 --write    # publish (permanent)

Re-running is safe: it skips games already published for this model_version + week
(the ledger has no UPDATE/DELETE, so we must not double-insert).
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

import pandas as pd

import odds_client as oc

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "analysis"))
import game_model as gm  # noqa: E402


def _get(env, table, query):
    url = f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/{table}{query}"
    key = env["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def event_map(env, season, week):
    """(home_abbr, away_abbr) -> (event_id, commence_time), from odds_snapshots."""
    rows = _get(env, "odds_snapshots",
                f"?season=eq.{season}&week=eq.{week}"
                "&select=event_id,home_team,away_team,commence_time&limit=5000")
    return {(r["home_team"], r["away_team"]): (r["event_id"], r["commence_time"]) for r in rows}


def already_published(env, model_version, season, week):
    rows = _get(env, "prediction_ledger",
                f"?season=eq.{season}&week=eq.{week}"
                f"&model_version=eq.{model_version}&select=event_id&limit=5000")
    return {r["event_id"] for r in rows}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--week", type=int, default=1)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args(argv)

    env = oc.load_env()
    oc.ensure_ssl_certs()
    g = pd.read_csv("data/games.csv", low_memory=False)
    preds = gm.predict_week(g, args.season, args.week)
    emap = event_map(env, args.season, args.week)
    done = already_published(env, gm.MODEL_VERSION, args.season, args.week)

    rows, skipped = [], []
    for p in preds:
        eid_meta = emap.get((p["home"], p["away"]))
        if not eid_meta:
            skipped.append(f"no event_id: {p['away']}@{p['home']}")
            continue
        eid, commence = eid_meta
        if eid in done:
            skipped.append(f"already published: {p['away']}@{p['home']}")
            continue
        rows.append({
            "commence_time": commence, "season": args.season, "week": args.week,
            "event_id": eid, "section": "MODEL", "model_version": gm.MODEL_VERSION,
            "market": "h2h", "subject": p["home"],  # P(home team wins)
            "model_prob": round(p["home_winprob"], 4),
            "tier": "NO_BET",  # a prediction, not a bet recommendation
            "reasoning": {"pred_margin": p["pred_margin"], "favored": p["fav"],
                          "neutral": p["neutral"], "venue": p["venue"]},
        })

    print(f"MODEL {gm.MODEL_VERSION} — {args.season} Week {args.week}")
    print(f"  to publish: {len(rows)}   skipped: {len(skipped)}")
    for s in skipped:
        print(f"    - {s}")
    for r in rows[:3]:
        print(f"    + {r['subject']} home win {100*r['model_prob']:.1f}%  ({r['event_id']})")

    if not args.write:
        print("\nDRY RUN — nothing written. Add --write to publish (permanent).")
        return 0
    if not rows:
        print("\nnothing new to publish.")
        return 0

    endpoint = f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/prediction_ledger"
    key = env["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(
        endpoint, data=json.dumps(rows).encode("utf-8"),
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            ok = r.getcode() in (200, 201, 204)
        print(f"\npublished {len(rows)} predictions to prediction_ledger" if ok else "\nwrite failed")
    except urllib.error.HTTPError as e:
        print(f"\nWRITE FAILED {e.code}: {e.read().decode()[:400]}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
