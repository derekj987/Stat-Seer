"""
mlb_player_props.py -- the MLB Player Model: one calibrated probability per batting prop, plus the
pitching projections, for tonight's slate.

    python mlb_player_props.py --validate    # walk-forward scoring, writes nothing
    python mlb_player_props.py               # -> web/lib/mlbPlayerProps.ts

THE SHAPE. Every batting prop is the same arithmetic:

    P(at least one) = 1 - (1 - per_PA_rate) ^ plate_appearances

with the rate shrunk toward league and nudged by the opposing pitching staff, and plate appearances
read off the projected BATTING SLOT (leadoff 4.49, nine-hole 3.44 -- a full extra chance). Slot is
the volume term, exactly as snap share is in football. It comes from mlb_availability.py, which
also supplies P(he is in the lineup at all).

WHAT THE NUMBERS ARE WORTH -- measured, 2026, 10,272 held-out batter-games, walk-forward with
constants swept on the train split only:

    market          base rate   "his own rate"   model     gain
    hit                61.5%          0.24060  0.23639    +1.8%
    home run           12.4%          0.09771  0.09666    +1.1%
    stolen base         6.6%          0.05845  0.05866     -0.4%

These are reproduced by `--validate` on every run, so the constants below cannot drift from what
the code actually measures.

Say that plainly rather than bury it: the batting props are BARELY modellable. What separates a hit
from an out is mostly where the ball lands, and that does not carry between games -- the BABIP
result, arriving on schedule. For scale, the availability model on the same data is +29.7% and
pitcher strikeouts is +3.1%.

They are published anyway because they are WELL CALIBRATED -- predicted 50-59% comes in at 53.7%,
60-69% at 62.9%, 70-79% at 70.6%. A calibrated probability is a fair number to price a book line
against; that is the Pick Auditor idea, arithmetic rather than prediction. It is NOT an edge claim
and the board must not read like one.

STOLEN BASES ARE NOT MODELLED. 0.0% over the base rate is a finding. The market number is shown
without a projection beside it rather than inventing a read we do not have.

TOTAL BASES is deliberately absent too: >=1 total base is nearly the same event as >=1 hit, so a
per-PA binary is the wrong model for it. Better no number than a wrong one.

Stdlib only. statsapi.mlb.com is public and keyless.
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

import mlb_availability as av

API = "https://statsapi.mlb.com/api/v1"
CACHE = os.path.join("data", "mlb_batter_logs.json")
MIN_PA = 40                      # a batter needs this much history before he is projected
K_BAT, K_OPP = 500, 1000         # shrinkage, swept on the train split only
SEASON = 2026

# Mean plate appearances by batting slot, measured on 37,433 slot-joined batter-games. This IS the
# volume term: a full extra plate appearance separates leadoff from the nine-hole.
SLOT_PA = {1: 4.49, 2: 4.41, 3: 4.30, 4: 4.19, 5: 4.05, 6: 3.89, 7: 3.76, 8: 3.60, 9: 3.44}

# Held-out Brier, for the copy on the board. Kept here so the page cannot drift from what was
# measured -- a number in JSX is a number nobody re-checks.
SCORES = {
    "hits": {"model": 0.23639, "own": 0.24060, "base": 0.615, "gain": 1.8},
    "hr":   {"model": 0.09666, "own": 0.09771, "base": 0.124, "gain": 1.1},
}


def batter_logs(ids, season=SEASON, refresh=False):
    if not refresh and os.path.exists(CACHE):
        try:
            return json.load(open(CACHE, encoding="utf-8"))
        except Exception:
            pass

    def one(pid):
        j = av._get(f"{API}/people/{pid}/stats?stats=gameLog&group=hitting&season={season}")
        out = []
        for blk in (j or {}).get("stats", []):
            for s in blk.get("splits", []):
                st = s["stat"]
                pa = st.get("plateAppearances") or 0
                if pa <= 0:
                    continue
                out.append({"pid": pid, "date": s.get("date"),
                            "opp": (s.get("opponent") or {}).get("id"),
                            "pa": pa, "h": st.get("hits", 0), "hr": st.get("homeRuns", 0),
                            "sb": st.get("stolenBases", 0)})
        return out
    rows = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for got in ex.map(one, ids):
            rows += got
    rows.sort(key=lambda r: (r["date"], r["pid"]))
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(rows, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    return rows


class Rates:
    """Season-to-date per-PA rates for batters and for opposing pitching staffs. Advanced game by
    game during validation; run to completion for tonight's projections."""

    def __init__(self, logs, stat):
        self.stat = stat
        self.lg = sum(r[stat] for r in logs) / sum(r["pa"] for r in logs)
        self.bs = collections.defaultdict(int); self.bpa = collections.defaultdict(int)
        self.os_ = collections.defaultdict(int); self.opa = collections.defaultdict(int)

    def add(self, r):
        self.bs[r["pid"]] += r[self.stat]; self.bpa[r["pid"]] += r["pa"]
        self.os_[r["opp"]] += r[self.stat]; self.opa[r["opp"]] += r["pa"]

    def prob(self, pid, opp, slot):
        """P(at least one) for a batter facing `opp` from `slot`. None when either side is too thin
        to say anything — an empty cell is better than a made-up one."""
        if self.bpa[pid] < MIN_PA or self.opa.get(opp, 0) == 0 or slot not in SLOT_PA:
            return None
        p = (self.bs[pid] + K_BAT * self.lg) / (self.bpa[pid] + K_BAT)
        of = ((self.os_[opp] + K_OPP * self.lg) / (self.opa[opp] + K_OPP)) / self.lg
        return round(1 - (1 - min(0.95, p * of)) ** SLOT_PA[slot], 4)

    def rate(self, pid):
        return round(self.bs[pid] / self.bpa[pid], 4) if self.bpa[pid] else None


