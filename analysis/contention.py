"""
contention.py -- each team's playoff picture, for the Coach/Situation Context in Special
Considerations. The betting-relevant states: CLINCHED (may rest starters late), ELIMINATED
(playing out the string), IN THE HUNT / MUST-WIN (full effort). Late-season resting of
starters genuinely moves totals + player props -- as CONTEXT, not an edge.

Computed from games.csv results through the latest completed week. Seeding is division-
aware (4 division leaders + 3 wildcards = the 7 seeds). Clinch/elimination use a
conservative win-based bound (no exact NFL tiebreakers) -- so it's framed as the "playoff
picture", never an official declaration. Hidden before Week 10 and in the preseason.

    python analysis/contention.py                # current season, latest completed week
    python analysis/contention.py --season 2024  # validate against a finished season

Writes web/lib/contention.ts (keyed by team).
"""
import argparse
import csv
from pathlib import Path
from collections import defaultdict

HERE = Path(__file__).resolve().parent
D = HERE.parent / "data"
OUT = HERE.parent / "web" / "lib" / "contention.ts"
GAMES_PER_TEAM = 17
MEANINGFUL_WEEK = 10   # before this, don't surface a contention flag

DIVISIONS = {
    "BUF": ("AFC", "East"), "MIA": ("AFC", "East"), "NE": ("AFC", "East"), "NYJ": ("AFC", "East"),
    "BAL": ("AFC", "North"), "CIN": ("AFC", "North"), "CLE": ("AFC", "North"), "PIT": ("AFC", "North"),
    "HOU": ("AFC", "South"), "IND": ("AFC", "South"), "JAX": ("AFC", "South"), "TEN": ("AFC", "South"),
    "DEN": ("AFC", "West"), "KC": ("AFC", "West"), "LAC": ("AFC", "West"), "LV": ("AFC", "West"),
    "DAL": ("NFC", "East"), "NYG": ("NFC", "East"), "PHI": ("NFC", "East"), "WAS": ("NFC", "East"),
    "CHI": ("NFC", "North"), "DET": ("NFC", "North"), "GB": ("NFC", "North"), "MIN": ("NFC", "North"),
    "ATL": ("NFC", "South"), "CAR": ("NFC", "South"), "NO": ("NFC", "South"), "TB": ("NFC", "South"),
    "ARI": ("NFC", "West"), "LA": ("NFC", "West"), "SF": ("NFC", "West"), "SEA": ("NFC", "West"),
}


