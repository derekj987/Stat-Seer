"""NCAAF volume inflation: DECAY_RETURN weights a player's current season almost out of existence.

Derek: "let's fix the NCAAF volume inflation."

The diagnosis, and it was not the suspect. `weekly_flags` had the NCAAF board at median proj/line
1.87 in the bottom band with rows at 2x a real line, which looks exactly like the `rolevol` ratchet
this project has fixed before. It is not:

  * the inflated rows have 14-27 games of history, not thin samples, so the role baseline carries
    almost no weight on them;
  * board-wide at 6+ games of history the median proj/line is exactly 1.00;
  * our projection tracks each player's OWN production closely — median proj/own 1.07, 0.93, 0.91,
    0.85 across the line bands.

The problem is WHICH of his own production. Look at what the board publishes against what these
players are actually doing this season:

    player            own 2026    own all-time    ours
    Dylan Wade           17.5          40.5       43.9
    Colton Joseph        27.3          72.5       64.8
    Trent Walker         21.3          68.8       57.0

We publish the career rate. The cause is `_decay_for`, which hands every player NOT flagged as
promoted `DECAY_RETURN = 0.94` — a half-life of 11.2 games. Across a 25-game log the three most
recent games carry about 17% of the weight and everything before this season carries the rest. The
NFL side measured the equivalent quantity at a 2.5-game half-life (decay ~0.76), and CFB's own
default DECAY is 0.82 (3.5 games); 0.94 is the outlier, and it is the branch most of the board takes.

This sweeps it against what players actually did next, the same way the NFL half-life was chosen.

    train  2024-2025      choose
    hold   2026           report only
    python analysis/cfb_decay_sweep.py
"""
from __future__ import annotations

import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# The VOLUME fields the projection is actually built from, plus the yardage they produce.
FIELDS = ["carries", "receptions", "pass_att", "rush_yds", "rec_yds", "pass_yds"]
DECAYS = [0.94, 0.90, 0.86, 0.82, 0.78, 0.74, 0.70, 0.65]
MIN_PRIOR = 3


def wavg(vals, d):
    n = len(vals)
    w = np.array([d ** (n - 1 - i) for i in range(n)], dtype=float)
    return float(np.dot(w, vals) / w.sum())


def main():
    import cfb_player_proj as C
    import odds_client as oc
    key = oc.load_env().get("CFBD_API_KEY")
    st, teams = C.cc.cfbd_get("/teams/fbs", {"year": C.CUR_SEASON}, key)
    schools = [t["school"] for t in teams if t.get("school")]
    print(f"{len(schools)} FBS teams; fetching logs...")
    logs = C.team_logs(schools, key)
    print(f"{len(logs):,} athletes\n")

    # One row per (player, field, target game): the history before it, and what he then did.
    rows = {f: [] for f in FIELDS}
    for e in logs.values():
        gs = e.get("games", [])
        for f in FIELDS:
            seq = [(g.get("season"), g.get(f)) for g in gs if g.get(f) is not None]
            for i in range(MIN_PRIOR, len(seq)):
                past = [v for _, v in seq[:i]]
                season, actual = seq[i]
                rows[f].append((season, past, float(actual)))

    print(f"  {'field':11s} {'train n':>8s} {'hold n':>7s} | "
          + " ".join(f"{d:>6.2f}" for d in DECAYS))
    best = {}
    for f in FIELDS:
        tr = [r for r in rows[f] if r[0] in (2024, 2025)]
        ho = [r for r in rows[f] if r[0] == C.CUR_SEASON]
        if len(tr) < 2000 or len(ho) < 200:
            print(f"  {f:11s} too few rows ({len(tr)}/{len(ho)})")
            continue
        maes = []
        for d in DECAYS:
            pred = np.array([wavg(p, d) for _, p, _ in tr])
            act = np.array([a for _, _, a in tr])
            maes.append(float(np.abs(pred - act).mean()))
        b = DECAYS[int(np.argmin(maes))]
        best[f] = b
        cells = " ".join(f"{m:6.2f}" for m in maes)
        print(f"  {f:11s} {len(tr):8,d} {len(ho):7,d} | {cells}   best {b}")

    print("\nHELD-OUT 2026 — what ships (0.94) against the chosen value")
    print(f"  {'field':11s} {'n':>7s} {'MAE @0.94':>10s} {'MAE @best':>10s} {'gain':>7s} {'best':>5s}")
    for f in FIELDS:
        if f not in best:
            continue
        ho = [r for r in rows[f] if r[0] == C.CUR_SEASON]
        act = np.array([a for _, _, a in ho])
        base = float(np.abs(np.array([wavg(p, 0.94) for _, p, _ in ho]) - act).mean())
        new = float(np.abs(np.array([wavg(p, best[f]) for _, p, _ in ho]) - act).mean())
        print(f"  {f:11s} {len(ho):7,d} {base:10.3f} {new:10.3f} "
              f"{(base - new) / base * 100:+6.2f}% {best[f]:5.2f}")

    print("\n  (DECAY_MOVED = 0.78 and DECAY = 0.82 are the other two settings in the file;")
    print("   DECAY_RETURN = 0.94 is the branch most priced players take.)")


if __name__ == "__main__":
    main()
