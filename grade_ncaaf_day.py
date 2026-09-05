"""
grade_ncaaf_day.py -- report card for one day of NCAAF, graded against what we PUBLISHED.

Reads the committed board (web/app/ncaaf/model-data.ts) and player projections
(web/lib/ncaafPlayerProjections.ts), pulls final scores + player stats from CFBD, and prints a
win/loss record by BET TYPE rather than an error metric:

    spreads   laying the points vs taking the points, W-L-Push
    totals    overs vs unders, both the flagged leans and the direction implied by our number
    moneyline our projected winner, W-L
    props     over/under leans W-L, plus our projection error against the book's line error

    python grade_ncaaf_day.py --date 2026-09-05
    python grade_ncaaf_day.py                      # yesterday, ET

Why a script and not a one-off: a single day is far too small to conclude anything (a 6-of-8 dog
slate comes up ~11% of the time by chance), so the point is to accumulate the same measurement
across many days until the sample is real. Grading by hand each time invites a different method
each time, which is worse than no record.

Auth: CFBD_API_KEY in .env. Stdlib + cfbd_client/odds_client.
"""
import argparse
import json
import os
import re
import statistics
import sys
import unicodedata
from datetime import datetime, timedelta, timezone

import cfbd_client as cc
import odds_client as oc

ET = timezone(timedelta(hours=-4))          # college season runs in EDT
ROOT = os.path.dirname(os.path.abspath(__file__))
CARD = os.path.join(ROOT, "web", "app", "ncaaf", "model-data.ts")
PROJ = os.path.join(ROOT, "web", "lib", "ncaafPlayerProjections.ts")

# our market key -> CFBD "category|type"
STAT = {"pass_yds": "passing|YDS", "pass_tds": "passing|TD", "rush_yds": "rushing|YDS",
        "rec_yds": "receiving|YDS", "receptions": "receiving|REC"}
LEAN_PRIOR_GAMES, LEAN_MARGIN, MIN_PROJ_GAMES = 6, 0.04, 5


def etday(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ET).strftime("%Y-%m-%d")


def norm(s):
    return re.sub(r"[^a-z]", "", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower())


def load_card():
    """The published board. model-data.ts is pretty-printed JSON assigned to one const, so parse the
    whole object -- do NOT walk braces looking for sub-objects, which is easy to get into a loop."""
    s = open(CARD, encoding="utf-8").read()
    m = re.search(r"export const NCAAF_MODEL[^=]*=\s*", s)
    return json.loads(s[s.index("{", m.end() - 1): s.rindex("}") + 1])["card"]


def load_proj():
    """The projections file emits one JSON object per line."""
    s = open(PROJ, encoding="utf-8").read()
    out = []
    for m in re.findall(r"^\s*(\{.*\}),?\s*$", s, re.M):
        try:
            out.append(json.loads(m))
        except ValueError:
            pass
    return out


def home_line(d, home):
    """A {fav,num} spread as the HOME number: negative = home favoured."""
    return -abs(d["num"]) if d["fav"] == home else abs(d["num"])


def finals(day, key):
    """Final scores for `day` (ET), keyed (away, home)."""
    out = {}
    for wk in range(1, 20):
        st, games = cc.cfbd_get("/games", {"year": int(day[:4]), "week": wk, "seasonType": "regular"}, key)
        if st != 200 or not isinstance(games, list):
            continue
        hit = False
        for g in games:
            if not g.get("startDate") or etday(g["startDate"]) != day:
                continue
            hit = True
            if g.get("homePoints") is not None:
                out[(g["awayTeam"], g["homeTeam"])] = (g["awayPoints"], g["homePoints"])
        if hit:
            break          # the day sits in exactly one week
    return out


def lean_centres(rows):
    cen = {}
    for cat in {r["cat"] for r in rows}:
        vs = sorted(r["cOver"] / r["cG"] for r in rows
                    if r.get("book") is not None and r["cat"] != "td" and r.get("cG") and r["cat"] == cat)
        if vs:
            cen[cat] = statistics.median(vs)
    return cen


