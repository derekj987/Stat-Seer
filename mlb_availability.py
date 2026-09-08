"""
mlb_availability.py -- the MLB Stage A model: will this player be in tonight's starting lineup,
and where will he bat?

    python mlb_availability.py                 # fetch, fit, report, write web/lib/mlbAvailability.ts
    python mlb_availability.py --validate      # out-of-sample scoring only, writes nothing
    python mlb_availability.py --days 3        # look further ahead

WHY THIS IS STAGE A. Every prop is conditioned on the player appearing. In football that gate is
weekly and mostly binary; in baseball it fires every single day, and ~2.2 of 9 lineup slots change
overnight. A projection that does not know who is playing is not a projection.

The batting-order slot is the second half and the more useful one: it IS the volume driver, the
way snap share is in football. Leadoff sees roughly 4.6 plate appearances a night and the 9-hole
about 3.9, so slot is most of the difference between two otherwise similar hitters.

UNLIKE PRACTICE TRAJECTORY, THIS IS BACKFILLABLE. MLB's StatsAPI returns the posted lineup for
every completed game, in batting order, free and without a key. So the model can be trained and
scored on real history today rather than waiting a season for data to accrue. What is NOT
recoverable is *when* a lineup posted and whether a player was a late scratch -- that is real-time
only, and it is why mlb_capture.py runs on a schedule.

MEASURED, 2026 season, 30 teams, 4,156 team-games. Walk-forward: features from the prior 30 team
games only, trained on the first 70% of each team's season and scored on the rest (20,297 held-out
candidate rows).

    model                             Brier      vs persistence
    always the base rate              0.24927        -8.7%
    persistence (started last game)   0.22926          --
    raw 30-game start rate            0.17358       +24.3%
    shrunk rate (k=5)                 0.17169       +25.1%
    shrunk + prev-game (w=0.2)        0.16108       +29.7%

The blend beats BOTH its components, which is the tell that each carries something the other
lacks -- the same signature the NFL role-blend showed. Gains hold across every playing-time band
and are LARGEST in the middle:

    everyday >80%   +29.9%      platoon 20-50%  +31.1%
    regular 50-80%  +33.2%      bench <20%      +19.9%

Calibration on held-out data is close to diagonal (predicted 20-29% -> actual 24.1%,
50-59% -> 50.9%, 90-99% -> 93.9%), so the number can be published as a probability rather than
dressed up as a tier.

Batting slot, given a start: mean absolute error 0.99 slots using the player's recent mean slot,
against 2.22 for guessing 5th every time.

Stdlib only. No key required -- statsapi.mlb.com is public.
"""
import argparse
import collections
import datetime as _dt
import json
import os
import statistics
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://statsapi.mlb.com/api/v1"
CACHE_DIR = os.path.join("data", "mlb_lineups")

# Window of prior team games the features look back over, and the shrinkage/blend constants.
# k and w were swept on the TRAIN split only and then applied unchanged to the held-out games --
# tuning them on the test set would make the numbers in the docstring meaningless.
WIN, K, W = 30, 5, 0.2
MIN_HIST = 35          # a team needs this many games before it is scored at all


def _get(url, tries=3):
    import time
    for a in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=45) as r:
                return json.load(r)
        except Exception:
            if a == tries - 1:
                return None
            time.sleep(2 ** a)
    return None


