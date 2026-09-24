"""Calibrate the published number to a 50/50 point, fitted on the PLAYERS BOOKS ACTUALLY PRICE.

Derek: "yes, calibrate it on the priced population."

The first attempt at this fitted median(actual)/mean(projection) over every player-game in the
league. Applied to the board it swung the lean from 67% over to 33% over — badly over-shrunk —
because books only post a line on players with a real role, and those players' distributions are far
less skewed than the league's. A WR5 who catches nothing most weeks has a median of zero and drags
the ratio down; he is also never on the board.

So the population has to be the priced one. prop_snapshots holds a backfilled 2024 season and 2026
weeks 1-2, which gives a genuine split:

    train  2024          fit the ratio
    hold   2026 wk 1-2   report only

WHAT IS FITTED. Our projection is a recency-weighted MEAN; a book's line sits near the MEDIAN. For
priced rows in each band of our projected mean, the ratio median(actual) / mean(projection). The
board then publishes mu * ratio(mu), which is directly comparable to the line.

THE TEST THAT MATTERS is not MAE, it is honesty of the comparison:

    share of rows where OUR NUMBER is above the line     should equal
    share of rows where the ACTUAL RESULT beat the line

If those two agree, a reader comparing our column to the book's column is being told the truth. MAE
is reported alongside and should improve too, since the median minimises absolute error.

    python analysis/priced_median_fit.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "ingest"))

CACHE = os.path.join(ROOT, "data", "_priced_cache")
BOOK = "fanduel"
MARKETS = {                       # odds-feed market -> (stat column, positions)
    "player_reception_yds": ("receiving_yards", ["WR", "TE", "RB"]),
    "player_rush_yds":      ("rushing_yards", ["RB", "QB", "WR"]),
    "player_pass_yds":      ("passing_yards", ["QB"]),
}
HALF_LIFE, CUR_K = 2.5, 1.0
BANDS = [0.0, 15.0, 25.0, 40.0, 60.0, 85.0, 1e9]     # of OUR projected mean


def norm(n):
    import re
    x = re.sub(r"[^a-z ]", "", str(n).lower())
    x = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", x)
    return re.sub(r"\s+", " ", x).strip()


def pull(season, weeks):
    """Closing FanDuel Over lines per (event, player, market). Cached — the pull is slow."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{season}.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    import injuries_nflverse as I
    env = I.load_env(); I.ensure_ssl()
    url, key = env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_KEY"]
    cols = ("event_id,commence_time,week,market,player_name,line,side,"
            "collected_at,snapshot_at,capture_reason")
    mk = ",".join(MARKETS)
    out = {}
    for wk in weeks:
        off, got = 0, 0
        while True:
            q = (f"?season=eq.{season}&week=eq.{wk}&book=eq.{BOOK}&side=eq.Over"
                 f"&market=in.({mk})&select={cols}&order=collected_at.asc")
            req = urllib.request.Request(url + "/rest/v1/prop_snapshots" + q,
                                         headers={"apikey": key, "Authorization": f"Bearer {key}",
                                                  "Range": f"{off}-{off + 999}",
                                                  "Range-Unit": "items"})
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    rows = json.load(r)
            except urllib.error.HTTPError as e:
                print(f"  {season} wk{wk} HTTP {e.code}", file=sys.stderr)
                break
            if not rows:
                break
            for x in rows:
                # WHICH timestamp is the capture time depends on how the row got here, and getting
                # this wrong silently drops an entire season. A live sweep stamps `collected_at`
                # truthfully and leaves `snapshot_at` equal to kickoff on legacy rows. A BACKFILL
                # row is the reverse: `collected_at` is when the backfill RAN (2026-08-23 for the
                # whole 2024 season) while `snapshot_at` carries the real capture, ~10 minutes
                # before kickoff. Testing `collected_at < commence_time` on a backfilled season
                # therefore discards every row and reports "0 priced rows" rather than an error.
                if not x.get("commence_time"):
                    continue
                when = (x.get("snapshot_at") if str(x.get("capture_reason")) == "BACKFILL"
                        else x.get("collected_at"))
                if not when or when >= x["commence_time"]:
                    continue
                # Latest-wins is resolved HERE, on the effective timestamp, rather than by an
                # ORDER BY on snapshot_at: that column is unindexed, and sorting a live season's
                # 360k rows times the request out with a 500.
                k = f'{x["event_id"]}|{norm(x["player_name"])}|{x["market"]}'
                if k not in out or when > out[k]["when"]:
                    out[k] = {"week": x["week"], "market": x["market"], "when": when,
                              "player": norm(x["player_name"]), "line": x["line"]}
            got += len(rows)
            off += 1000
            if len(rows) < 1000:
                break
        print(f"  {season} wk{wk}: {got:,} rows pulled")
    json.dump(out, open(path, "w", encoding="utf-8"))
    return out


def ewma(v, hl=HALF_LIFE):
    lam = 0.5 ** (1.0 / hl)
    w = np.array([lam ** i for i in range(len(v) - 1, -1, -1)])
    return float(np.dot(w, v) / w.sum())


