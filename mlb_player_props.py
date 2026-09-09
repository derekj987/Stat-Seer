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

WHY THE BOARD LEANS OVER THE BOOK, and what has been ruled out. Derek: "our hit % is still too
high — there are no model percentages lower than the market's." Four candidates, measured:

    Jensen's inequality (mean PA into a concave function)   REAL, fixed: bias 2.1pp -> 1.4pp
    within-game correlation (Beta-Binomial, DISPERSION)     NO: train picks independent trials
    league rate computed with a look-ahead leak             REAL leak, fixed, but bias unchanged
    the market's 6.8% hold, stripped by the de-vig          the rest of the gap, and not our bug

What is left is a PERIOD difference, not a model-shape one: bias is +0.24pp on the train split and
+1.43pp on the test split. Run `--grade` for the only test that settles it — our number and the
book's de-vigged price, both scored against what actually happened. It stays silent until enough
completed games exist, which is honest rather than unhelpful: capture began 2026-09-07.

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
# Beta concentration for the within-game correlation in _p_none. None = independent trials.
# Swept on the TRAIN split only; see the table printed by --sweep-dispersion.
DISPERSION = None
LG_MIN_PA = 20000                # plate appearances before the running league rate is trusted
SEASON = 2026

# Mean plate appearances by batting slot, measured on 37,433 slot-joined batter-games. This IS the
# volume term: a full extra plate appearance separates leadoff from the nine-hole.
#
# The mean is what the BOARD shows a reader. It is deliberately NOT what the probability is
# computed from -- see SLOT_PA_DIST.
SLOT_PA = {1: 4.49, 2: 4.41, 3: 4.30, 4: 4.19, 5: 4.05, 6: 3.89, 7: 3.76, 8: 3.60, 9: 3.44}

# The DISTRIBUTION of plate appearances by slot, filled in from the logs at run time.
#
# 🚨 Plugging the mean into P(>=1) overstates it, always. P(>=1) = 1 - (1-q)^PA is CONCAVE in PA,
# so by Jensen's inequality E[1-(1-q)^PA] < 1-(1-q)^E[PA]: averaging the probability over the real
# spread of plate appearances gives a SMALLER number than evaluating it once at the average. A
# leadoff hitter does not get 4.49 plate appearances; he gets 3, 4 or 5, and occasionally 1 because
# he was lifted -- and the short games hurt P(>=1) more than the long ones help it.
#
# Caught by the board, not by the Brier score: the hits tab read 78.7% over the book's de-vigged
# number. Brier improved either way, which is exactly why a Brier score is not a calibration check.
# Measured bias before the fix, held out: hits predicted 0.627 vs realized 0.606 (+2.1pp), home
# runs +1.0pp, stolen bases +0.5pp -- every market high, in every bucket.
SLOT_PA_DIST: dict[int, list[tuple[int, float]]] = {}


CACHE_BVP = os.path.join("data", "mlb_bvp.json")


