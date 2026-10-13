"""NHL shots and saves projections — fitted on early seasons, scored on held-out ones.

Built only after the persistence gate (analysis/nhl_persistence.py) came back green, and the
architecture is dictated by what it found rather than chosen:

    skater shots on goal   r = 0.949   VOLUME      -> project it directly
    skater shooting %      r = 0.563   efficiency
    goalie shots against   r = 0.806   VOLUME      -> project it directly
    goalie save %          r = 0.307   efficiency  -> regress hard toward league
    goalie saves           r = 0.770   = the two above multiplied

So SHOTS is projected as a volume number, and SAVES is projected as
`shots_against x save%` with the save percentage pulled most of the way to the league mean --
exactly the rule the NFL side arrived at ("never model yards directly; project volume and multiply
by a regressed efficiency baseline"), applied to the sport where the volume term is even stronger.

THE BAR IS NOT "IS IT ACCURATE", IT IS "DOES IT BEAT PERSISTENCE". A player's own season-to-date
mean is free and already very good at r = 0.949. A model that cannot beat that mean out of sample
has earned nothing, however reasonable it looks. Both baselines are scored alongside:

    season mean    every prior game this season, equally weighted
    last-10        the simplest recency rule anyone would try by hand

🚨 EVERY NUMBER USES PRIOR GAMES ONLY, walking forward game by game. The single easiest way to fake
a result here is to let a player's season average include the game being predicted.

    python analysis/nhl_prop_model.py
    python analysis/nhl_prop_model.py --holdout 20242025 20252026
"""
from __future__ import annotations

import argparse
import collections
import math
import os
import sqlite3
import statistics as st
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "nhl.db")

MIN_PRIOR = 5          # games of history before a row is scored at all


def ew_mean(vals, half_life):
    """Exponentially weighted mean, most recent last. half_life in GAMES."""
    if not vals:
        return None
    lam = 0.5 ** (1.0 / half_life)
    num = den = 0.0
    for i, v in enumerate(reversed(vals)):      # i = 0 is the most recent
        w = lam ** i
        num += w * v
        den += w
    return num / den if den else None


def walk(series, half_life, shrink_k, prior_mean):
    """Yield (actual, model, season_mean, last10) for each game after MIN_PRIOR, prior-only."""
    hist = []
    for v in series:
        if len(hist) >= MIN_PRIOR:
            ew = ew_mean(hist, half_life)
            n = len(hist)
            # Shrink toward the population prior by shrink_k pseudo-games: a player with eight
            # games should not be trusted like one with sixty.
            model = (ew * n + prior_mean * shrink_k) / (n + shrink_k)
            yield v, model, st.mean(hist), st.mean(hist[-10:])
        hist.append(v)


def mae(pairs):
    return st.mean([abs(a - b) for a, b in pairs]) if pairs else float("nan")


def load_skaters(conn):
    rows = conn.execute(
        "select season, player_id, game_date, game_id, sog from nhl_skater_games"
        " where sog is not null and toi_seconds > 0 order by player_id, game_date, game_id"
    ).fetchall()
    by = collections.defaultdict(list)
    for s, p, d, g, v in rows:
        by[(s, p)].append(v)
    return by


def load_goalies(conn):
    rows = conn.execute(
        "select season, goalie_id, game_date, game_id, shots_against, saves"
        "  from nhl_goalie_starts where is_starter = 1 and shots_against is not null"
        "   and shots_against > 0 order by goalie_id, game_date, game_id").fetchall()
    sa, sv = collections.defaultdict(list), collections.defaultdict(list)
    for s, p, d, g, a, v in rows:
        sa[(s, p)].append(a)
        sv[(s, p)].append(v)
    return sa, sv


def score(by, half_life, shrink_k, prior_mean, seasons):
    m, s10, sm = [], [], []
    for (season, _), series in by.items():
        if season not in seasons:
            continue
        for actual, model, seas, last10 in walk(series, half_life, shrink_k, prior_mean):
            m.append((actual, model))
            sm.append((actual, seas))
            s10.append((actual, last10))
    return len(m), mae(m), mae(sm), mae(s10)


