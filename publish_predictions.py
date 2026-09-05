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
import datetime
import json
import os
import sys
import urllib.error
import urllib.parse
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


GAMES_LOCAL = "data/games.csv"


def load_games():
    """nflverse games.csv — the schedule + results the model predicts from.

    Fetched here rather than assumed present: data/ is gitignored, so on a fresh runner the file
    AND its directory are absent. Mirrors grade_predictions.fetch_fresh_games() — same canonical
    URL (oc.GAMES_URL), same makedirs, same transient-failure contract.

    Returns None on a network blip so a scheduled run skips the day and exits 0 instead of emailing
    a failure; a genuine problem still surfaces on the Supabase calls, which are not guarded."""
    oc.ensure_ssl_certs()
    req = urllib.request.Request(oc.GAMES_URL, headers={"User-Agent": "statseer/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except (urllib.error.URLError, urllib.error.HTTPError):
        if os.path.exists(GAMES_LOCAL):          # fall back to the copy we already have
            return pd.read_csv(GAMES_LOCAL, low_memory=False)
        return None
    os.makedirs(os.path.dirname(GAMES_LOCAL) or ".", exist_ok=True)
    with open(GAMES_LOCAL, "wb") as fh:
        fh.write(data)
    return pd.read_csv(GAMES_LOCAL, low_memory=False)


def current_week(env, season):
    """The nearest week that still has a game to come — the same rule the site's week nav uses
    (`currentWeek()` in web/lib/board.ts): the lowest week with a kickoff still in the future.

    This is what makes a DAILY cron correct without a hardcoded week. The week only rolls forward
    once the last game of the current week has kicked off, so week N+1 becomes publishable on the
    Monday night / Tuesday after week N finishes -- comfortably before its own Thursday kickoff,
    which the ledger requires (published_at < commence_time is enforced at the database).

    Returns None when no future game has odds yet; the caller treats that as "nothing to do today"
    rather than an error, so the run is a clean no-op and retries tomorrow."""
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    rows = _get(env, "odds_snapshots",
                f"?season=eq.{season}&commence_time=gt.{urllib.parse.quote(now)}"
                "&select=week&order=week.asc&limit=1")
    return rows[0]["week"] if rows else None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--week", default="auto",
                    help="week number, or 'auto' (default) for the nearest week with a game to come")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args(argv)

    env = oc.load_env()
    oc.ensure_ssl_certs()

    if str(args.week).lower() == "auto":
        week = current_week(env, args.season)
        if week is None:
            print(f"No upcoming {args.season} game has odds captured yet — nothing to publish.")
            return 0
        print(f"auto week -> {week}")
    else:
        week = int(args.week)

    g = load_games()
    if g is None:
        print("games.csv unavailable (transient) — skipping today; the next run retries.")
        return 0
    preds = gm.predict_week(g, args.season, week)
    emap = event_map(env, args.season, week)
    done = already_published(env, gm.MODEL_VERSION, args.season, week)

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
            "commence_time": commence, "season": args.season, "week": week,
            "event_id": eid, "section": "MODEL", "model_version": gm.MODEL_VERSION,
            "market": "h2h", "subject": p["home"],  # P(home team wins)
            "model_prob": round(p["home_winprob"], 4),
            "tier": "NO_BET",  # a prediction, not a bet recommendation
            "reasoning": {"pred_margin": p["pred_margin"], "favored": p["fav"],
                          "neutral": p["neutral"], "venue": p["venue"]},
        })

    print(f"MODEL {gm.MODEL_VERSION} — {args.season} Week {week}")
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