def projections_for(season):
    """{(norm name, week, market): (mu, actual)} using the shipping estimator."""
    cur = pd.read_csv(f"data/stats_{season}.csv", low_memory=False)
    prv_p = f"data/stats_{season - 1}.csv"
    prv = pd.read_csv(prv_p, low_memory=False) if os.path.exists(prv_p) else None
    out = {}
    for mk, (statc, positions) in MARKETS.items():
        d = cur[(cur.season_type == "REG") & cur.position.isin(positions)].copy()
        d[statc] = pd.to_numeric(d[statc], errors="coerce").fillna(0.0)
        d["week"] = pd.to_numeric(d.week, errors="coerce")
        prior = {}
        if prv is not None:
            q = prv[(prv.season_type == "REG") & prv.position.isin(positions)].copy()
            q[statc] = pd.to_numeric(q[statc], errors="coerce").fillna(0.0)
            g = q.groupby("player_id").agg(v=(statc, "sum"), n=("week", "nunique"))
            prior = {str(k): float(r.v / r.n) for k, r in g.iterrows() if r.n}
        hist = {}
        for wk in sorted(int(w) for w in d.week.dropna().unique()):
            c = d[d.week == wk]
            for _, r in c.iterrows():
                pid = str(r.player_id)
                past = hist.get(pid, [])
                pm = prior.get(pid)
                if not past and pm is None:
                    continue
                if not past:
                    mu = pm                      # week 1: prior season alone, as the exporter does
                else:
                    mu = ewma(past)
                    if pm is not None:
                        mu = (len(past) * mu + CUR_K * pm) / (len(past) + CUR_K)
                out[(norm(r.player_display_name), wk, mk)] = (mu, float(r[statc]))
            for _, r in c.iterrows():
                hist.setdefault(str(r.player_id), []).append(float(r[statc]))
    return out


def frame(season, weeks):
    priced = pull(season, weeks)
    proj = projections_for(season)
    rows = []
    for v in priced.values():
        k = (v["player"], int(v["week"]), v["market"])
        if k not in proj or v["line"] is None:
            continue
        mu, act = proj[k]
        rows.append({"market": v["market"], "mu": mu, "line": float(v["line"]), "actual": act})
    return pd.DataFrame(rows)


def ratios_for(tr):
    out = []
    for i in range(len(BANDS) - 1):
        b = tr[(tr.mu >= BANDS[i]) & (tr.mu < BANDS[i + 1])]
        out.append(float(b.actual.median() / b.mu.mean()) if len(b) >= 60 and b.mu.mean() > 0 else None)
    known = [i for i, v in enumerate(out) if v is not None]
    for i in range(len(out)):
        if out[i] is None:
            out[i] = out[min(known, key=lambda j: abs(j - i))] if known else 1.0
    return out


def apply_r(mu, r):
    idx = np.clip(np.searchsorted(BANDS, mu, side="right") - 1, 0, len(r) - 1)
    return mu * np.array(r)[idx]


def main():
    print("pulling priced rows (cached after the first run)…")
    tr = frame(2024, range(1, 19))
    ho = frame(2026, range(1, 3))
    print(f"\ntrain 2024: {len(tr):,} priced rows   held-out 2026 wk1-2: {len(ho):,}\n")
    if tr.empty:
        print("no train rows — nothing to fit"); return
    emit = {}
    for mk in MARKETS:
        t = tr[tr.market == mk]
        h = ho[ho.market == mk] if not ho.empty else ho
        if len(t) < 300:
            print(f"{mk}: only {len(t)} train rows — skipped")
            continue
        r = ratios_for(t)
        emit[mk] = r
        print(f"{mk}   train {len(t):,}  held-out {len(h):,}")
        print("  band of our mean :  " + "  ".join(
            f"{BANDS[i]:.0f}-{BANDS[i+1]:.0f}" if BANDS[i + 1] < 1e8 else f"{BANDS[i]:.0f}+"
            for i in range(len(r))))
        print("  ratio            :  " + "  ".join(f"{x:7.2f}" for x in r))
        for lab, s in (("train", t), ("held-out", h)):
            if len(s) < 50:
                continue
            new = apply_r(s.mu.values, r)
            over_now = 100 * (s.mu.values > s.line.values).mean()
            over_new = 100 * (new > s.line.values).mean()
            over_act = 100 * (s.actual.values > s.line.values).mean()
            mae_now = float(np.abs(s.mu.values - s.actual.values).mean())
            mae_new = float(np.abs(new - s.actual.values).mean())
            print(f"    {lab:9s} our number over the line {over_now:5.1f}% -> {over_new:5.1f}%   "
                  f"ACTUAL over the line {over_act:5.1f}%   MAE {mae_now:6.2f} -> {mae_new:6.2f}")
        print()
    print("\n# paste into analysis/player_proj_export.py")
    print(f"PUBLISH_BANDS = {BANDS[:-1]}")
    print("PUBLISH_RATIO = {")
    for m, r in emit.items():
        print(f'    "{m}": {[round(x, 3) for x in r]},')
    print("}")


if __name__ == "__main__":
    main()
