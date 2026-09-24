"""Calibrate the NCAAF board to a 50/50 number, the way the NFL board was.

Derek: "for all the work that we've done for the NFL today, let's ensure these bugs, checks, fixes,
and analysis are applied to the NCAAF side."

Measured before assuming, and NCAAF has the same defect the NFL board had:

    market        n     over   sd(line)  sd(ours)   slope(ours ~ line)
    rec_yds     237     74%       19.9      18.8          0.794
    receptions  130     62%        1.4       1.2          0.671
    rush_yds    128     60%       26.2      25.9          0.818
    anytime_td 1263     35%       17.1      19.9          0.550   <- the control, correct

    TILT  rec_yds   top half of each game 59% over, bottom half 88% over   gap 30 pts

Same cause: we publish a recency-weighted MEAN and a book prices near the MEDIAN. Anytime TD sits
at ~35% in both sports because there our number and the book's are both probabilities.

WHY IT CANNOT REUSE THE NFL RATIOS: a conversion is only valid for the population it was fitted on,
which the NFL side learned twice. College distributions are not professional ones.

THE JOIN, and the first version that was wrong. The odds feed and ESPN share no game key, so the
first cut pooled each priced player's games by his SEASON MEAN — which conditions on the outcome and
pulled every ratio to ~0.95, nothing like the NFL's 0.68-1.02 curve. `cfb.db` has the schedule, so
(gid -> week) and (kickoff date -> week) give a real per-row join and the line stays matched to the
result game by game.

    python analysis/cfb_median_fit.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from collections import defaultdict

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "ingest"))

BOOK = "fanduel"
MARKETS = {
    "player_reception_yds": "rec_yds",
    "player_rush_yds": "rush_yds",
    "player_pass_yds": "pass_yds",
    "player_receptions": "receptions",
}
BANDS = [0.0, 18.0, 28.0, 45.0, 62.0, 80.0]


def norm(n):
    """The NCAAF key, borrowed rather than re-implemented.

    Writing a second normaliser is how the first run returned zero matches from 14,333 athletes:
    `cfb_player_proj.norm` strips spaces entirely ("karmelloenglish") while the obvious spelling
    keeps them ("karmello english"). It does not raise — it joins nothing, which reads as missing
    data. Always import the normaliser the data was keyed with."""
    import cfb_player_proj as C
    return C.norm(str(n))


def week_maps():
    """(gid -> week, kickoff date -> week) for the current season, from cfb.db."""
    import sqlite3
    import cfb_player_proj as C
    conn = sqlite3.connect(C.DB)
    rows = conn.execute("SELECT id, week, start_date FROM games WHERE season=?",
                        (C.CUR_SEASON,)).fetchall()
    conn.close()
    gid_week = {int(i): int(w) for i, w, _ in rows if i is not None and w is not None}
    date_week = {str(sd)[:10]: int(w) for _, w, sd in rows if sd and w is not None}
    return gid_week, date_week


def priced_rows(date_week):
    """{(week, market, name): closing line} — newest PREGAME capture per player-market-week."""
    import injuries_nflverse as I
    env = I.load_env(); I.ensure_ssl()
    url, key = env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_KEY"]
    best, mk, off, seen = {}, ",".join(MARKETS), 0, 0
    while True:
        q = (f"?book=eq.{BOOK}&side=eq.Over&market=in.({mk})"
             f"&select=player,market,line,commence,snapshot_at&order=id.asc")
        req = urllib.request.Request(url + "/rest/v1/cfb_prop_snapshots" + q,
                                     headers={"apikey": key, "Authorization": f"Bearer {key}",
                                              "Range": f"{off}-{off + 999}", "Range-Unit": "items"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                rows = json.load(r)
        except urllib.error.HTTPError as e:
            print(f"  HTTP {e.code} at offset {off}", file=sys.stderr)
            break
        if not rows:
            break
        for x in rows:
            snap, com = x.get("snapshot_at"), x.get("commence")
            if not com or x.get("line") is None or not x.get("player"):
                continue
            if snap and snap >= com:      # captured after kickoff: a live number, not a price
                continue
            wk = date_week.get(com[:10])
            if wk is None:                # a late kickoff rolls past midnight UTC
                from datetime import date, timedelta
                wk = date_week.get(str(date(int(com[0:4]), int(com[5:7]), int(com[8:10]))
                                        - timedelta(days=1)))
            if wk is None:
                continue
            k = (wk, x["market"], norm(x["player"]))
            if k not in best or (snap or "") > best[k][0]:
                best[k] = ((snap or ""), float(x["line"]))
        seen += len(rows)
        off += 1000
        if len(rows) < 1000:
            break
    print(f"  scanned {seen:,} prop rows -> {len(best):,} closing lines")
    return {k: v[1] for k, v in best.items()}


def outcomes(gid_week):
    """{(week, market, name): actual} for the current season."""
    import cfb_player_proj as C
    import odds_client as oc
    key = oc.load_env().get("CFBD_API_KEY")
    if not key:
        print("  CFBD_API_KEY missing from .env", file=sys.stderr)
        return {}
    st, teams = C.cc.cfbd_get("/teams/fbs", {"year": C.CUR_SEASON}, key)
    schools = [t.get("school") for t in teams if t.get("school")] if isinstance(teams, list) else []
    if not schools:
        print(f"  /teams/fbs returned {st}", file=sys.stderr)
        return {}
    print(f"  {len(schools)} FBS teams; fetching logs...")
    logs = C.team_logs(schools, key)
    out = {}
    for nm, e in logs.items():
        for g in e.get("games", []):
            if g.get("season") != C.CUR_SEASON:
                continue
            wk = gid_week.get(int(g.get("gid") or 0))
            if wk is None:
                continue
            for market, field in MARKETS.items():
                v = g.get(field)
                if v is not None:
                    out[(wk, market, nm)] = float(v)
    print(f"  {len(out):,} player-week-market outcomes")
    return out


def main():
    gid_week, date_week = week_maps()
    print(f"schedule: {len(gid_week):,} games, {len(set(gid_week.values()))} weeks")
    print("pulling NCAAF closing lines...")
    lines = priced_rows(date_week)
    print("fetching current-season game logs...")
    acts = outcomes(gid_week)

    pairs = defaultdict(list)
    for k, ln in lines.items():
        if k in acts:
            pairs[k[1]].append((ln, acts[k]))
    print("\njoined (line, actual) pairs: "
          + ", ".join(f"{m.split('_', 1)[1]} {len(v)}" for m, v in sorted(pairs.items())))

    emit = {}
    for mk, field in MARKETS.items():
        pr = pairs.get(mk, [])
        if len(pr) < 120:
            print(f"\n{mk}: only {len(pr)} joined pairs -- skipped")
            continue
        L = np.array([x[0] for x in pr], float)
        A = np.array([x[1] for x in pr], float)
        print(f"\n{mk}   pairs {len(pr)}   actual over the line {100 * (A > L).mean():.0f}%")
        print(f"  {'line band':>12s} {'n':>6s} {'mean act':>9s} {'med act':>8s} {'med/mean':>9s}")
        ratios = []
        for i in range(len(BANDS)):
            lo = BANDS[i]
            hi = BANDS[i + 1] if i + 1 < len(BANDS) else 1e9
            sel = (L >= lo) & (L < hi)
            if int(sel.sum()) < 40:
                ratios.append(None)
                continue
            mu, md = float(A[sel].mean()), float(np.median(A[sel]))
            ratios.append(md / mu if mu > 0 else 1.0)
            lab = f"{lo:.0f}-{hi:.0f}" if hi < 1e8 else f"{lo:.0f}+"
            print(f"  {lab:>12s} {int(sel.sum()):6d} {mu:9.1f} {md:8.1f} {md / mu:9.2f}")
        known = [i for i, v in enumerate(ratios) if v is not None]
        if not known:
            continue
        ratios = [ratios[i] if ratios[i] is not None
                  else ratios[min(known, key=lambda j: abs(j - i))] for i in range(len(ratios))]
        # Monotone: skew can only shrink as the level rises. Without this a thin top band inverts
        # the curve and shoves the best players back down -- the bug the NFL side had to fix.
        for i in range(1, len(ratios)):
            ratios[i] = max(ratios[i], ratios[i - 1])
        emit[field] = [round(x, 3) for x in ratios]

    print("\n\n# paste into cfb_player_proj.py")
    print(f"PUBLISH_BANDS = {BANDS}")
    print("PUBLISH_RATIO = {")
    for f, r in emit.items():
        print(f'    "{f}": {r},')
    print("}")


if __name__ == "__main__":
    main()