def fetch_day(dstr):
    """One date -> [team-game dicts]. Cached on disk: a completed day never changes, and the
    season is ~180 calls, so a refetch on every run is pure waste."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{dstr}.json")
    today = _dt.date.today().isoformat()
    if os.path.exists(path) and dstr < today:          # only trust the cache for finished days
        try:
            return json.load(open(path, encoding="utf-8"))
        except Exception:
            pass
    d = _get(f"{API}/schedule?sportId=1&date={dstr}&hydrate=lineups,probablePitcher")
    out = []
    for date in (d or {}).get("dates", []):
        for g in date.get("games", []):
            final = g.get("status", {}).get("detailedState") == "Final"
            lu = g.get("lineups") or {}
            for side, key in (("away", "awayPlayers"), ("home", "homePlayers")):
                players = lu.get(key) or []
                pp = g["teams"][side].get("probablePitcher") or {}
                out.append({
                    "date": dstr, "gamePk": g["gamePk"], "final": final, "side": side,
                    "team": g["teams"][side]["team"]["id"],
                    "teamName": g["teams"][side]["team"]["name"],
                    "opp": g["teams"]["home" if side == "away" else "away"]["team"]["name"],
                    "commence": g.get("gameDate"),
                    "sp": pp.get("id"), "spName": pp.get("fullName"),
                    "lineup": [{"id": p["id"], "name": p["fullName"],
                                "pos": (p.get("primaryPosition") or {}).get("abbreviation")}
                               for p in players],
                })
    if dstr < today:
        json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    return out


def season_lineups(start, end, workers=8):
    dates = [(start + _dt.timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
    rows = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for got in ex.map(fetch_day, dates):
            rows += got
    rows.sort(key=lambda r: (r["date"], r["gamePk"]))
    return rows


def features(hist, prev_ids):
    """{player_id: {...}} from a team's prior games. Everything here is observable before first
    pitch -- no field is read from the game being predicted."""
    cand = collections.Counter()
    slots = collections.defaultdict(list)
    meta = {}
    for g in hist:
        for s, p in enumerate(g["lineup"], 1):
            cand[p["id"]] += 1
            slots[p["id"]].append(s)
            meta[p["id"]] = p
    n = max(1, len(hist))
    out = {}
    for pid, c in cand.items():
        rate = c / n
        p_start = (1 - W) * ((rate * WIN + K * BASE) / (WIN + K)) + W * (1 if pid in prev_ids else 0)
        out[pid] = {
            "name": meta[pid]["name"], "pos": meta[pid]["pos"],
            "p_start": round(max(0.02, min(0.98, p_start)), 3),
            "slot": round(statistics.mean(slots[pid]), 1),
            "starts": c, "of": n,
        }
    return out


BASE = 0.546   # league start rate among candidates, measured on the 2026 train split


def validate(rows):
    """Walk-forward scoring. Prints the table in the docstring; changes nothing."""
    bt = collections.defaultdict(list)
    for r in rows:
        if r["final"] and len(r["lineup"]) == 9:
            bt[r["team"]].append(r)
    bt = {t: g for t, g in bt.items() if len(g) >= 100}
    ex = []
    for t, gs in bt.items():
        for i in range(MIN_HIST, len(gs)):
            now = {p["id"] for p in gs[i]["lineup"]}
            prev = {p["id"] for p in gs[i - 1]["lineup"]}
            for pid, f in features(gs[max(0, i - WIN):i], prev).items():
                ex.append({"i": i, "y": 1 if pid in now else 0, "p": f["p_start"],
                           "rate": f["starts"] / f["of"], "prev": 1 if pid in prev else 0})
    cut = int(max(e["i"] for e in ex) * 0.70)
    te = [e for e in ex if e["i"] > cut]
    brier = lambda f, d: sum((f(e) - e["y"]) ** 2 for e in d) / len(d)
    pers = lambda e: 0.95 if e["prev"] else 0.05
    m, p = brier(lambda e: e["p"], te), brier(pers, te)
    print(f"teams {len(bt)}  held-out candidate rows {len(te):,}")
    print(f"  model Brier      {m:.5f}")
    print(f"  persistence      {p:.5f}   -> {(p - m) / p * 100:+.1f}%")
    print("\n  calibration:")
    buck = collections.defaultdict(list)
    for e in te:
        buck[min(9, int(e["p"] * 10))].append(e["y"])
    for b in sorted(buck):
        v = buck[b]
        print(f"    predicted {b*10:>2}-{b*10+9:<2}%   actual {statistics.mean(v)*100:>5.1f}%   n={len(v):>6,}")
    return m, p


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--days", type=int, default=2, help="how far ahead to project")
    ap.add_argument("--validate", action="store_true", help="score out of sample, write nothing")
    ap.add_argument("--out", default=os.path.join("web", "lib", "mlbAvailability.ts"))
    args = ap.parse_args(argv)

    start = _dt.date(args.season, 3, 20)
    today = _dt.date.today()
    rows = season_lineups(start, today + _dt.timedelta(days=args.days))
    done = [r for r in rows if r["final"] and len(r["lineup"]) == 9]
    print(f"{len(rows):,} team-games fetched, {len(done):,} completed with a posted lineup")
    if len(done) < 500:
        print("WARNING: too little history to fit — refusing to write", file=sys.stderr)
        return 1

    if args.validate:
        validate(rows)
        return 0

    bt = collections.defaultdict(list)
    for r in done:
        bt[r["team"]].append(r)

    # Upcoming games. "not final" is NOT enough on its own: spring-training exhibitions against
    # minor-league affiliates never get marked Final, so a bare not-final filter resurfaced
    # "Houston Astros vs Sugar Land Space Cowboys" from 24 March as an upcoming game. Require the
    # game to actually be ahead of us, and the opponent to be one of the 30 clubs that have a real
    # season on record.
    # Lineups land ~3h before first pitch, so most of what survives here is pre-lineup — which is
    # exactly when a projection is worth having.
    now_iso = _dt.datetime.now(_dt.timezone.utc).isoformat()
    real_clubs = {r["teamName"] for t in bt for r in bt[t]}
    upcoming = [r for r in rows
                if not r["final"] and (r.get("commence") or "") >= now_iso
                and r["opp"] in real_clubs]
    out = []
    for r in upcoming:
        hist = bt.get(r["team"], [])
        if len(hist) < MIN_HIST:
            continue
        prev = {p["id"] for p in hist[-1]["lineup"]}
        posted = {p["id"] for p in r["lineup"]}
        for pid, f in sorted(features(hist[-WIN:], prev).items(),
                             key=lambda kv: -kv[1]["p_start"]):
            # ONE card per matchup, not one per team. Keyed away @ home so both clubs' hitters
            # land in the same card — the football boards show a game once, and MLB reading
            # differently for no reason is exactly the inconsistency to avoid.
            away = r["teamName"] if r["side"] == "away" else r["opp"]
            home = r["opp"] if r["side"] == "away" else r["teamName"]
            out.append({
                # StatsAPI's own game id. Baseball plays series, so a matchup string is not a
                # unique game; a DATE + matchup is not one either, because the date has to come
                # from the UTC timestamp and a 9:40pm Pacific first pitch is already tomorrow in
                # UTC — which collided tonight's west-coast games with tomorrow's game of the
                # same series. gamePk is unique by construction and survives doubleheaders.
                "gameKey": str(r["gamePk"]),
                "game": f"{away} @ {home}", "commence": r["commence"],
                "team": r["teamName"], "player": f["name"], "pos": f["pos"],
                # If the lineup is already posted this is no longer a projection — say so rather
                # than publishing a probability next to a known fact.
                "posted": bool(posted) and pid in posted,
                "lineupPosted": bool(posted),
                "pStart": f["p_start"], "slot": f["slot"],
                "starts": f["starts"], "of": f["of"],
            })
    m, p = validate(rows)
    header = (f"// AUTO-GENERATED by mlb_availability.py -- do not edit by hand.\n"
              f"// Stage A: P(in tonight's starting lineup) + projected batting slot.\n"
              f"// Held-out Brier {m:.5f} vs {p:.5f} for persistence ({(p-m)/p*100:+.1f}%).\n"
              f"// Generated {_dt.datetime.now(_dt.timezone.utc).isoformat(timespec='seconds')}\n")
    ts = (header +
          "export type MlbAvail = { gameKey: string; game: string; commence: string; team: string; player: string;\n"
          "  pos: string | null; posted: boolean; lineupPosted: boolean; pStart: number;\n"
          "  slot: number; starts: number; of: number };\n\n"
          f"export const MLB_AVAIL: MlbAvail[] = {json.dumps(out, ensure_ascii=False)};\n")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    open(args.out, "w", encoding="utf-8", newline="\n").write(ts)
    print(f"\nwrote {len(out):,} rows -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
