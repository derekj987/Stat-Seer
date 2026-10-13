"""Does it persist? The gate every NHL prop projection has to pass first.

The project's oldest and most load-bearing finding is that VOLUME persists and EFFICIENCY does not
-- NFL carries 0.678 and target share 0.623 against yards-per-carry 0.058 and receiving TDs 0.093.
Everything downstream follows from it: never project yards directly, project volume and multiply by
a regressed efficiency baseline.

Nobody has measured the hockey version. This does, on the same estimator, before any projection is
written -- because if shots on goal turn out to behave like yards-per-carry rather than like
carries, the whole shots-prop idea is dead and should die here rather than after a model is built.

ESTIMATOR: split-half. Take each player's games in a season, split them ODD games vs EVEN games
(not first half vs second half, which confounds persistence with a team's schedule and with
in-season role change), take the per-game mean of each half, and correlate the two halves across
players. Then Spearman-Brown the correlation up to full length, which is what makes a split-half
number comparable to the NFL figures above.

🚨 MINIMUM GAMES MATTERS MORE THAN IT LOOKS. A player with four games has two games a side and a
mean that is mostly noise, which drags every correlation toward zero and would make even a real
signal look dead. MIN_GAMES is deliberately high and the sensitivity is printed, so the number can
be read rather than trusted.

    python analysis/nhl_persistence.py
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


def pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return float("nan")
    mx, my = st.mean(xs), st.mean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return float("nan")
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def spearman_brown(r, k=2.0):
    """Split-half r is the reliability of HALF the games; scale it to the full set."""
    if r != r or r <= -1:
        return float("nan")
    return (k * r) / (1 + (k - 1) * r)


def split_half(series_by_player, min_games):
    """series_by_player: {player: [(order_key, value), ...]} -> (n_players, r_half, r_full)"""
    a, b = [], []
    for _, rows in series_by_player.items():
        rows = sorted(rows)
        if len(rows) < min_games:
            continue
        odd = [v for i, (_, v) in enumerate(rows) if i % 2 == 0]
        even = [v for i, (_, v) in enumerate(rows) if i % 2 == 1]
        if not odd or not even:
            continue
        a.append(st.mean(odd))
        b.append(st.mean(even))
    r = pearson(a, b)
    return len(a), r, spearman_brown(r)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--min-games", type=int, default=20)
    args = ap.parse_args(argv)

    conn = sqlite3.connect(DB)

    # ---- skaters: volume vs efficiency, per player-season ----
    sk = conn.execute(
        "select season, player_id, game_date, game_id, toi_seconds, sog, goals, points, assists"
        "  from nhl_skater_games where toi_seconds > 0").fetchall()
    print(f"skater player-games: {len(sk):,}")
    metrics = {
        "shots on goal (VOLUME)":   lambda r: r[5],
        "time on ice (VOLUME)":     lambda r: r[4] / 60.0,
        "shots per 60 (VOLUME/ice)": lambda r: (r[5] or 0) * 3600.0 / r[4] if r[4] else None,
        "points (mixed)":           lambda r: r[7],
        "assists (mixed)":          lambda r: r[8],
        "goals (EFFICIENCY x vol)": lambda r: r[6],
        "shooting % (EFFICIENCY)":  lambda r: (r[6] / r[5]) if r[5] else None,
    }
    print(f"\n{'SKATERS':34} {'players':>8} {'split-half r':>13} {'full-season r':>14}")
    for label, fn in metrics.items():
        by = collections.defaultdict(list)
        for r in sk:
            v = fn(r)
            if v is None:
                continue
            by[(r[0], r[1])].append((r[2], r[3], v))
        by = {k: [(x[:2], x[2]) for x in v] for k, v in by.items()}
        n, rh, rf = split_half(by, args.min_games)
        print(f"  {label:32} {n:8} {rh:13.3f} {rf:14.3f}")

    # ---- goalies: the saves market, decomposed ----
    gl = conn.execute(
        "select season, goalie_id, game_date, game_id, shots_against, saves, goals_against"
        "  from nhl_goalie_starts where is_starter = 1 and shots_against is not null"
        "   and shots_against > 0").fetchall()
    print(f"\ngoalie starts: {len(gl):,}")
    gmetrics = {
        "shots against (VOLUME)":  lambda r: r[4],
        "saves (what the prop is)": lambda r: r[5],
        "save % (EFFICIENCY)":     lambda r: r[5] / r[4],
        "goals against (mixed)":   lambda r: r[6],
    }
    print(f"\n{'GOALIES (starts only)':34} {'players':>8} {'split-half r':>13} {'full-season r':>14}")
    for label, fn in gmetrics.items():
        by = collections.defaultdict(list)
        for r in gl:
            v = fn(r)
            if v is None:
                continue
            by[(r[0], r[1])].append(((r[2], r[3]), v))
        n, rh, rf = split_half(by, args.min_games)
        print(f"  {label:32} {n:8} {rh:13.3f} {rf:14.3f}")

    # ---- sensitivity: does the minimum-games threshold drive the answer? ----
    print(f"\nsensitivity of 'shots on goal' to --min-games (full-season r):")
    by = collections.defaultdict(list)
    for r in sk:
        if r[5] is not None:
            by[(r[0], r[1])].append(((r[2], r[3]), r[5]))
    for mg in (10, 20, 30, 40, 60):
        n, rh, rf = split_half(by, mg)
        print(f"  min {mg:3} games: {n:5} players   r = {rf:.3f}")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
