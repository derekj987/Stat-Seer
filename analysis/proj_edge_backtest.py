"""
proj_edge_backtest.py -- does OUR line-blind projection beat the closing prop line, out of
sample? This is the layer prop_backtest.py flagged as "next" (needs per-week projections).

prop_backtest.py characterized the MARKET (is the line efficient? is shopping worth it?).
This grades US: for every historical player-prop we have three things --
  * OUR projection  (props_projection walk-forward -- strictly prior data, no leakage),
  * the CONSENSUS closing line  (backfilled prop_snapshots, capture_reason=BACKFILL), and
  * the ACTUAL result  (nflverse weekly stats).
Our lean = OVER if proj > line else UNDER. We WIN if the actual lands on our side. The only
bar that matters (the project's standing discipline): does our lean hit above the vig
break-even (~52.4%) OUT OF SAMPLE -- and do bigger disagreements win more (a real signal)?

    python analysis/proj_edge_backtest.py --season 2024
    python analysis/proj_edge_backtest.py --season 2024 --weeks 1-8 --proj ew

Markets graded: rushing yards, receiving yards, receptions (the props_projection outputs;
the model's claimed strength is rush yds). Reuses prop_backtest (Supabase reader / name
norm / actuals) + props_projection (the model). Stdlib + odds_client + the projection deps.
"""
import argparse
import csv
import os
import sys
from collections import defaultdict, Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # repo root (odds_client)
sys.path.insert(0, HERE)                    # analysis/ (sibling scripts)

import prop_backtest as pb          # noqa: E402  -- norm, read_props, load_actuals
import props_projection as pp       # noqa: E402  -- build_projections (walk-forward)
import odds_client as oc            # noqa: E402

VIG = 0.524   # break-even hit rate at standard -110 juice

# odds market -> (our projection tag, nflverse actual column, pretty label)
MK = {
    "player_rush_yds":      ("rush",  "rushing_yards",   "Rushing yds"),
    "player_reception_yds": ("recyd", "receiving_yards", "Receiving yds"),
    "player_receptions":    ("recpt", "receptions",      "Receptions"),
}


