"""
mlb_strikeouts.py -- projected strikeouts for tonight's starting pitchers.

    python mlb_strikeouts.py --validate     # walk-forward scoring + ablation, writes nothing
    python mlb_strikeouts.py                # project tomorrow's starters -> web/lib/mlbStrikeouts.ts

WHY THIS PROP FIRST. Strikeout rate is the most persistent skill in baseball, and the market
carries it more widely than any other prop (6 books including FanDuel, measured 2026-09-07).
It is also the same SHAPE the football work validated: project the VOLUME, multiply by a REGRESSED
RATE. Batters faced is the volume; K/BF is the rate. Hits props are the popular alternative and the
wrong first target -- they are BABIP-driven and close to noise.

    K_hat = BF_recent x K/BF_pitcher x (K/BF_opponent / league)

all three terms shrunk toward the league, all computed from starts STRICTLY BEFORE the one being
predicted. Opponent strikeout rate is derived from these same pitcher logs (how often that lineup
has struck out against starters), so it costs no extra calls and cannot leak the future.

MEASURED. 2026, 350 starters, 4,316 logged starts, 2,923 scored after a 5-start warm-up. Constants
swept on the first 70% of dates and applied unchanged to the held-out 925 starts.

    model                              MAE     vs baseline
    league mean K/start             1.9299          -6.0%
    pitcher last 3 starts           1.9153          -5.2%
    pitcher season mean (baseline)  1.8213             --
    rate only                       1.8140          +0.4%
    volume x rate                   1.7889          +1.8%
    volume x rate x opponent        1.7646          +3.1%

Every term earns its place and the ablation is monotonic -- volume adds 1.4pp over rate alone, the
opponent another 1.3pp. That ordering is the same finding football produced: volume persists.

WHAT THIS IS NOT. +3.1% is against the pitcher's own season mean, i.e. against REALITY. It is NOT a
demonstration that the number beats the CLOSING LINE, which is this project's actual bar, and which
cannot be tested yet -- mlb_prop_snapshots started collecting on 2026-09-07 and a market test needs
history. Expect the honest answer to be that it does not beat the line: the NFL prop projection did
not (~50% on 6,457 props), and MLB markets are at least as efficient. The reason to publish it
anyway is that a line-blind, graded number is the trust engine; the edge, if there is one, lives in
the Value Finder.

Sanity check that DOES pass today, the standing projection/line ratio test: median 1.041 against
the captured book lines, no row at >=2x or <=0.5x. (NFL's healthy board runs 1.01; NCAAF was 1.52
before ROLE_VOL_CAP.) That says the numbers are in the right place, not that they are profitable.

Stdlib only. statsapi.mlb.com is public and keyless; Supabase is read only for the book line.
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
CACHE = os.path.join("data", "mlb_pitcher_logs.json")
MIN_PRIOR = 5                 # starts a pitcher needs before he is projected at all
K1, K2, K3 = 40, 800, 3       # shrinkage: pitcher rate, opponent rate, recent volume
SEASON = 2026


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


def starter_ids(season=SEASON):
    """Everyone who has been a probable starter this season, from the schedule."""
    start = _dt.date(season, 3, 20)
    end = _dt.date.today()
    dates = [(start + _dt.timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
    ids = set()

    def day(d):
        j = _get(f"{API}/schedule?sportId=1&date={d}&hydrate=probablePitcher")
        out = set()
        for dt_ in (j or {}).get("dates", []):
            for g in dt_.get("games", []):
                for side in ("away", "home"):
                    pp = g["teams"][side].get("probablePitcher") or {}
                    if pp.get("id"):
                        out.add(pp["id"])
        return out
    with ThreadPoolExecutor(max_workers=10) as ex:
        for got in ex.map(day, dates):
            ids |= got
    return sorted(ids)


def pitcher_logs(ids, season=SEASON, refresh=False):
    if not refresh and os.path.exists(CACHE):
        try:
            return json.load(open(CACHE, encoding="utf-8"))
        except Exception:
            pass

    def one(pid):
        j = _get(f"{API}/people/{pid}/stats?stats=gameLog&group=pitching&season={season}")
        out = []
        for blk in (j or {}).get("stats", []):
            for s in blk.get("splits", []):
                st = s["stat"]
                if not st.get("gamesStarted") or not st.get("battersFaced"):
                    continue          # starts only -- a reliever's line is a different animal
                out.append({"pid": pid, "name": (s.get("player") or {}).get("fullName"),
                            "date": s.get("date"), "gamePk": (s.get("game") or {}).get("gamePk"),
                            "opp": (s.get("opponent") or {}).get("id"),
                            "bf": st["battersFaced"], "k": st.get("strikeOuts", 0)})
        return out
    logs = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for got in ex.map(one, ids):
            logs += got
    logs.sort(key=lambda r: (r["date"], r["gamePk"] or 0))
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(logs, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    return logs


class State:
    """Running per-pitcher and per-opponent totals. Advanced start by start so a projection can
    only ever see what had happened before it."""

    def __init__(self, logs):
        self.lg_kr = sum(r["k"] for r in logs) / sum(r["bf"] for r in logs)
        self.lg_bf = sum(r["bf"] for r in logs) / len(logs)
        self.pk = collections.defaultdict(int); self.pbf = collections.defaultdict(int)
        self.bfs = collections.defaultdict(list); self.ks = collections.defaultdict(list)
        self.ok = collections.defaultdict(int); self.obf = collections.defaultdict(int)
        self.name = {}

    def add(self, r):
        p, o = r["pid"], r["opp"]
        self.pk[p] += r["k"]; self.pbf[p] += r["bf"]
        self.bfs[p].append(r["bf"]); self.ks[p].append(r["k"])
        self.ok[o] += r["k"]; self.obf[o] += r["bf"]
        if r.get("name"):
            self.name[p] = r["name"]

    def project(self, pid, opp):
        if len(self.ks[pid]) < MIN_PRIOR or self.obf.get(opp, 0) == 0:
            return None
        kr = (self.pk[pid] + K1 * self.lg_kr) / (self.pbf[pid] + K1)
        recent = self.bfs[pid][-6:]
        bf = (sum(recent) + K3 * self.lg_bf) / (len(recent) + K3)
        orate = (self.ok[opp] + K2 * self.lg_kr) / (self.obf[opp] + K2)
        return {"proj": round(bf * kr * (orate / self.lg_kr), 2),
                "bf": round(bf, 1), "kRate": round(kr, 4),
                "oppFactor": round(orate / self.lg_kr, 3),
                "starts": len(self.ks[pid]),
                "seasonMean": round(statistics.mean(self.ks[pid]), 2)}


def validate(logs):
    st = State(logs)
    rows = []
    for r in logs:
        p = st.project(r["pid"], r["opp"])
        if p:
            rows.append({"date": r["date"], "y": r["k"], **p})
        st.add(r)
    dates = sorted({r["date"] for r in rows})
    cut = dates[int(len(dates) * 0.70)]
    te = [r for r in rows if r["date"] > cut]
    mae = lambda f, d: statistics.mean(abs(f(r) - r["y"]) for r in d)
    base = mae(lambda r: r["seasonMean"], te)
    print(f"scored {len(rows):,} starts, {len(te):,} held out (split {cut})")
    print(f"\n{'model':<34}{'MAE':>9}{'vs baseline':>14}")
    for name, f in (("league mean K/start", lambda r: st.lg_kr * st.lg_bf),
                    ("pitcher season mean (baseline)", lambda r: r["seasonMean"]),
                    ("volume x rate x opponent", lambda r: r["proj"])):
        m = mae(f, te)
        print(f"{name:<34}{m:>9.4f}{(base - m) / base * 100:>13.1f}%")
    return te


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="refetch pitcher logs")
    ap.add_argument("--days", type=int, default=2)
    ap.add_argument("--out", default=os.path.join("web", "lib", "mlbStrikeouts.ts"))
    args = ap.parse_args(argv)

    ids = starter_ids()
    logs = pitcher_logs(ids, refresh=args.refresh)
    print(f"{len(logs):,} starts from {len({r['pid'] for r in logs})} pitchers")
    if len(logs) < 500:
        print("WARNING: too few logged starts to fit — refusing to write", file=sys.stderr)
        return 1
    if args.validate:
        validate(logs)
        return 0

    st = State(logs)
    for r in logs:
        st.add(r)

    out = []
    today = _dt.date.today()
    for i in range(args.days + 1):
        d = (today + _dt.timedelta(days=i)).isoformat()
        j = _get(f"{API}/schedule?sportId=1&date={d}&hydrate=probablePitcher")
        for dt_ in (j or {}).get("dates", []):
            for g in dt_.get("games", []):
                if g.get("status", {}).get("detailedState") == "Final":
                    continue
                for side in ("away", "home"):
                    pp = g["teams"][side].get("probablePitcher") or {}
                    if not pp.get("id"):
                        continue
                    other = "home" if side == "away" else "away"
                    p = st.project(pp["id"], g["teams"][other]["team"]["id"])
                    if not p:
                        continue
                    away_n = g["teams"]["away"]["team"]["name"]
                    home_n = g["teams"]["home"]["team"]["name"]
                    out.append({
                        # Series-safe key — see mlb_player_props for why the matchup alone isn't one.
                        "gameKey": f'{(g.get("gameDate") or "")[:10]}|{away_n} @ {home_n}',
                        "game": f"{away_n} @ {home_n}",
                        "commence": g.get("gameDate"),
                        "pitcher": pp["fullName"], "team": g["teams"][side]["team"]["name"],
                        "opp": g["teams"][other]["team"]["name"], **p})
    te = validate(logs)
    mae_model = statistics.mean(abs(r["proj"] - r["y"]) for r in te)
    mae_base = statistics.mean(abs(r["seasonMean"] - r["y"]) for r in te)
    header = (f"// AUTO-GENERATED by mlb_strikeouts.py -- do not edit by hand.\n"
              f"// Projected strikeouts: BF x K/BF x opponent, all shrunk to league.\n"
              f"// Held-out MAE {mae_model:.4f} vs {mae_base:.4f} for the pitcher's season mean"
              f" ({(mae_base-mae_model)/mae_base*100:+.1f}%). NOT yet tested against the closing line.\n"
              f"// Generated {_dt.datetime.now(_dt.timezone.utc).isoformat(timespec='seconds')}\n")
    ts = (header +
          "export type MlbK = { gameKey: string; game: string; commence: string; pitcher: string; team: string;\n"
          "  opp: string; proj: number; bf: number; kRate: number; oppFactor: number;\n"
          "  starts: number; seasonMean: number };\n\n"
          f"export const MLB_K: MlbK[] = {json.dumps(out, ensure_ascii=False)};\n")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    open(args.out, "w", encoding="utf-8", newline="\n").write(ts)
    print(f"\nwrote {len(out)} projections -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