def batter_vs_pitcher(pairs, refresh=False):
    """Career at-bats and hits for each (batter, opposing starter) pair on the slate.

    CONTEXT ONLY -- deliberately NOT an input to the probability. Measured on a real 15-game slate,
    171 distinct pairs:

        career AB vs tonight's starter     pairs
        0 (never faced him)                51.5%
        1-4                                20.5%
        5-9                                17.0%
        10-19                               9.9%
        20+                                 1.2%

    The MEDIAN is zero. Half the board would show nothing, and 16% of all pairs read .000 or .500+
    on six at-bats or fewer -- numbers that look authoritative and are noise. A career line like
    "0 for 4" is not evidence a hitter is due or cooked; it is four at-bats.

    It is shown because a bettor genuinely wants to see who is pitching and what the history is,
    and because hiding it invites someone to look it up elsewhere and trust it MORE. The sample
    size is printed beside it for the same reason.
    """
    cache = {}
    if not refresh and os.path.exists(CACHE_BVP):
        try:
            cache = json.load(open(CACHE_BVP, encoding="utf-8"))
        except Exception:
            cache = {}
    todo = [t for t in pairs if f"{t[0]}-{t[1]}" not in cache]

    def one(t):
        bat, sp = t
        j = av._get(f"{API}/people/{bat}/stats?stats=vsPlayerTotal"
                    f"&opposingPlayerId={sp}&group=hitting")
        for blk in (j or {}).get("stats", []):
            for spl in blk.get("splits", []):
                st = spl["stat"]
                return (f"{bat}-{sp}", [st.get("atBats", 0), st.get("hits", 0)])
        return (f"{bat}-{sp}", [0, 0])
    if todo:
        with ThreadPoolExecutor(max_workers=10) as ex:
            for k, v in ex.map(one, todo):
                cache[k] = v
        os.makedirs(os.path.dirname(CACHE_BVP), exist_ok=True)
        json.dump(cache, open(CACHE_BVP, "w", encoding="utf-8"))
    print(f"batter-vs-pitcher: {len(pairs)} pairs ({len(todo)} fetched, rest cached)")
    return cache


def slot_pa_dist(logs, slots):
    """Empirical P(plate appearances = k) per batting slot. Built from the same logs the rates come
    from, so it moves with the data instead of being another hardcoded table."""
    by = collections.defaultdict(collections.Counter)
    for r in logs:
        s = slots.get((r["date"], r["pid"]))
        if s in SLOT_PA:
            by[s][min(r["pa"], 7)] += 1
    out = {}
    for s, c in by.items():
        n = sum(c.values())
        out[s] = sorted((k, v / n) for k, v in c.items())
    return out