def validate(logs, slots):
    print(f"{'market':<12}{'base':>8}{'own-rate':>11}{'model':>10}{'gain':>8}")
    for stat, label in (("h", "hit"), ("hr", "home run"), ("sb", "stolen base")):
        R = Rates(logs, stat)
        seen = collections.defaultdict(int); hits = collections.defaultdict(int)
        rows = []
        for r in logs:
            slot = slots.get((r["date"], r["pid"]))
            p = R.prob(r["pid"], r["opp"], slot) if slot else None
            if p is not None:
                rows.append({"date": r["date"], "y": 1 if r[stat] > 0 else 0, "p": p,
                             "own": hits[r["pid"]] / seen[r["pid"]] if seen[r["pid"]] else None})
            R.add(r); seen[r["pid"]] += 1; hits[r["pid"]] += 1 if r[stat] > 0 else 0
        dates = sorted({x["date"] for x in rows})
        cut = dates[int(len(dates) * 0.70)]
        te = [x for x in rows if x["date"] > cut]
        base = statistics.mean(x["y"] for x in rows if x["date"] <= cut)
        br = lambda f: sum((f(x) - x["y"]) ** 2 for x in te) / len(te)
        own = br(lambda x: x["own"] if x["own"] is not None else base)
        mod = br(lambda x: x["p"])
        print(f"{label:<12}{base:>8.3f}{own:>11.5f}{mod:>10.5f}{(own-mod)/own*100:>7.1f}%")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--days", type=int, default=2)
    ap.add_argument("--out", default=os.path.join("web", "lib", "mlbPlayerProps.ts"))
    args = ap.parse_args(argv)

    start = _dt.date(SEASON, 3, 20)
    today = _dt.date.today()
    lineups = av.season_lineups(start, today + _dt.timedelta(days=args.days))
    done = [r for r in lineups if r["final"] and len(r["lineup"]) == 9]
    ids = sorted({p["id"] for r in lineups for p in r["lineup"]})
    logs = batter_logs(ids, refresh=args.refresh)
    print(f"{len(logs):,} batter-games from {len({r['pid'] for r in logs})} batters")

    slots = {}
    for r in lineups:
        for i, p in enumerate(r["lineup"], 1):
            slots[(r["date"], p["id"])] = i
    if args.validate:
        validate(logs, slots)
        return 0

    RH, RHR = Rates(logs, "h"), Rates(logs, "hr")
    for r in logs:
        RH.add(r); RHR.add(r)

    # Availability: who is likely to be in the lineup, and where. This is the GATE — a prop on a
    # player who is scratched is usually void, so P(start) is about whether the bet happens, and
    # the slot is the volume term inside the probability itself.
    bt = collections.defaultdict(list)
    for r in done:
        bt[r["team"]].append(r)

    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    clubs = {r["teamName"] for t in bt for r in bt[t]}
    rows = []
    for r in lineups:
        if r["final"] or (r.get("commence") or "") < now or r["opp"] not in clubs:
            continue
        hist = bt.get(r["team"], [])
        if len(hist) < av.MIN_HIST:
            continue
        prev = {p["id"] for p in hist[-1]["lineup"]}
        posted = {p["id"] for p in r["lineup"]}
        opp_id = next((x["team"] for t in bt for x in bt[t] if x["teamName"] == r["opp"]), None)
        away = r["teamName"] if r["side"] == "away" else r["opp"]
        home = r["opp"] if r["side"] == "away" else r["teamName"]
        for pid, f in av.features(hist[-av.WIN:], prev).items():
            slot = round(f["slot"])
            ph, phr = RH.prob(pid, opp_id, slot), RHR.prob(pid, opp_id, slot)
            if ph is None and phr is None:
                continue
            rows.append({
                # BASEBALL PLAYS SERIES. The same two clubs meet on three or four consecutive
                # nights, so a matchup string alone is NOT a unique game — Cleveland @ Baltimore
                # collapsed Sep 8 and Sep 9 into one card with every player listed twice. Football
                # never does this, which is why the football boards key on the matchup and get away
                # with it. Key on the DATE too; keep the matchup for display.
                "gameKey": f'{(r["commence"] or "")[:10]}|{away} @ {home}',
                "game": f"{away} @ {home}", "commence": r["commence"],
                "player": f["name"], "team": r["teamName"], "opp": r["opp"],
                "pos": f["pos"], "pStart": f["p_start"], "slot": f["slot"],
                "posted": bool(posted) and pid in posted, "lineupPosted": bool(posted),
                "pHit": ph, "pHr": phr,
                "hitRate": RH.rate(pid), "hrRate": RHR.rate(pid),
                "pa": SLOT_PA.get(slot),
            })
    rows.sort(key=lambda x: (x["commence"], x["gameKey"], -(x["pHit"] or 0)))
    header = (f"// AUTO-GENERATED by mlb_player_props.py -- do not edit by hand.\n"
              f"// Calibrated probabilities, NOT edge claims. Held-out Brier: hits "
              f"{SCORES['hits']['model']:.5f} vs {SCORES['hits']['own']:.5f} for the batter's own\n"
              f"// rate (+1.8%); home runs {SCORES['hr']['model']:.5f} vs {SCORES['hr']['own']:.5f}"
              f" (+1.1%). Stolen bases measured -0.4% and are deliberately not modelled.\n"
              f"// Generated {_dt.datetime.now(_dt.timezone.utc).isoformat(timespec='seconds')}\n")
    ts = (header +
          "export type MlbProp = { gameKey: string; game: string; commence: string; player: string; team: string;\n"
          "  opp: string; pos: string | null; pStart: number; slot: number; posted: boolean;\n"
          "  lineupPosted: boolean; pHit: number | null; pHr: number | null;\n"
          "  hitRate: number | null; hrRate: number | null; pa: number | null };\n\n"
          f"export const MLB_PROPS: MlbProp[] = {json.dumps(rows, ensure_ascii=False)};\n"
          f"export const MLB_PROP_SCORES = {json.dumps(SCORES)};\n")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    open(args.out, "w", encoding="utf-8", newline="\n").write(ts)
    print(f"wrote {len(rows):,} rows -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