def our_projections(season, variant):
    """(week, norm_name, tag) -> our projected number, walk-forward, for `season`."""
    df = pp.build_projections()
    df = df[df.season == season]
    id2name = {}
    with open(f"data/stats_{season}.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            pid = r.get("player_id")
            nm = r.get("player_display_name") or r.get("player_name")
            if pid and nm:
                id2name[pid] = pb.norm(nm)
    pref = "me_" if variant == "ew" else "m_"
    cols = {"rush": pref + "rush", "recyd": pref + "recyd", "recpt": pref + "recpt"}
    out = {}
    for _, row in df.iterrows():
        nm = id2name.get(row["player_id"])
        if not nm:
            continue
        wk = int(row["week"])
        for tag, col in cols.items():
            v = row.get(col)
            if v is not None and v == v:  # not NaN
                out[(wk, nm, tag)] = float(v)
    return out


def consensus_lines(env, season, weeks):
    """(week, norm_name, market) -> the modal closing line across books."""
    rows = pb.read_props(env, season, weeks)
    if not rows:
        return None
    close_at = {}
    for r in rows:
        e, s = r["event_id"], r["snapshot_at"]
        if s <= r["commence_time"] and (e not in close_at or s > close_at[e]):
            close_at[e] = s
    lines = defaultdict(Counter)
    for r in rows:
        if r["snapshot_at"] != close_at.get(r["event_id"]):
            continue
        if r["line"] is None:
            continue
        side = (r["side"] or "").lower()
        if side not in ("over", "under"):
            continue
        k = (int(r["week"]), pb.norm(r["player_name"]), r["market"])
        lines[k][float(r["line"])] += 1
    return {k: c.most_common(1)[0][0] for k, c in lines.items()}


def pct(n, d):
    return f"{100*n/d:.1f}%" if d else "  -  "


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--weeks", default=None, help="e.g. 1-8 or 1,2,3 (default: all)")
    ap.add_argument("--proj", choices=["sd", "ew"], default="sd",
                    help="volume basis: sd=season-to-date (default), ew=recency-weighted")
    args = ap.parse_args(argv)

    oc.ensure_ssl_certs()
    env = oc.load_env()
    weeks = None
    if args.weeks:
        weeks = set()
        for part in args.weeks.split(","):
            if "-" in part:
                a, b = part.split("-"); weeks |= set(range(int(a), int(b) + 1))
            elif part.strip():
                weeks.add(int(part))
        weeks = sorted(weeks)

    if not os.path.exists(f"data/stats_{args.season}.csv"):
        print(f"ERROR: data/stats_{args.season}.csv not found.", file=sys.stderr)
        return 1

    print(f"Building walk-forward projections ({args.proj})...", file=sys.stderr)
    proj = our_projections(args.season, args.proj)
    print(f"Reading backfilled closing lines...", file=sys.stderr)
    lines = consensus_lines(env, args.season, weeks)
    if not lines:
        print("No BACKFILL prop rows -- is the backfill written for this season/weeks?")
        return 0
    actuals = pb.load_actuals(args.season)

    # grade: does our lean beat the line?
    res = defaultdict(lambda: {"n": 0, "win": 0, "push": 0})           # market -> tallies
    buckets = defaultdict(lambda: {"n": 0, "win": 0})                  # edge-bucket -> tallies
    overall = {"n": 0, "win": 0, "push": 0}
    have_proj = have_act = 0

    def bucket(edge):
        return "0-2" if edge < 2 else "2-5" if edge < 5 else "5-10" if edge < 10 else "10+"

    for (wk, nm, market), line in lines.items():
        if market not in MK:
            continue
        tag, acol, _ = MK[market]
        p = proj.get((wk, nm, tag))
        if p is None:
            continue
        have_proj += 1
        act = actuals.get((wk, nm))
        if act is None:
            continue
        have_act += 1
        actual = act[acol]
        if actual == line:
            res[market]["push"] += 1; overall["push"] += 1; continue
        our_over = p > line
        won = our_over == (actual > line)
        res[market]["n"] += 1; res[market]["win"] += int(won)
        overall["n"] += 1; overall["win"] += int(won)
        b = bucket(abs(p - line))
        buckets[b]["n"] += 1; buckets[b]["win"] += int(won)

    print(f"\n=== Does OUR projection beat the closing line? {args.season}"
          + (f" wk {args.weeks}" if args.weeks else "") + f"  (proj={args.proj}) ===")
    print(f"matched proj+line: {have_proj}   with an actual result: {have_act}\n")
    print(f"{'market':<16}{'graded':>8}{'our win%':>10}{'vs vig':>9}")
    for market, (tag, acol, label) in MK.items():
        t = res[market]
        edge = (100 * t['win'] / t['n'] - 100 * VIG) if t['n'] else 0
        print(f"{label:<16}{t['n']:>8}{pct(t['win'], t['n']):>10}{edge:>+8.1f}")
    o = overall
    print(f"{'-'*43}")
    edge = (100 * o['win'] / o['n'] - 100 * VIG) if o['n'] else 0
    print(f"{'ALL':<16}{o['n']:>8}{pct(o['win'], o['n']):>10}{edge:>+8.1f}"
          f"   (pushes: {o['push']})")
    print(f"\nbreak-even to beat the vig is {100*VIG:.1f}%. 'vs vig' is points above/below it.")

    print(f"\n=== By conviction (|proj - line|) -- a real edge should win MORE when we disagree more ===")
    print(f"{'edge (yds)':<12}{'graded':>8}{'our win%':>10}")
    for b in ["0-2", "2-5", "5-10", "10+"]:
        t = buckets[b]
        print(f"{b:<12}{t['n']:>8}{pct(t['win'], t['n']):>10}")
    print("\nNote: line-blind projections graded vs the CONSENSUS closing line, walk-forward,")
    print("no leakage. A win rate at/under ~52.4% means the line already prices what we know.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