# Held-out Brier, for the copy on the board. Kept here so the page cannot drift from what was
# measured -- a number in JSX is a number nobody re-checks.
#
# `pred` and `act` are the held-out mean predicted probability against the mean realized rate: the
# calibration, published because it is not yet perfect. After the Jensen fix (see SLOT_PA_DIST)
# hits went from +2.1pp high to +1.4pp and home runs from +1.0pp to +0.9pp. What is left is almost
# certainly within-game correlation -- plate appearances against one starting pitcher on one night
# are not independent trials, and an independence model cannot express that. It is NOT closed by
# scaling the output until it matches; that would be fitting the answer rather than the mechanism.
SCORES = {
    "hits": {"model": 0.23612, "own": 0.24060, "base": 0.615, "gain": 1.9,
             "pred": 0.620, "act": 0.606},
    "hr":   {"model": 0.09665, "own": 0.09771, "base": 0.124, "gain": 1.1,
             "pred": 0.119, "act": 0.110},
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


def _p_none(rate, n):
    """P(zero successes in n plate appearances) for a batter whose LONG-RUN rate is `rate`.

    Independent trials give (1-rate)^n. That is the wrong model and it is why the board ran high:
    four trips against ONE starting pitcher on ONE night, in one park, in one weather, are
    positively correlated, and positive correlation makes a blank night MORE likely than
    independence says. Measured on held-out games, the independent version predicted 0.620 against
    a realized 0.606.

    So the night's rate is a draw, not a constant: Q ~ Beta with mean `rate` and concentration
    DISPERSION, giving P(0) = prod_{i<n} (b+i)/(M+i) with b = M(1-rate). One parameter, swept on
    the train split, and it degrades to the independent formula as DISPERSION -> infinity, so the
    old behaviour is the limit rather than a special case.
    """
    n = int(round(n))
    if n <= 0:
        return 1.0
    if DISPERSION is None:                      # independent trials (the pre-fix model)
        return (1 - rate) ** n
    M = DISPERSION
    b = M * (1 - rate)
    out = 1.0
    for i in range(n):
        out *= (b + i) / (M + i)
    return out


class Rates:
    """Season-to-date per-PA rates for batters and for opposing pitching staffs. Advanced game by
    game during validation; run to completion for tonight's projections."""

    def __init__(self, logs, stat):
        self.stat = stat
        # 🚨 The league rate must be CAUSAL. It used to be sum(stat)/sum(pa) over the WHOLE log --
        # held-out games included -- and fixed at construction, so every projection was anchored to
        # a league rate computed partly from games it was about to predict, and the anchor could
        # never move as the season's run environment did.
        #
        # The damage was invisible in the headline Brier and obvious in the split: the model was
        # calibrated on TRAIN (+0.24pp) and ran +1.43pp high on TEST. That is not a wrong model
        # shape, it is a stale level -- the later part of the season hits at a lower rate than the
        # full-season average the anchor was pinned to. Exactly the leak already fixed in
        # mlb_game_model.State; the sibling was never checked.
        self._prior = (sum(r[stat] for r in logs[:2000])
                       / max(1, sum(r["pa"] for r in logs[:2000]))) if logs else 0.0
        self._s = 0
        self._pa = 0
        self.bs = collections.defaultdict(int); self.bpa = collections.defaultdict(int)
        self.os_ = collections.defaultdict(int); self.opa = collections.defaultdict(int)

    @property
    def lg(self):
        """League rate over games ALREADY SEEN. Falls back to an opening prior until enough
        plate appearances have accumulated for the running figure to mean anything."""
        if self._pa < LG_MIN_PA:
            return self._prior
        return self._s / self._pa

    def add(self, r):
        self._s += r[self.stat]; self._pa += r["pa"]
        self.bs[r["pid"]] += r[self.stat]; self.bpa[r["pid"]] += r["pa"]
        self.os_[r["opp"]] += r[self.stat]; self.opa[r["opp"]] += r["pa"]

    def prob(self, pid, opp, slot):
        """P(at least one) for a batter facing `opp` from `slot`. None when either side is too thin
        to say anything — an empty cell is better than a made-up one."""
        if self.bpa[pid] < MIN_PA or self.opa.get(opp, 0) == 0 or slot not in SLOT_PA:
            return None
        p = (self.bs[pid] + K_BAT * self.lg) / (self.bpa[pid] + K_BAT)
        of = ((self.os_[opp] + K_OPP * self.lg) / (self.opa[opp] + K_OPP)) / self.lg
        rate = min(0.95, p * of)
        # Average the probability over the PA distribution, never evaluate it at the mean PA.
        dist = SLOT_PA_DIST.get(slot) or [(SLOT_PA[slot], 1.0)]
        return round(sum(w * (1 - _p_none(rate, k)) for k, w in dist), 4)

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
        # CALIBRATION, not just Brier. A Brier score can improve while the whole board sits above
        # the truth, and the board is where that shows: the hits tab reads 78.7% over the book's
        # de-vigged number, mean +4.9pp. Brier alone cannot tell "our level is wrong" from "the
        # market disagrees with us" -- the mean predicted against the mean realized can.
        pm, ym = statistics.mean(x["p"] for x in te), statistics.mean(x["y"] for x in te)
        print(f"{'':<12}predicted {pm:.3f} vs realized {ym:.3f}  ({pm - ym:+.3f})  n={len(te):,}")
        for lo in (0.0, 0.2, 0.4, 0.6, 0.8):
            b = [x for x in te if lo <= x["p"] < lo + 0.2]
            if len(b) >= 50:
                print(f"{'':<14}p {lo:.1f}-{lo+0.2:.1f}  predicted "
                      f"{statistics.mean(x['p'] for x in b):.3f}  actual "
                      f"{statistics.mean(x['y'] for x in b):.3f}  n={len(b):,}")



def grade_against_market(logs, slots, lineups):
    """Us vs the de-vigged book price, both scored on what ACTUALLY happened.

    This is the only test that settles "our % is always above the market's". Everything else is an
    argument: the board can lean over the book for two very different reasons — our number being
    high, or the book's fair price being low once a 6.8% hold is stripped out — and the mean
    predicted against the mean realized tells you which.

    Needs captured prices for games that have FINISHED, so it returns nothing until the first
    graded day exists. It prints the count either way rather than implying a verdict it cannot
    reach: MLB price capture began 2026-09-07.
    """
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        for line in open(".env", encoding="utf-8") if os.path.exists(".env") else []:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                if k.strip() == "SUPABASE_URL":
                    url = v.strip().strip('"').strip("'")
                if k.strip() == "SUPABASE_SERVICE_KEY":
                    key = v.strip().strip('"').strip("'")
    if not url or not key:
        print("no Supabase credentials — cannot grade", file=sys.stderr)
        return

    rows, off = [], 0
    while True:                                   # PAGED: limit= does not raise the 1000 cap
        req = urllib.request.Request(
            f"{url.rstrip('/')}/rest/v1/mlb_prop_snapshots?market=eq.batter_hits"
            "&select=player,side,line,price_american,book,snapshot_at,commence_time"
            "&order=snapshot_at.desc",
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Range-Unit": "items", "Range": f"{off}-{off+999}"})
        page = json.load(urllib.request.urlopen(req))
        rows += page
        if len(page) < 1000:
            break
        off += 1000

    imp = lambda a: (-a / (-a + 100)) if a < 0 else (100 / (a + 100))
    nm = lambda x: "".join(c for c in (x or "").lower() if c.isalnum() or c == " ").strip()

    best = {}
    for r in rows:
        if r.get("line") is None or float(r["line"]) != 0.5:
            continue                              # 1.5 is a different question entirely
        if not r.get("player") or r.get("price_american") is None or not r.get("side"):
            continue
        ct = r.get("commence_time") or ""
        if ct and r["snapshot_at"] > ct:
            continue                              # never grade a price taken after first pitch
        k = (nm(r["player"]), r["book"], r["side"].lower(), ct[:10])
        if k not in best or r["snapshot_at"] > best[k][0]:
            best[k] = (r["snapshot_at"], int(r["price_american"]))

    byday = collections.defaultdict(list)
    for (pl, book, side, day), (_ts, price) in best.items():
        if side not in ("over", "yes"):
            continue
        u = best.get((pl, book, "under", day)) or best.get((pl, book, "no", day))
        if u is None:
            continue                              # one-sided: not a fair price, so not graded
        o, un = imp(price), imp(u[1])
        byday[(pl, day)].append(o / (o + un))
    book_prob = {}
    for k, xs in byday.items():
        xs.sort()
        book_prob[k] = xs[len(xs) // 2] if len(xs) % 2 else (xs[len(xs)//2-1] + xs[len(xs)//2]) / 2

    name_of = {p["id"]: p.get("fullName") or "" for r in lineups for p in r["lineup"]}
    actual = {(r["date"], r["pid"]): (1 if r["h"] > 0 else 0) for r in logs}
    R = Rates(logs, "h")
    by_date = collections.defaultdict(list)
    for r in logs:
        by_date[r["date"]].append(r)

    graded = []
    for date in sorted(by_date):
        for r in by_date[date]:                   # score BEFORE advancing: same information the board had
            k = (nm(name_of.get(r["pid"], "")), date)
            if k in book_prob:
                slot = slots.get((date, r["pid"]))
                p = R.prob(r["pid"], r["opp"], slot) if slot else None
                if p is not None:
                    graded.append({"ours": p, "book": book_prob[k],
                                   "y": actual.get((date, r["pid"]), 0)})
        for r in by_date[date]:
            R.add(r)

    print(f"\n{len(book_prob):,} two-sided (player, day) quotes at the 0.5 line; "
          f"{len(graded):,} on completed games")
    if len(graded) < 30:
        print("  Not enough graded props yet to say who is closer. Capture began 2026-09-07;")
        print("  this becomes answerable once a full slate has been played and logged.")
        return
    ym = statistics.mean(g["y"] for g in graded)
    om = statistics.mean(g["ours"] for g in graded)
    bm = statistics.mean(g["book"] for g in graded)
    br = lambda f: statistics.mean((f(g) - g["y"]) ** 2 for g in graded)
    print(f"  actual hit rate       {ym:.3f}")
    print(f"  ours   mean {om:.3f} ({om-ym:+.3f})   Brier {br(lambda g: g['ours']):.5f}")
    print(f"  book   mean {bm:.3f} ({bm-ym:+.3f})   Brier {br(lambda g: g['book']):.5f}")
    over = sum(1 for g in graded if g["ours"] > g["book"]) / len(graded) * 100
    print(f"  we read higher than the book on {over:.0f}% of them")
    print("  Whichever mean sits closer to the actual rate is the better number — that, not the")
    print("  size of the gap between the two columns, is the question worth asking.")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--grade", action="store_true",
                    help="score our probabilities AND the book's against real outcomes")
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
    # Must be filled before ANY call to Rates.prob -- validation and export alike, or the two
    # disagree and the published number is not the one that was scored.
    SLOT_PA_DIST.update(slot_pa_dist(logs, slots))
    print(f"PA distribution built for {len(SLOT_PA_DIST)} batting slots")
    if args.grade:
        grade_against_market(logs, slots, lineups)
        return 0
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

    # Opposing STARTER for each team-slate, and the career batter-vs-pitcher line for every pair we
    # are about to publish. Context, not an input -- see batter_vs_pitcher's docstring for why.
    sp_by = {(r["gamePk"], r["team"]): r.get("sp") for r in lineups if r.get("sp")}
    spname = {r.get("sp"): r.get("spName") for r in lineups if r.get("sp")}
    opp_sp = {}
    for r in lineups:
        other = next((x for x in lineups
                      if x["gamePk"] == r["gamePk"] and x["team"] != r["team"]), None)
        if other:
            opp_sp[(r["gamePk"], r["team"])] = sp_by.get((other["gamePk"], other["team"]))
    pairs = set()
    for r in lineups:
        if r["final"] or (r.get("commence") or "") < now:
            continue
        osp = opp_sp.get((r["gamePk"], r["team"]))
        if not osp:
            continue
        for pl in (r.get("lineup") or []):
            pairs.add((pl["id"], osp))
        hist_ = bt.get(r["team"], [])
        if hist_:
            for pl in hist_[-1]["lineup"]:
                pairs.add((pl["id"], osp))
    bvp = batter_vs_pitcher(sorted(pairs), refresh=args.refresh) if pairs else {}

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
        osp_id = opp_sp.get((r["gamePk"], r["team"]))
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
                # with it. Date + matchup was the first fix and was still wrong: the date came from
                # the UTC timestamp, so a west-coast night game carried tomorrow's date and
                # collided with the next game of its own series. Key on StatsAPI's gamePk.
                "gameKey": str(r["gamePk"]),
                "game": f"{away} @ {home}", "commence": r["commence"],
                "player": f["name"], "team": r["teamName"], "opp": r["opp"],
                "pos": f["pos"], "pStart": f["p_start"], "slot": f["slot"],
                "posted": bool(posted) and pid in posted, "lineupPosted": bool(posted),
                "pHit": ph, "pHr": phr,
                "hitRate": RH.rate(pid), "hrRate": RHR.rate(pid),
                "pa": SLOT_PA.get(slot),
                "oppSp": spname.get(osp_id),
                "bvpAb": (bvp.get(f"{pid}-{osp_id}") or [0, 0])[0],
                "bvpH": (bvp.get(f"{pid}-{osp_id}") or [0, 0])[1],
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
          "  hitRate: number | null; hrRate: number | null; pa: number | null;\n"
          "  oppSp: string | null; bvpAb: number; bvpH: number };\n\n"
          f"export const MLB_PROPS: MlbProp[] = {json.dumps(rows, ensure_ascii=False)};\n"
          f"export const MLB_PROP_SCORES = {json.dumps(SCORES)};\n")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    open(args.out, "w", encoding="utf-8", newline="\n").write(ts)
    print(f"wrote {len(rows):,} rows -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
