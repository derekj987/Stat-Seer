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
    """PostgREST read, PAGED.

    A `limit=` in the query string does NOT raise the ceiling: the server caps every response at
    1000 rows, so `&limit=5000` returns 1000 and looks complete. Page until a short page arrives."""
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
        if off >= 200000:
            print(f"  WARNING: _get stopped at {off} rows for {table} — result may be partial")
            return out


def event_map(env, season, week):
    """(home_abbr, away_abbr) -> (event_id, commence_time), from odds_snapshots.

    PINNED to one snapshot. This read used to be the whole week unfiltered with `limit=5000`, which
    matched 138,340 rows for 2026 week 1 and returned the first 1,000. odds_snapshots holds one row
    per book per market per capture, roughly 8,600 rows per game, so 1,000 rows covered about ONE
    game — every other game fell out of the map and was skipped as "no event_id". The publisher
    would have published almost nothing on its first scheduled run.

    One snapshot is all this needs: it only wants each game's event_id and kickoff, which do not
    change between captures. Paging on top means it stays correct as a single snapshot grows past
    1,000 rows (a Week 1 sweep is already 1,042)."""
    latest = _get(env, "odds_snapshots",
                  f"?season=eq.{season}&week=eq.{week}"
                  "&capture_reason=in.(SCHEDULED,MANUAL)"
                  "&select=snapshot_at&order=snapshot_at.desc&limit=1")
    if not latest:
        return {}
    snap = urllib.parse.quote(latest[0]["snapshot_at"])
    rows = _get(env, "odds_snapshots",
                f"?season=eq.{season}&week=eq.{week}&snapshot_at=eq.{snap}"
                "&select=event_id,home_team,away_team,commence_time")
    return {(r["home_team"], r["away_team"]): (r["event_id"], r["commence_time"]) for r in rows}


def already_published(env, model_version, season, week):
    rows = _get(env, "prediction_ledger",
                f"?season=eq.{season}&week=eq.{week}"
                f"&model_version=eq.{model_version}&select=event_id")
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
    # Log what the injury correction did before publishing. An adjustment that silently moves a
    # published, locked number is the kind of thing that should never be discovered later from a
    # diff — the same reason the off-team drops are printed rather than appended to a list nobody
    # reads. Prints "none available" in the preseason, which is also worth seeing.
    try:
        import injury_adj
        print(injury_adj.describe(args.season, week))
    except Exception as e:                       # noqa: BLE001 — never block a publish on the log
        print(f"  injury adjustment: unavailable ({e})")

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
