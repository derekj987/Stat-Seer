"""
Preseason "test-run" model — a DELIBERATE SANDBOX, not a real model.

Purpose: exercise the exact modeling machinery early, on real stats already
recorded THIS preseason, before Week 1. It is NOT an edge and NOT trustworthy:
preseason is 2-3 games of mostly-backups, so the ratings are almost pure noise.
It is walled off from the trust engine — its output is never published as a
StatSeer prediction, never graded, and never enters calibration.

Method (mirrors analysis/game_model.py so the machinery is the same):
  - Rating = a team's mean point differential across its preseason games
    (point diff is the signal game_model uses; W-L is ignored, coeff -0.010).
  - Shrink HARD: preseason samples are tiny, so regress toward zero by both a
    sample-size factor n/(n+k) AND a fixed factor. Starters rest -> weak HFA.
  - Predicted margin only. No win% — with this little data a probability would
    be false precision, and honesty is the whole point of the app.

Reads the ISOLATED preseason_team_games table (populated by espn_preseason.py).

    python analysis/preseason_model.py --season 2026
"""
import argparse
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import odds_client as oc  # noqa: E402  (env + SSL helpers)

MODEL_VERSION = "preseason-sandbox-v1"
REGRESS_PRE = 0.35   # shrink harder than the regular model (0.70): preseason is noisier
SHRINK_K = 2.0       # sample-size shrink: a team with n games counts n/(n+K)
HFA_PRE = 1.0        # weak home edge — starters rest, crowds thinner


def _get(table, query, env):
    url = env.get("SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY missing")
    oc.ensure_ssl_certs()
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/{table}{query}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def ratings(games):
    """{team: (shrunk_rating, n_games, raw_avg_diff)} from preseason results."""
    diff, cnt = {}, {}
    for g in games:
        pf, pa = g.get("points_for"), g.get("points_against")
        if pf is None or pa is None:
            continue
        t = g["team"]
        diff[t] = diff.get(t, 0.0) + (pf - pa)
        cnt[t] = cnt.get(t, 0) + 1
    out = {}
    for t, d in diff.items():
        n = cnt[t]
        raw = d / n
        shrunk = raw * (n / (n + SHRINK_K))   # trust small samples less
        out[t] = (shrunk, n, raw)
    return out


def predict(rate, home, away):
    """Predicted margin from the home team's perspective (sandbox)."""
    rh = rate.get(home, (0.0, 0, 0.0))[0]
    ra = rate.get(away, (0.0, 0, 0.0))[0]
    return REGRESS_PRE * (rh - ra) + HFA_PRE


def upcoming_matchups(season, env):
    """Unplayed preseason games we have odds for (from preseason_odds), so the
    sandbox can 'predict' something. Returns [(away, home)] unique."""
    try:
        rows = _get("preseason_odds",
                    f"?season=eq.{season}&select=event_id,home_team,away_team", env)
    except Exception:
        return []
    seen, out = set(), []
    for r in rows:
        k = r["event_id"]
        if k in seen:
            continue
        seen.add(k)
        out.append((r["away_team"], r["home_team"]))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    args = ap.parse_args(argv)
    env = oc.load_env()

    try:
        games = _get("preseason_team_games",
                     f"?season=eq.{args.season}&select=team,opponent,points_for,points_against,week", env)
    except Exception as e:
        print(f"ERROR reading preseason_team_games: {e}", file=sys.stderr)
        return 1

    if not games:
        print(f"No preseason data for {args.season}. Run:  python espn_preseason.py "
              f"--season {args.season} --write")
        return 0

    rate = ratings(games)
    print(f"PRESEASON SANDBOX ({MODEL_VERSION}) — {args.season}   *** TEST RUN, NOT GRADED ***")
    print(f"  {len(games)//1} team-game rows · {len(rate)} teams · tiny sample = noise\n")
    print(f"  {'team':<5}{'GP':>3}{'raw diff':>10}{'rating':>9}")
    for t, (shrunk, n, raw) in sorted(rate.items(), key=lambda kv: -kv[1][0]):
        print(f"  {t:<5}{n:>3}{raw:>+10.1f}{shrunk:>+9.1f}")

    ups = upcoming_matchups(args.season, env)
    if ups:
        print(f"\n  Sandbox 'predictions' for upcoming preseason games (in-sample, meaningless):")
        print(f"  {'game':<12}{'pred margin':>12}  favored")
        for away, home in ups:
            m = predict(rate, home, away)
            fav = home if m >= 0 else away
            print(f"  {away+'@'+home:<12}{m:>+12.1f}  {fav}")
    print("\n  Reminder: this exists to exercise the pipeline. It is not a pick.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
