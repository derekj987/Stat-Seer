"""
cfb_role_backtest.py -- score the NCAAF projection's role-volume rule on PLAYED weeks.

The projector's volume was max(role baseline, own recent) -- a one-way lift -- and the report card
measured the result: projections 5-12 yards HIGH per category on week 2 (rushing bias +11.6,
proj > line on 66% of rows against 44% that went over). This runs cfb_player_proj in --week
backtest mode (current-season logs cut off before the slate, all rows kept) under each
CFB_ROLE_MODE / CFB_ROLE_K, then scores every priced row against what the player actually did
(actuals from lib/reportCards.ts, which weekly_report.py graded from CFBD).

    python analysis/cfb_role_backtest.py --weeks 1 2

Choose on the EARLIER week, confirm on the later one -- never pick the setting that happens to win
the week you are looking at.
"""
import argparse
import json
import os
import re
import statistics
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import weekly_report as wr  # noqa: E402

SCRATCH = os.path.join(ROOT, "data", "cfb_role_bt")
# (mode, role K, QB K) -- QB attempts get their own weight; see cfb_player_proj.QB_BLEND_K.
VARIANTS = [("max", None, 3), ("blend2", 3, 3), ("blend2", 3, 1), ("blend2", 3, 0.5),
            ("blend2", 2, 1), ("blend2", 4, 1)]
CATS = ("passing", "rushing", "receiving", "receptions")


def actuals_from_cards():
    s = open(os.path.join(ROOT, "web", "lib", "reportCards.ts"), encoding="utf-8").read()
    cards = json.loads(re.search(r"REPORT_CARDS: ReportCard\[\] = (\[.*\]);", s, re.S).group(1))
    out = {}
    for c in cards:
        if c["sport"] != "ncaaf":
            continue
        for p in c["props"]:
            if p["actual"] is not None and p["market"] != "anytime_td":
                out[(c["week"], wr.norm(p["player"]), p["market"])] = (p["actual"], p["line"])
    return out


def run(week, mode, k, qk=3):
    os.makedirs(SCRATCH, exist_ok=True)
    out = os.path.join(SCRATCH, f"w{week}_{mode}{k or ''}_q{qk}.ts")
    if not os.path.exists(out):
        env = dict(os.environ, CFB_ROLE_MODE=mode, CFB_ROLE_K=str(k or 6), CFB_QB_K=str(qk))
        r = subprocess.run([sys.executable, "cfb_player_proj.py", "--week", str(week), "--all-rows", "--out", out],
                           cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            print(r.stdout[-800:], r.stderr[-800:])
            raise SystemExit(f"projector failed for week {week} {mode} {k}")
    return wr.json_lines(open(out, encoding="utf-8").read())


def score(rows, actual, week):
    by = {}
    for r in rows:
        if r.get("proj") is None or r["cat"] not in CATS:
            continue
        a = actual.get((week, wr.norm(r["player"]), r["market"]))
        if a is None:
            continue
        real, line = a
        by.setdefault(r["cat"], []).append((r["proj"], real, line))
    out = {}
    for cat, xs in by.items():
        out[cat] = {"n": len(xs),
                    "mae": statistics.mean(abs(p - a) for p, a, _ in xs),
                    "bias": statistics.mean(p - a for p, a, _ in xs),
                    "book_mae": statistics.mean(abs(l - a) for _, a, l in xs),
                    "over": statistics.mean(1.0 if p > l else 0.0 for p, _, l in xs)}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weeks", type=int, nargs="+", default=[1, 2])
    args = ap.parse_args(argv)
    actual = actuals_from_cards()
    print(f"{len(actual)} graded (week, player, market) actuals from the report cards")
    for week in args.weeks:
        print(f"\n=== week {week}")
        print(f"  {'variant':10} {'cat':11} {'n':>4} {'MAE':>6} {'book':>6} {'bias':>6} {'proj>line':>9}")
        for mode, k, qk in VARIANTS:
            rows = run(week, mode, k, qk)
            sc = score(rows, actual, week)
            tot_n = sum(v["n"] for v in sc.values())
            tot_mae = sum(v["mae"] * v["n"] for v in sc.values()) / max(tot_n, 1)
            tot_bias = sum(v["bias"] * v["n"] for v in sc.values()) / max(tot_n, 1)
            label = f"{mode}{k or ''}/q{qk}"
            for cat in CATS:
                v = sc.get(cat)
                if v:
                    print(f"  {label:10} {cat:11} {v['n']:4} {v['mae']:6.1f} {v['book_mae']:6.1f} "
                          f"{v['bias']:+6.1f} {100 * v['over']:8.0f}%")
            print(f"  {label:10} {'ALL':11} {tot_n:4} {tot_mae:6.1f} {'':6} {tot_bias:+6.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