def prop_lean(r, cen):
    """Mirrors lib/projLean.ts so the record grades what the BOARD actually showed."""
    if r.get("book") is None:
        return None
    if r["cat"] == "td":
        return "over" if r["proj"] >= r["book"] else "under"
    if not r.get("cG") or (r.get("g") or 0) < MIN_PROJ_GAMES:
        return None
    c = cen.get(r["cat"], 0.5)
    p = (r["cOver"] + LEAN_PRIOR_GAMES * c) / (r["cG"] + LEAN_PRIOR_GAMES)
    return "over" if p >= c + LEAN_MARGIN else ("under" if p <= c - LEAN_MARGIN else None)


def wl(won, push=False):
    return "PUSH" if push else ("WIN " if won else "loss")


def grade_games(rows):
    lay = [0, 0, 0]
    dog = [0, 0, 0]
    ov = [0, 0, 0]
    un = [0, 0, 0]
    fl = [0, 0, 0]
    su = [0, 0]
    print("=" * 100)
    print("SPREAD -- the side we published, graded against the market number")
    print("=" * 100)
    print("  %-34s %-22s %-9s %-8s %s" % ("game", "our pick", "result", "margin", "W/L"))
    for (a, h), c, (ap, hp) in rows:
        pick, ms = c.get("pick"), c.get("marketSpread")
        if not pick or not ms:
            continue
        marg = (hp - ap) if pick["side"] == h else (ap - hp)
        res = marg + pick["num"]
        r = wl(res > 0, abs(res) < 1e-9)
        (dog if pick["num"] > 0 else lay)[0 if r == "WIN " else (2 if r == "PUSH" else 1)] += 1
        print("  %-34s %-22s %-9s %-8s %s" % ("%s @ %s" % (a[:14], h[:14]),
              "%s %+.1f" % (pick["side"][:14], pick["num"]), "%d-%d" % (ap, hp), "%+d" % marg, r))
    tot = [x + y for x, y in zip(lay, dog)]
    print("\n  TAKING the points (dog) : %d-%d-%d" % tuple(dog))
    print("  LAYING the points (fav) : %d-%d-%d" % tuple(lay))
    print("  SPREAD TOTAL            : %d-%d-%d   (%.0f%%)" % (
        *tot, 100 * tot[0] / max(1, tot[0] + tot[1])))

    print("\n" + "=" * 100)
    print("TOTALS -- over/under")
    print("=" * 100)
    print("  %-34s %-18s %-9s %-8s %s" % ("game", "our call", "mkt", "actual", "W/L"))
    for (a, h), c, (ap, hp) in rows:
        mt, pt = c.get("marketTotal"), c.get("projTotal")
        if mt is None or pt is None:
            continue
        at = ap + hp
        d = "OVER" if pt > mt else "UNDER"
        r = wl((at > mt) if d == "OVER" else (at < mt), at == mt)
        i = 0 if r == "WIN " else (2 if r == "PUSH" else 1)
        (ov if d == "OVER" else un)[i] += 1
        if c.get("totalLean"):
            fl[i] += 1
        print("  %-34s %-18s %-9s %-8s %s" % ("%s @ %s" % (a[:14], h[:14]),
              d + (" *flagged*" if c.get("totalLean") else ""), mt, at, r))
    t = [x + y for x, y in zip(ov, un)]
    print("\n  OVERS  %d-%d-%d      UNDERS %d-%d-%d      TOTAL %d-%d-%d   (%.0f%%)" % (
        *ov, *un, *t, 100 * t[0] / max(1, t[0] + t[1])))
    print("  flagged leans only (>=2 pts off the market): %d-%d-%d" % tuple(fl))

    for (a, h), c, (ap, hp) in rows:
        ours = home_line(c["projSpread"], h)
        act = hp - ap
        su[0 if ((ours < 0 and act > 0) or (ours > 0 and act < 0)) else 1] += 1
    print("\n" + "=" * 100)
    print("MONEYLINE -- our projected winner: %d-%d" % tuple(su))
    print("=" * 100)


