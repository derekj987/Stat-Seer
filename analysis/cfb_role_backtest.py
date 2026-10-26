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
# (mode, role K, QB K, transfer rule). The role/QB weights were settled earlier and are held at
# the shipped setting here so the only thing moving is the transfer rule -- see EMPIRICAL_REFERENCE
# §13c. "off" is what ships today and is the control.
VARIANTS = [("blend2", 3, 3, "off"), ("blend2", 3, 3, "team"),
            ("blend2", 3, 3, "vol"), ("blend2", 3, 3, "both")]
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


# (CFB_USAGE_MIN_GAMES, CFB_USAGE_SHRINK_K). (1, 0) is what shipped: a bare per-game mean behind
# a one-game gate. The rest raise the gate and/or shrink the mean toward the volume the player's
# CHART rank implies, so one big game moves him a little and six move him a lot.
# (CFB_USAGE_MIN_GAMES, CFB_USAGE_SHRINK_K, CFB_USAGE_DECAY). decay 1.0 is the flat season mean
# that shipped; lower is a shorter memory. 0.86 is what the PROJECTION already uses for carries,
# and the Indiana case shows even that is too slow to see a two-game handover — but the sweep,
# not that one case, decides.
USAGE_VARIANTS = [(1, 0, 1.0), (2, 0, 1.0), (2, 2, 1.0),
                  (2, 2, 0.86), (2, 2, 0.70), (2, 2, 0.55), (2, 0, 0.55), (2, 2, 0.40)]


def run(week, mode, k, qk=3, tr="off", umin=None, ushrink=None, udecay=None):
    os.makedirs(SCRATCH, exist_ok=True)
    tag = "" if umin is None and ushrink is None else f"_u{umin}s{ushrink}d{udecay}"
    out = os.path.join(SCRATCH, f"w{week}_{mode}{k or ''}_q{qk}_t{tr}{tag}.ts")
    if not os.path.exists(out):
        env = dict(os.environ, CFB_ROLE_MODE=mode, CFB_ROLE_K=str(k or 6), CFB_QB_K=str(qk),
                   CFB_TRANSFER=tr)
        # The usage re-rank decides WHICH player holds each slot, and the slot is a projection
        # input — so a wrong ordering is a wrong workload, not just a wrong tag. Swept here
        # because the alternative is picking the setting whose ordering happens to match the
        # book, which would stop the rating being line-blind.
        if umin is not None:
            env["CFB_USAGE_MIN_GAMES"] = str(umin)
        if ushrink is not None:
            env["CFB_USAGE_SHRINK_K"] = str(ushrink)
        if udecay is not None:
            env["CFB_USAGE_DECAY"] = str(udecay)
        # errors="replace": a team name carrying a cp1252 byte (0x97 in "San José State") made the
        # reader thread raise UnicodeDecodeError. The child still ran, so the backtest looked fine —
        # but the exception happens in the pipe reader, which means a REAL projector failure could
        # have been swallowed the same way and scored as a variant. Never let the log encoding
        # decide whether a run is believed.
        r = subprocess.run([sys.executable, "cfb_player_proj.py", "--week", str(week), "--all-rows", "--out", out],
                           cwd=ROOT, env=env, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
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
    ap.add_argument("--usage", action="store_true",
                    help="sweep the usage re-rank (CFB_USAGE_MIN_GAMES / CFB_USAGE_SHRINK_K) "
                         "instead of the role-blend variants")
    args = ap.parse_args(argv)
    actual = actuals_from_cards()
    print(f"{len(actual)} graded (week, player, market) actuals from the report cards")
    for week in args.weeks:
        print(f"\n=== week {week}")
        print(f"  {'variant':10} {'cat':11} {'n':>4} {'MAE':>6} {'book':>6} {'bias':>6} {'proj>line':>9}")
        variants = ([(("blend2", 3, 3, "off"), u, sh, d) for u, sh, d in USAGE_VARIANTS]
                    if args.usage else [(v, None, None, None) for v in VARIANTS])
        for (mode, k, qk, tr), umin, ushrink, udecay in variants:
            rows = run(week, mode, k, qk, tr, umin, ushrink, udecay)
            sc = score(rows, actual, week)
            tot_n = sum(v["n"] for v in sc.values())
            tot_mae = sum(v["mae"] * v["n"] for v in sc.values()) / max(tot_n, 1)
            tot_bias = sum(v["bias"] * v["n"] for v in sc.values()) / max(tot_n, 1)
            label = f"u{umin}s{ushrink}d{udecay}" if args.usage else f"transfer={tr}"
            for cat in CATS:
                v = sc.get(cat)
                if v:
                    print(f"  {label:14} {cat:11} {v['n']:4} {v['mae']:6.1f} {v['book_mae']:6.1f} "
                          f"{v['bias']:+6.1f} {100 * v['over']:8.0f}%")
            print(f"  {label:14} {'ALL':11} {tot_n:4} {tot_mae:6.1f} {'':6} {tot_bias:+6.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
