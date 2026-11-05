"""
Publish line-blind Model predictions to prediction_ledger.

The ledger is the trust engine: write-once, append-only, published_at < commence_time
enforced at the DB, UPDATE/DELETE revoked. Once published, a prediction is locked and
calibration holds the model to it. This script publishes each game's model win
probability (for the HOME team) BEFORE kickoff.

    python publish_predictions.py --week 1            # dry run
    python publish_predictions.py --week 1 --write    # publish (permanent)

Re-running is safe: a game already on the ledger is republished only when the model's
margin has moved by REVISE_MARGIN or more, and always as a NEW row -- never an overwrite
(the ledger has no UPDATE/DELETE, so we must not double-insert).
"""
import argparse
import datetime
import json
import os
import sys
import time
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
        # Retry a 5xx a couple of times before giving up. Supabase answers a heavy read with a 500
        # rather than a timeout, and one of those killed the whole run on four consecutive days.
        # The scan that caused those is fixed in current_week(), but a transient 500 under load is
        # normal on this instance and should cost a few seconds, not a day's publish.
        page = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    page = json.loads(r.read())
                break
            except urllib.error.HTTPError as e:
                if e.code < 500 or attempt == 2:
                    raise
                print(f"  {table}: HTTP {e.code}, retrying ({attempt + 1}/2)")
                time.sleep(3 * (attempt + 1))
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


# How far the model's margin has to move before we publish a REVISION. Below this a game is left
# alone, so the ledger does not fill with noise from a rating drifting a tenth of a point.
REVISE_MARGIN = 0.75


def published_so_far(env, model_version, season, week):
    """{event_id: (published_at, pred_margin)} for the NEWEST row we have on each game."""
    rows = _get(env, "prediction_ledger",
                f"?season=eq.{season}&week=eq.{week}"
                f"&model_version=eq.{model_version}"
                "&select=event_id,published_at,reasoning&order=published_at.asc")
    out = {}
    for r in rows:                                # ascending, so the last write per key wins
        margin = (r.get("reasoning") or {}).get("pred_margin")
        out[r["event_id"]] = (r.get("published_at"), margin)
    return out


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


def current_week(games, season):
    """The lowest week of `season` that still has a game to come, from the SCHEDULE.

    🚨 THIS USED TO ASK odds_snapshots, AND THAT WAS THE WRONG SOURCE FOR THE QUESTION. Four
    separate fixes went into that query -- the range expressed as two bare filters on one column,
    a filter on the unindexed `collected_at`, a fortnight-wide read paged for a single minimum,
    and the retry budget -- and the fifth dispatch still returned HTTP 500 on a `limit=1` indexed
    lookup that runs 10/10 clean from a laptop in 0.18-0.47s. Each fix was real and none was
    sufficient, because the dependency itself was wrong: "which week is it?" was being asked of a
    1.3M-row snapshot table that has to be fast enough to answer, from a runner that evidently
    gets different treatment than a laptop does.

    Four consecutive scheduled runs failed on it, so NFL week 9 went unpublished and the Model
    Spread column sat blank on the live site -- the whole visible symptom traced back to asking
    the odds table a question the schedule answers.

    WHICH WEEK IT IS, IS A SCHEDULE FACT. games.csv is downloaded by this script anyway, cached on
    disk, and already the source every other part of this run trusts for kickoff times. One pandas
    comparison, no network, nothing that can 500.

    Kickoff times are Eastern in nflverse's feed (`gameday` + `gametime`), so they are localised
    before comparing against now. A row with no gametime yet -- a late-season slot the league has
    not assigned -- defaults to 13:00 ET, which is the earliest an NFL game realistically starts
    and therefore errs toward treating the week as still live rather than skipping past it.

    Returns None when no game of the season is still to come, which the caller treats as "nothing
    to do" rather than an error.
    """
    rows = games[games["season"] == season]
    if rows.empty:
        return None
    kick = pd.to_datetime(
        rows["gameday"].astype(str) + " " + rows["gametime"].fillna("13:00").astype(str),
        errors="coerce",
    ).dt.tz_localize("America/New_York", nonexistent="shift_forward", ambiguous="NaT")
    future = rows.assign(_kick=kick)
    future = future[future["_kick"] > pd.Timestamp.now(tz="UTC")]
    if future.empty:
        return None
    return int(future.loc[future["_kick"].idxmin(), "week"])


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--week", default="auto",
                    help="week number, or 'auto' (default) for the nearest week with a game to come")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args(argv)

    env = oc.load_env()
    oc.ensure_ssl_certs()

    # 🚨 THE SCHEDULE IS LOADED FIRST NOW, BECAUSE THE WEEK COMES FROM IT. It used to come from
    # odds_snapshots, which made "which week is it?" depend on a 1.3M-row snapshot table being
    # fast enough to answer -- and on a GitHub runner it repeatedly was not. FOUR fixes went into
    # that query (shape, an unindexed column, read size, retries) and the fifth dispatch still
    # 500'd on a limit=1 indexed lookup that runs 10/10 clean from a laptop. At that point the
    # query was not the problem: the dependency was.
    #
    # Which week it is, is a SCHEDULE fact. games.csv is already downloaded by this very script a
    # few lines below, already cached on disk, and already the source every other part of the run
    # trusts for kickoff times. Asking it costs one pandas comparison and cannot 500.
    g = load_games()
    if g is None:
        print("games.csv unavailable (transient) — skipping today; the next run retries.")
        return 0

    if str(args.week).lower() == "auto":
        week = current_week(g, args.season)
        if week is None:
            print(f"No {args.season} game is still to come — nothing to publish.")
            return 0
        print(f"auto week -> {week}")
    else:
        week = int(args.week)
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
    done = published_so_far(env, gm.MODEL_VERSION, args.season, week)

    rows, skipped, revised = [], [], []
    for p in preds:
        eid_meta = emap.get((p["home"], p["away"]))
        if not eid_meta:
            skipped.append(f"no event_id: {p['away']}@{p['home']}")
            continue
        eid, commence = eid_meta
        prev = done.get(eid)
        if prev is not None:
            # A game already on the ledger is REPUBLISHED, not skipped, when the model's number has
            # genuinely moved. Derek: "we have to be able to trust when guys like Dart and Daniels
            # go down on IR, our model #'s are updated accordingly." Skipping meant the opposite:
            # Jaxson Dart went on injured reserve after Monday's publish, the model correctly
            # dropped New York by ~3 points, and the site went on showing the pre-injury number all
            # week because the game had been published once.
            #
            # Nothing is overwritten. The ledger is append-only by design -- no unique key, a
            # published_at on every row, and a CHECK that it precedes kickoff -- so a revision is a
            # NEW row and the number we stood behind on Monday stays on the record beside it. The
            # site and the grader both read the latest pre-kickoff row.
            was = prev[1]
            moved = was is None or abs(float(p["pred_margin"]) - float(was)) >= REVISE_MARGIN
            if not moved:
                skipped.append(f"unchanged: {p['away']}@{p['home']}")
                continue
            revised.append(f"{p['away']}@{p['home']}: {was} -> {round(p['pred_margin'], 1)}")
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
    print(f"  to publish: {len(rows)}   skipped: {len(skipped)}   revised: {len(revised)}")
    for r in revised:
        print(f"    ~ REVISED {r}")
    for s in skipped:
        print(f"    - {s}")
    # Every row, not the first three. This write is PERMANENT — the ledger is append-only and each
    # game locks the first time it is published — so the one chance to read what is about to be
    # locked is right here, and a preview that elides eleven of fourteen is not a preview.
    for r in rows:
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