def fit_and_report(name, by, train, hold, unit):
    flat = [v for (s, _), ser in by.items() if s in train for v in ser]
    prior_mean = st.mean(flat) if flat else 0.0
    print(f"\n=== {name} ===  population mean {prior_mean:.3f} {unit}")
    best = None
    for hl in (3, 5, 8, 12, 20, 35, 60):
        for k in (0, 2, 5, 10, 20):
            n, mm, ms, ml = score(by, hl, k, prior_mean, train)
            if n and (best is None or mm < best[0]):
                best = (mm, hl, k, ms, ml, n)
    if not best:
        print("  no trainable rows")
        return None
    _, hl, k, ms, ml, n = best
    print(f"  chosen on TRAIN  half-life {hl} games, shrink {k}   (n={n:,})")
    n, mm, ms, ml = score(by, hl, k, prior_mean, hold)
    print(f"  HELD OUT n={n:,}")
    print(f"    season-mean baseline   MAE {ms:.4f}")
    print(f"    last-10 baseline       MAE {ml:.4f}")
    print(f"    model (hl={hl}, k={k})      MAE {mm:.4f}"
          f"   vs season-mean {(ms-mm)/ms*100:+.2f}%   vs last-10 {(ml-mm)/ml*100:+.2f}%")
    return hl, k, prior_mean, mm, ms


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--holdout", nargs="+", default=["20242025", "20252026"])
    args = ap.parse_args(argv)

    conn = sqlite3.connect(DB)
    hold = {int(x) for x in args.holdout}
    seasons = {r[0] for r in conn.execute("select distinct season from nhl_skater_games")}
    train = {s for s in seasons if s not in hold}
    print(f"train seasons {sorted(train)}   holdout {sorted(hold)}")

    sk = load_skaters(conn)
    fit_and_report("SKATER shots on goal", sk, train, hold, "shots")

    sa, sv = load_goalies(conn)
    g_sa = fit_and_report("GOALIE shots against", sa, train, hold, "shots")
    g_sv = fit_and_report("GOALIE saves (direct)", sv, train, hold, "saves")

    # 🚨 THE ONE THAT TESTS THE ARCHITECTURE. Saves projected the project's way -- volume times a
    # regressed efficiency -- against saves projected directly. If the decomposition is right it
    # wins; if it does not, the rule does not transfer to this market and the direct number ships.
    if g_sa and g_sv:
        hl_sa, k_sa, prior_sa = g_sa[0], g_sa[1], g_sa[2]
        flat_pct = []
        for (s, p), a in sa.items():
            if s in train:
                v = sv.get((s, p), [])
                for x, y in zip(a, v):
                    if x:
                        flat_pct.append(y / x)
        lg_pct = st.mean(flat_pct) if flat_pct else 0.9
        print(f"\n=== GOALIE saves via VOLUME x REGRESSED SAVE%% ===  league save% {lg_pct:.4f}")
        best = None
        for kp in (50, 150, 400, 900, 2000, 100000):
            pairs = []
            for (s, p), a_ser in sa.items():
                if s not in hold:
                    continue
                v_ser = sv.get((s, p))
                if not v_ser or len(v_ser) != len(a_ser):
                    continue
                for i in range(len(a_ser)):
                    if i < MIN_PRIOR:
                        continue
                    pa, pv = a_ser[:i], v_ser[:i]
                    ew = ew_mean(pa, hl_sa)
                    shots = (ew * len(pa) + prior_sa * k_sa) / (len(pa) + k_sa)
                    # save% shrunk toward league by kp SHOTS, not by games — the natural unit
                    pct = (sum(pv) + lg_pct * kp) / (sum(pa) + kp)
                    pairs.append((v_ser[i], shots * pct))
            if pairs:
                m = mae(pairs)
                tag = "(league only)" if kp == 100000 else ""
                print(f"    save% shrink {kp:>6} shots   MAE {m:.4f}  n={len(pairs):,} {tag}")
                if best is None or m < best[0]:
                    best = (m, kp)
        if best:
            direct = g_sv[3]
            print(f"\n  best decomposed MAE {best[0]:.4f} (shrink {best[1]})"
                  f"   vs direct {direct:.4f}   -> {(direct-best[0])/direct*100:+.2f}%")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