def grade_props(day, proj, key):
    rows = [r for r in proj if r.get("commence") and etday(r["commence"]) == day and r.get("book") is not None]
    if not rows:
        print("\nNo priced player-prop rows for %s.\n" % day)
        return
    cen = lean_centres(proj)
    teams = set()
    for r in rows:
        a, h = r["game"].split(" @ ")
        teams |= {a, h}
    act = {}
    for t in sorted(teams):
        st, data = cc.cfbd_get("/games/players", {"year": int(day[:4]), "week": 1, "team": t}, key)
        if st != 200 or not isinstance(data, list):
            continue
        for g in data:
            for tm in g.get("teams", []):
                if tm.get("team") != t:
                    continue
                for cat in tm.get("categories", []):
                    for ty in cat.get("types", []):
                        for ath in ty.get("athletes", []):
                            act.setdefault(norm(ath.get("name")), {})[cat["name"] + "|" + ty["name"]] = ath.get("stat")

    def num(x):
        try:
            return float(str(x).replace(",", ""))
        except (TypeError, ValueError):
            return None

    ovr = [0, 0]
    und = [0, 0]
    td = [0, 0]
    perr, lerr, miss = [], [], 0
    detail = []
    for r in rows:
        a = act.get(norm(r["player"]))
        L = prop_lean(r, cen)
        if r["cat"] == "td":
            if a is None:
                miss += 1
                continue
            scored = (num(a.get("rushing|TD")) or 0) + (num(a.get("receiving|TD")) or 0) > 0
            if L:
                td[0 if ((L == "over") == scored) else 1] += 1
            continue
        sk = STAT.get(r["market"])
        if a is None or sk is None or num(a.get(sk)) is None:
            miss += 1
            continue
        real = num(a[sk])
        perr.append(abs(r["proj"] - real))
        lerr.append(abs(r["book"] - real))
        if L:
            hit = (real > r["book"]) if L == "over" else (real < r["book"])
            (ovr if L == "over" else und)[0 if hit else 1] += 1
            detail.append((r["player"], r["market"], r["book"], r["proj"], real, L, "WIN" if hit else "loss"))
    print("\n" + "=" * 100)
    print("PLAYER PROPS")
    print("=" * 100)
    print("  priced rows %d   graded %d   no stat found %d" % (len(rows), len(perr) + td[0] + td[1], miss))
    if perr:
        print("  our projection error %.1f   the BOOK's line error %.1f  (mean absolute)" % (
            statistics.mean(perr), statistics.mean(lerr)))
    print("  OVER leans  %d-%d      UNDER leans %d-%d      ANYTIME TD %d-%d" % (*ovr, *und, *td))
    t = [ovr[0] + und[0], ovr[1] + und[1]]
    if sum(t):
        print("  yardage/receptions leans TOTAL %d-%d  (%.0f%%)" % (*t, 100 * t[0] / sum(t)))
    if detail:
        print("\n  every graded lean:")
        for d in sorted(detail, key=lambda x: x[6]):
            print("   %-24s %-11s line %-6s proj %-7s actual %-7s %-5s %s" % d)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="YYYY-MM-DD in ET (default: yesterday)")
    args = ap.parse_args(argv)
    day = args.date or (datetime.now(ET) - timedelta(days=1)).strftime("%Y-%m-%d")

    oc.ensure_ssl_certs()
    key = oc.load_env().get("CFBD_API_KEY")
    if not key:
        print("ERROR: CFBD_API_KEY missing in .env", file=sys.stderr)
        return 1

    card, proj = load_card(), load_proj()
    fin = finals(day, key)
    byg = {(c["away"], c["home"]): c for c in card["games"]}
    rows = [(k, byg[k], fin[k]) for k in fin if k in byg]
    print("\nNCAAF REPORT CARD -- %s (ET)" % day)
    print("finals that day: %d   |  on our published board: %d\n" % (len(fin), len(rows)))
    if not rows:
        print("Nothing on our board for that date -- the board is FBS-focused, so a slate of "
              "Division II/III games grades as zero.\n")
        return 0
    grade_games(rows)
    grade_props(day, proj, key)
    print("\nOne day is not a sample. Accumulate these before drawing a conclusion: a 6-of-8 dog "
          "slate happens ~11% of the time by chance on a board that is centred.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