def load(season):
    rows = []
    with open(D / "games.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get("season") != str(season):
                continue
            if r.get("game_type", "REG") not in ("REG", ""):
                continue
            gt = r.get("game_type", "")
            if gt and gt != "REG":
                continue
            hs, as_ = r.get("home_score"), r.get("away_score")
            if not hs or not as_ or hs == "NA" or as_ == "NA":
                continue
            try:
                rows.append((int(r["week"]), r["home_team"], r["away_team"], int(hs), int(as_)))
            except (ValueError, KeyError):
                continue
    return rows


def records(rows):
    rec = defaultdict(lambda: {"w": 0, "l": 0, "t": 0})
    for _wk, home, away, hs, as_ in rows:
        if home not in DIVISIONS or away not in DIVISIONS:
            continue
        if hs > as_:
            rec[home]["w"] += 1; rec[away]["l"] += 1
        elif as_ > hs:
            rec[away]["w"] += 1; rec[home]["l"] += 1
        else:
            rec[home]["t"] += 1; rec[away]["t"] += 1
    return rec


def winpct(r):
    g = r["w"] + r["l"] + r["t"]
    return (r["w"] + 0.5 * r["t"]) / g if g else 0.0


def seeds_for(conf, rec):
    teams = [t for t in DIVISIONS if DIVISIONS[t][0] == conf]
    by_div = defaultdict(list)
    for t in teams:
        by_div[DIVISIONS[t][1]].append(t)
    leaders = []
    for div, ts in by_div.items():
        leaders.append(max(ts, key=lambda t: (winpct(rec[t]), rec[t]["w"])))
    leaders.sort(key=lambda t: (winpct(rec[t]), rec[t]["w"]), reverse=True)
    others = [t for t in teams if t not in leaders]
    others.sort(key=lambda t: (winpct(rec[t]), rec[t]["w"]), reverse=True)
    order = leaders + others            # seeds 1..4 leaders, then wildcards
    return {t: i + 1 for i, t in enumerate(order)}, leaders


def classify(season, rows, through):
    rec = records(rows)
    out = {}
    for conf in ("AFC", "NFC"):
        seed, leaders = seeds_for(conf, rec)
        teams = [t for t in DIVISIONS if DIVISIONS[t][0] == conf]
        gp = {t: rec[t]["w"] + rec[t]["l"] + rec[t]["t"] for t in teams}
        rem = {t: max(0, GAMES_PER_TEAM - gp[t]) for t in teams}
        wins = {t: rec[t]["w"] for t in teams}
        maxw = {t: wins[t] + rem[t] for t in teams}
        in7 = [t for t in teams if seed[t] <= 7]
        out8 = [t for t in teams if seed[t] > 7]
        best_out_max = max((maxw[t] for t in out8), default=0)
        seed7_wins = min((wins[t] for t in in7), default=0)

        for t in teams:
            r = rec[t]
            record = f"{r['w']}-{r['l']}" + (f"-{r['t']}" if r["t"] else "")
            s = seed[t]
            if s <= 7:
                # clinched a spot if no out-team can reach your current win total
                if through >= MEANINGFUL_WEEK and wins[t] > best_out_max:
                    status, note = "Clinched", "playoff spot secured — may rest starters late"
                else:
                    status, note = ("In a playoff spot", f"currently the #{s} seed")
            else:
                need = seed7_wins - wins[t]
                if through >= MEANINGFUL_WEEK and need > rem[t]:
                    status, note = "Eliminated", "out of the playoff race"
                elif need <= 1:
                    status, note = "On the bubble", "in the wild-card chase"
                else:
                    status, note = "Long shot", f"{need} back of the #7 seed"
            out[t] = {"team": t, "record": record, "seed": s, "conf": conf,
                      "status": status, "note": note}
    return out


def latest_week(rows):
    return max((wk for wk, *_ in rows), default=0)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, default=2026)  # the app's current board season
    ap.add_argument("--week", type=int, default=None, help="through this week (default: latest completed)")
    args = ap.parse_args(argv)

    rows = load(args.season)
    if args.week:
        rows = [r for r in rows if r[0] <= args.week]
    through = args.week or latest_week(rows)

    if through < MEANINGFUL_WEEK:
        print(f"Season {args.season}: {len(rows)} games through week {through} "
              f"(< week {MEANINGFUL_WEEK}) — contention not meaningful yet; writing empty flag.")
        data = {}
    else:
        data = classify(args.season, rows, through)
        # console validation
        order = sorted(data.values(), key=lambda d: (d["conf"], d["seed"]))
        print(f"Season {args.season} through week {through}:\n")
        print(f"{'tm':<4}{'conf':<5}{'seed':>5}{'rec':>7}  {'status':<18}{'note'}")
        for d in order:
            print(f"{d['team']:<4}{d['conf']:<5}{d['seed']:>5}{d['record']:>7}  {d['status']:<18}{d['note']}")

    import json
    body = ",\n  ".join(f'"{t}": {json.dumps(d)}' for t, d in sorted(data.items()))
    ts = (
        "// AUTO-GENERATED by analysis/contention.py — do not edit by hand.\n"
        "// Each team's playoff picture (CONTEXT, not an edge) through the latest completed\n"
        "// week. Empty before Week 10 / in the preseason — the flag stays hidden until then.\n"
        "export interface Contention {\n"
        "  team: string; record: string; seed: number; conf: string;\n"
        "  status: string;   // Clinched | In a playoff spot | On the bubble | Long shot | Eliminated\n"
        "  note: string;\n"
        "}\n"
        f"export const CONTENTION_SEASON = {args.season};\n"
        f"export const CONTENTION_THROUGH_WEEK = {through};\n"
        "export const CONTENTION: Record<string, Contention> = {\n  "
        + body + (",\n" if body else "") + "};\n"
    )
    OUT.write_text(ts, encoding="utf-8")
    print(f"\nwrote {OUT}  ({len(data)} teams)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
