"""
weekly_report.py -- the weekly report card, graded against what we PUBLISHED.

    python weekly_report.py --sport nfl   --season 2026 --week 1
    python weekly_report.py --sport ncaaf --season 2026 --week 2

Writes web/lib/reportCards.ts (AUTO-GENERATED; merged by sport+season+week so weeks accumulate).
The narrative -- what we learned, what changed -- lives in web/lib/reportNotes.ts, hand-written,
keyed the same way, so a regeneration never wipes it.

WHAT IS GRADED, AND AGAINST WHAT
  * "What we published" is the committed file at the LAST COMMIT BEFORE EACH GAME'S KICKOFF
    (git rev-list --before), never the working copy: the nightly jobs regenerate the projection
    files and the NCAAF card daily, so today's file is not what a reader saw on Saturday.
  * The market is the CLOSING line: the last PREGAME sweep per game (odds/prop snapshots with
    snapshot_at < commence_time), FanDuel where FanDuel posted, else the US-book median. The
    projections file's `book` is not used for the NFL: the export that produced it ran after
    Sunday kickoff and picked up LIVE lines (Jalen Coker 130.5 receiving yards, three hours in).
  * Games: straight-up (our projected winner), against the close (the side our margin implies
    against the market spread), totals (our number vs the market's), Brier on our home win
    probability where we published one (NFL ledger).
  * Props: the LEAN the board showed (projLean, mirrored here), graded over/under against the
    close; our projection's absolute error beside the book's line error; the share of rows our
    projection sat above the line vs the share that actually went over.

Stdlib + the project's own clients. Keys read from .env inside the clients, never printed.
"""
import argparse
import collections
import csv
import datetime as dt
import json
import os
import re
import statistics
import subprocess
import sys
import unicodedata
import urllib.parse

import cfbd_client as cc
import odds_client as oc
import cfb_player_proj as cpp

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "web", "lib", "reportCards.ts")
ET = dt.timezone(dt.timedelta(hours=-4))
US_BOOKS = {"draftkings", "fanduel", "betmgm", "williamhill_us", "fanatics", "betrivers",
            "espnbet", "hardrockbet", "ballybet", "betparx"}
LINE_BOOK = "fanduel"
NFL_MODEL_VERSION = "game-v4-injury"

# Mirrors web/lib/projLean.ts -- grade what the board SHOWED.
LEAN_PRIOR_GAMES, LEAN_MARGIN, MIN_PROJ_GAMES = 6, 0.04, 5
MARKET_KEY = {"pass_yds": "player_pass_yds", "pass_tds": "player_pass_tds", "rush_yds": "player_rush_yds",
              "rec_yds": "player_reception_yds", "receptions": "player_receptions",
              "anytime_td": "player_anytime_td"}
NFL_STAT = {"pass_yds": "passing_yards", "pass_tds": "passing_tds", "rush_yds": "rushing_yards",
            "rec_yds": "receiving_yards", "receptions": "receptions"}
CFB_STAT = {"pass_yds": "passing|YDS", "pass_tds": "passing|TD", "rush_yds": "rushing|YDS",
            "rec_yds": "receiving|YDS", "receptions": "receiving|REC"}
CAT_LABEL = {"passing": "Passing", "rushing": "Rushing", "receiving": "Receiving",
             "receptions": "Receptions", "td": "Anytime TD"}


# ----------------------------------------------------------------------------- helpers
def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\.?\s*$", "", s.strip())
    return re.sub(r"[^a-z]", "", s)


def iso(t):
    return dt.datetime.fromisoformat(t.replace("Z", "+00:00"))


def git_ref_before(when_iso):
    """The last commit on main before `when_iso` -- the file a reader saw at that moment."""
    out = subprocess.run(["git", "rev-list", "-1", f"--before={when_iso}", "main"],
                         cwd=ROOT, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def git_show(ref, path):
    """The file at `ref`, or "" when it did not exist yet (a week-0 kickoff predates the file)."""
    out = subprocess.run(["git", "show", f"{ref}:{path}"], cwd=ROOT, capture_output=True,
                         text=True, encoding="utf-8")
    return out.stdout if out.returncode == 0 else ""


def json_lines(s):
    """The projection files emit one JSON object per line."""
    rows = []
    for m in re.findall(r"^\s*(\{.*\}),?\s*$", s, re.M):
        try:
            rows.append(json.loads(m))
        except ValueError:
            pass
    return rows


def american_to_prob(a):
    a = float(a)
    return 100.0 / (a + 100.0) if a > 0 else -a / (-a + 100.0)


def devig(pa, pb):
    """Two-way de-vig (proportional). Returns P(a)."""
    ia, ib = american_to_prob(pa), american_to_prob(pb)
    return ia / (ia + ib) if ia + ib else None


def wl(hit, push=False):
    return "push" if push else ("win" if hit else "loss")


def tally(results):
    c = collections.Counter(results)
    return {"w": c["win"], "l": c["loss"], "p": c["push"]}


def lean_centres(rows):
    cen = {}
    by = collections.defaultdict(list)
    for r in rows:
        if r.get("book") is None or r["cat"] == "td" or not r.get("cG"):
            continue
        by[r["cat"]].append(r["cOver"] / r["cG"])
    for cat, vs in by.items():
        cen[cat] = statistics.median(vs)
    return cen


def prop_lean(r, cen):
    if r.get("book") is None or r.get("proj") is None:
        return None
    if r["cat"] == "td":
        return "over" if r["proj"] >= r["book"] else "under"
    if not r.get("cG") or (r.get("g") or 0) < MIN_PROJ_GAMES:
        return None
    c = cen.get(r["cat"], 0.5)
    p = (r["cOver"] + LEAN_PRIOR_GAMES * c) / (r["cG"] + LEAN_PRIOR_GAMES)
    return "over" if p >= c + LEAN_MARGIN else ("under" if p <= c - LEAN_MARGIN else None)


def main_line(quotes):
    """Per book, the rung priced closest to even money is the MAIN line; FanDuel's where FanDuel
    posts one, else the median of the US books' main lines. quotes: [(book, side, line, price)]."""
    per = {}
    for book, side, line, price in quotes:
        if side not in ("Over", "Yes") or line is None or book not in US_BOOKS:
            continue
        gap = abs(price or 0)
        if book not in per or gap < per[book][1]:
            per[book] = (line, gap)
    if LINE_BOOK in per:
        return per[LINE_BOOK][0], LINE_BOOK
    if per:
        return statistics.median(v[0] for v in per.values()), "median"
    return None, None


def td_pct(quotes):
    """FanDuel's Yes price as an implied %, else the US-book median implied %."""
    ys = {b: p for b, s, _l, p in quotes if s == "Yes" and b in US_BOOKS and p is not None}
    if LINE_BOOK in ys:
        return round(100 * american_to_prob(ys[LINE_BOOK]), 1), LINE_BOOK
    if ys:
        return round(100 * statistics.median(american_to_prob(p) for p in ys.values()), 1), "median"
    return None, None


def game_close(rows, home, away):
    """FanDuel's closing spread (home number), total and de-vigged home win prob from one sweep's
    rows [(book, market, outcome, point, price)]; US-book median where FanDuel is missing."""
    def pick(market, outcome):
        pts = {}
        for b, m, o, pt, pr in rows:
            if m == market and o == outcome and pt is not None and b in US_BOOKS:
                pts.setdefault(b, pt)
        if LINE_BOOK in pts:
            return pts[LINE_BOOK]
        return round(statistics.median(pts.values()) * 2) / 2 if pts else None
    spread = pick("spreads", home)
    total = pick("totals", "Over")
    ml = {}
    for b, m, o, pt, pr in rows:
        if m == "h2h" and b in US_BOOKS and pr is not None:
            ml.setdefault(b, {})[o] = pr
    mkt_home = None
    src = ml.get(LINE_BOOK) or next(iter(ml.values()), None)
    if src and home in src and away in src:
        mkt_home = devig(src[home], src[away])
    return spread, total, mkt_home


def grade_game(home_margin_ours, mkt_spread_home, our_total, mkt_total, final_home_margin, final_total):
    """Straight-up, against the close, totals. `mkt_spread_home` negative = home favoured."""
    out = {}
    out["su"] = wl((home_margin_ours > 0) == (final_home_margin > 0), final_home_margin == 0 or home_margin_ours == 0)
    if mkt_spread_home is not None:
        # Our side of the MARKET number: home if we have home doing better than the market does.
        side_home = home_margin_ours > -mkt_spread_home
        cover = (final_home_margin + mkt_spread_home) if side_home else -(final_home_margin + mkt_spread_home)
        out["ats"] = {"side": "home" if side_home else "away",
                      "num": mkt_spread_home if side_home else -mkt_spread_home,
                      "lay": (mkt_spread_home < 0) if side_home else (mkt_spread_home > 0),
                      "result": wl(cover > 0, abs(cover) < 1e-9)}
    if mkt_total is not None and our_total is not None:
        over = our_total > mkt_total
        out["total"] = {"call": "over" if over else "under", "num": mkt_total, "ours": our_total,
                        "result": wl((final_total > mkt_total) if over else (final_total < mkt_total),
                                     final_total == mkt_total)}
    return out


def summarize_games(games):
    su = tally(g["su"] for g in games if "su" in g)
    ats = tally(g["ats"]["result"] for g in games if "ats" in g)
    lay = tally(g["ats"]["result"] for g in games if "ats" in g and g["ats"]["lay"])
    dog = tally(g["ats"]["result"] for g in games if "ats" in g and not g["ats"]["lay"])
    tot = tally(g["total"]["result"] for g in games if "total" in g)
    over = tally(g["total"]["result"] for g in games if "total" in g and g["total"]["call"] == "over")
    under = tally(g["total"]["result"] for g in games if "total" in g and g["total"]["call"] == "under")
    probs = [(g["model"]["homeProb"], 1.0 if g["final"]["home"] > g["final"]["away"] else 0.0)
             for g in games if g["model"].get("homeProb") is not None]
    brier = round(statistics.mean((p - y) ** 2 for p, y in probs), 4) if probs else None
    mkt = [(g["close"]["homeProb"], 1.0 if g["final"]["home"] > g["final"]["away"] else 0.0)
           for g in games if g["close"].get("homeProb") is not None]
    mbrier = round(statistics.mean((p - y) ** 2 for p, y in mkt), 4) if mkt else None
    ours_err = [abs(g["model"]["homeMargin"] - (g["final"]["home"] - g["final"]["away"])) for g in games]
    mkt_err = [abs(-g["close"]["spreadHome"] - (g["final"]["home"] - g["final"]["away"]))
               for g in games if g["close"].get("spreadHome") is not None]
    return {"games": len(games), "su": su, "ats": ats, "lay": lay, "dog": dog, "totals": tot,
            "overs": over, "unders": under, "brier": brier, "marketBrier": mbrier,
            "marginMae": round(statistics.mean(ours_err), 1) if ours_err else None,
            "marketMarginMae": round(statistics.mean(mkt_err), 1) if mkt_err else None}


def summarize_props(props):
    by = collections.defaultdict(list)
    for p in props:
        by[p["cat"]].append(p)
    out = {}
    for cat, rows in by.items():
        graded = [r for r in rows if r.get("actual") is not None]
        leaned = [r for r in graded if r.get("lean")]
        cont = [r for r in graded if cat != "td" and r.get("proj") is not None]
        out[cat] = {
            "n": len(rows), "graded": len(graded),
            "lean": tally(r["result"] for r in leaned),
            "overLean": tally(r["result"] for r in leaned if r["lean"] == "over"),
            "underLean": tally(r["result"] for r in leaned if r["lean"] == "under"),
            "projMae": round(statistics.mean(abs(r["proj"] - r["actual"]) for r in cont), 1) if cont else None,
            "lineMae": round(statistics.mean(abs(r["line"] - r["actual"]) for r in cont), 1) if cont else None,
            "projAboveLine": round(100 * sum(1 for r in cont if r["proj"] > r["line"]) / len(cont)) if cont else None,
            "actualOver": round(100 * sum(1 for r in cont if r["actual"] > r["line"]) / len(cont)) if cont else None,
            "projBias": round(statistics.mean(r["proj"] - r["actual"] for r in cont), 1) if cont else None,
        }
        if cat == "td":
            # A TD lean is not a coin flip: "over" on a 15% player who then does not score is the
            # expected outcome, not a miss. So the TD card is CALIBRATION -- our % vs the book's
            # implied % vs how often they actually scored -- and a Brier score for each.
            td = [r for r in graded if r.get("proj") is not None]
            if td:
                ours = [r["proj"] / 100 for r in td]
                book = [r["line"] / 100 for r in td]
                y = [1.0 if r["actual"] else 0.0 for r in td]
                out[cat].update({
                    "tdRows": len(td),
                    "meanOurs": round(100 * statistics.mean(ours), 1),
                    "meanBook": round(100 * statistics.mean(book), 1),
                    "scoredPct": round(100 * statistics.mean(y), 1),
                    "brierOurs": round(statistics.mean((p - t) ** 2 for p, t in zip(ours, y)), 4),
                    "brierBook": round(statistics.mean((p - t) ** 2 for p, t in zip(book, y)), 4),
                })
    return out


# ----------------------------------------------------------------------------- NFL
def nfl_games_csv():
    import grade_predictions as gp
    g = gp.fetch_fresh_games()
    if g is None:
        import pandas as pd
        g = pd.read_csv(gp.GAMES_LOCAL, low_memory=False)
    return g


def nfl_closing_rows(season, week, event_id):
    """One sweep's rows for the event: its last PREGAME sweep."""
    base = (f"odds_snapshots?season=eq.{season}&week=eq.{week}&event_id=eq.{event_id}"
            f"&capture_reason=in.(SCHEDULED,MANUAL,PRE_KICKOFF)")
    # One row per sweep (FanDuel's Over on the total) finds the last pregame sweep cheaply.
    marks = cpp.sb_get(f"{base}&book=eq.{LINE_BOOK}&market=eq.totals&outcome_name=eq.Over"
                       f"&select=snapshot_at,commence_time&order=snapshot_at.desc")
    pre = [m for m in marks if m["snapshot_at"] < m["commence_time"]]
    if not pre:
        return None, []
    snap = pre[0]["snapshot_at"]
    rows = cpp.sb_get(f"{base}&snapshot_at=eq.{urllib.parse.quote(snap)}"
                      f"&select=book,market,outcome_name,outcome_point,price_american")
    return snap, [(r["book"], r["market"], r["outcome_name"],
                   float(r["outcome_point"]) if r["outcome_point"] is not None else None,
                   r["price_american"]) for r in rows]


def nfl_prop_close(season, week, event_id, commence):
    """FanDuel's (else median) closing main line / TD % per (player, market) for one event."""
    probe = cpp.sb_get(f"prop_snapshots?season=eq.{season}&week=eq.{week}&event_id=eq.{event_id}"
                       f"&market=eq.player_anytime_td&side=eq.Yes&select=collected_at&order=collected_at.desc")
    kick = iso(commence)
    times = sorted({r["collected_at"] for r in probe if r.get("collected_at") and iso(r["collected_at"]) < kick})
    if not times:
        return {}
    last = iso(times[-1])
    lo = (last - dt.timedelta(hours=1)).isoformat()
    rows = cpp.sb_get(f"prop_snapshots?season=eq.{season}&week=eq.{week}&event_id=eq.{event_id}"
                      f"&collected_at=gte.{urllib.parse.quote(lo)}&collected_at=lt.{urllib.parse.quote(commence)}"
                      f"&select=book,market,player_name,side,line,price_american")
    by = collections.defaultdict(list)
    for r in rows:
        by[(norm(r["player_name"]), r["market"])].append(
            (r["book"], r["side"], float(r["line"]) if r["line"] is not None else None, r["price_american"]))
    out = {}
    for (p, m), qs in by.items():
        out[(p, m)] = td_pct(qs) if m == "player_anytime_td" else main_line(qs)
    return out


def build_nfl(season, week):
    import pandas as pd
    games = nfl_games_csv()
    wk = games[(games.season == season) & (games.week == week) & games.home_score.notna()]
    if wk.empty:
        raise SystemExit(f"no final scores for NFL {season} week {week} yet")
    finals = {(r.away_team, r.home_team): r for _, r in wk.iterrows()}
    kick_of = {}
    for _, r in wk.iterrows():
        # nflverse gametime is ET
        t = dt.datetime.strptime(f"{r.gameday} {r.gametime}", "%Y-%m-%d %H:%M").replace(tzinfo=ET)
        kick_of[(r.away_team, r.home_team)] = t.astimezone(dt.timezone.utc)

    ledger = cpp.sb_get(f"prediction_ledger?section=eq.MODEL&season=eq.{season}&week=eq.{week}"
                        f"&model_version=eq.{NFL_MODEL_VERSION}"
                        f"&select=event_id,subject,model_prob,commence_time,reasoning")
    # model totals + projections as published: one ref per kickoff day
    refs = {}
    def ref_for(when):
        k = when.isoformat()
        if k not in refs:
            refs[k] = git_ref_before(k)
        return refs[k]

    out_games = []
    for p in ledger:
        home = p["subject"]
        reason = p.get("reasoning") or {}
        key = next((k for k in finals if k[1] == home), None)
        if not key:
            continue
        away = key[0]
        fin = finals[key]
        snap, rows = nfl_closing_rows(season, week, p["event_id"])
        spread, total, mkt_home = game_close(rows, home, away)
        ref = ref_for(kick_of[key])
        totals_ts = git_show(ref, "web/lib/modelTotals.ts")
        m = re.search(rf'"{week}-{away}-{home}":\s*([\d.]+)', totals_ts)
        our_total = float(m.group(1)) if m else None
        our_margin = float(reason.get("pred_margin") or 0)
        fh, fa = int(fin.home_score), int(fin.away_score)
        g = {"away": away, "home": home, "kickoff": kick_of[key].isoformat(),
             "final": {"away": fa, "home": fh},
             "model": {"favored": reason.get("favored") or (home if our_margin >= 0 else away),
                       "homeMargin": round(our_margin, 1), "homeProb": round(float(p["model_prob"]), 3),
                       "total": our_total},
             "close": {"spreadHome": spread, "total": total,
                       "homeProb": round(mkt_home, 3) if mkt_home is not None else None,
                       "asOf": snap}}
        g.update(grade_game(our_margin, spread, our_total, total, fh - fa, fh + fa))
        out_games.append(g)
    out_games.sort(key=lambda g: g["kickoff"])

    # ---- props
    stats = pd.read_csv(os.path.join(ROOT, "data", "stats_2026.csv"), low_memory=False)
    st = stats[(stats.season == season) & (stats.week == week)]
    actual = {}
    for _, r in st.iterrows():
        if not isinstance(r.player_display_name, str):
            continue
        actual[(norm(r.player_display_name), r.team)] = r
        actual.setdefault((norm(r.player_display_name), None), r)
    props = []
    seen_ref = {}
    ev_by_game = {}
    for p in ledger:
        home = p["subject"]
        key = next((k for k in finals if k[1] == home), None)
        if key:
            ev_by_game[f"{key[0]} @ {key[1]}"] = (p["event_id"], p["commence_time"])
    closes = {}
    for game, (eid, commence) in ev_by_game.items():
        closes[game] = nfl_prop_close(season, week, eid, commence)
    proj_rows_by_ref = {}
    for game, (eid, commence) in ev_by_game.items():
        away, home = game.split(" @ ")
        ref = ref_for(kick_of[(away, home)])
        if ref not in proj_rows_by_ref:
            txt = git_show(ref, "web/lib/playerProjections.ts")
            pw = re.search(r"PROJ_WEEK = (\d+)", txt)
            proj_rows_by_ref[ref] = json_lines(txt) if pw and int(pw.group(1)) == week else []
        rows = [r for r in proj_rows_by_ref[ref] if r["game"] == game]
        cen = lean_centres(proj_rows_by_ref[ref])
        cl = closes.get(game, {})
        for r in rows:
            k = (norm(r["player"]), MARKET_KEY[r["market"]])
            line, src = cl.get(k, (None, None))
            if line is None:
                continue                       # no pregame FanDuel/US line -> not gradeable
            a = actual.get((norm(r["player"]), r["team"]))
            if a is None:
                a = actual.get((norm(r["player"]), None))
            row = {"player": r["player"], "team": r["team"], "pos": r["pos"], "game": game,
                   "cat": r["cat"], "market": r["market"], "line": line, "lineSrc": src,
                   "proj": r["proj"], "lean": prop_lean({**r, "book": line}, cen), "actual": None, "result": None}
            if a is not None:
                if r["market"] == "anytime_td":
                    scored = (float(a.rushing_tds or 0) + float(a.receiving_tds or 0)) > 0
                    row["actual"] = 100.0 if scored else 0.0
                    if row["lean"]:
                        row["result"] = wl((row["lean"] == "over") == scored)
                else:
                    v = a.get(NFL_STAT[r["market"]])
                    if v is not None and not (isinstance(v, float) and v != v):
                        row["actual"] = float(v)
                        if row["lean"]:
                            hit = row["actual"] > line if row["lean"] == "over" else row["actual"] < line
                            row["result"] = wl(hit, row["actual"] == line)
            props.append(row)
    return {"sport": "nfl", "season": season, "week": week, "label": f"NFL Week {week}",
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "publishedRefs": sorted(set(refs.values())),
            "games": out_games, "gameSummary": summarize_games(out_games),
            "props": props, "propSummary": summarize_props(props)}


# ----------------------------------------------------------------------------- NCAAF
def cfb_week_games(season, week, key):
    st, games = cc.cfbd_get("/games", {"year": season, "week": week, "seasonType": "regular"}, key)
    return [g for g in (games or []) if g.get("homePoints") is not None and g.get("startDate")]


def cfb_close(season, week_games, key):
    """Closing FanDuel spread/total/ML per (away, home) from cfb_odds_snapshots -- the last
    pregame sweep per event. Odds-feed team names -> CFBD names via cfbd_team_map."""
    lo = min(g["startDate"] for g in week_games)
    hi = max(g["startDate"] for g in week_games)
    lo_q = urllib.parse.quote((iso(lo) - dt.timedelta(days=1)).isoformat())
    hi_q = urllib.parse.quote((iso(hi) + dt.timedelta(hours=1)).isoformat())
    marks = cpp.sb_get(f"cfb_odds_snapshots?commence_time=gte.{lo_q}&commence_time=lte.{hi_q}"
                       f"&book=eq.{LINE_BOOK}&market=eq.totals&outcome_name=eq.Over"
                       f"&select=event_id,snapshot_at,commence_time,home_team,away_team")
    last = {}
    for m in marks:
        if m["snapshot_at"] >= m["commence_time"]:
            continue
        cur = last.get(m["event_id"])
        if not cur or m["snapshot_at"] > cur["snapshot_at"]:
            last[m["event_id"]] = m
    names = {t for m in last.values() for t in (m["home_team"], m["away_team"])}
    cmap = cpp.cfbd_team_map(names, key)
    out = {}
    for eid, m in last.items():
        rows = cpp.sb_get(f"cfb_odds_snapshots?event_id=eq.{eid}&snapshot_at=eq.{urllib.parse.quote(m['snapshot_at'])}"
                          f"&select=book,market,outcome_name,outcome_point,price_american")
        home, away = m["home_team"], m["away_team"]
        rs = [(r["book"], r["market"], r["outcome_name"],
               float(r["outcome_point"]) if r["outcome_point"] is not None else None, r["price_american"])
              for r in rows]
        spread, total, mkt_home = game_close(rs, home, away)
        out[(cmap.get(away, away), cmap.get(home, home))] = (spread, total, mkt_home, m["snapshot_at"])
    return out


def cfb_actuals(season, week, teams, key):
    act = {}
    for t in sorted(teams):
        st, data = cc.cfbd_get("/games/players", {"year": season, "week": week, "team": t}, key)
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
    return act


def build_ncaaf(season, week):
    key = oc.load_env().get("CFBD_API_KEY")
    if not key:
        raise SystemExit("CFBD_API_KEY missing in .env")
    finals = cfb_week_games(season, week, key)
    if not finals:
        raise SystemExit(f"no NCAAF finals for {season} week {week}")
    fin = {(g["awayTeam"], g["homeTeam"]): g for g in finals}
    close = cfb_close(season, finals, key)

    refs, cards, projs = {}, {}, {}
    def ref_for(when_iso):
        if when_iso not in refs:
            refs[when_iso] = git_ref_before(when_iso)
        return refs[when_iso]
    def card_at(ref):
        if ref not in cards:
            s = git_show(ref, "web/app/ncaaf/model-data.ts")
            m = re.search(r"export const NCAAF_MODEL[^=]*=\s*", s)
            cards[ref] = json.loads(s[s.index("{", m.end() - 1): s.rindex("}") + 1])["card"] if m else {"games": []}
        return cards[ref]
    def proj_at(ref):
        if ref not in projs:
            s = git_show(ref, "web/lib/ncaafPlayerProjections.ts")
            pw = re.search(r"NCAAF_PROJ_WEEK = (\d+)", s)
            projs[ref] = json_lines(s) if pw and int(pw.group(1)) == week else []
        return projs[ref]

    out_games = []
    for (away, home), g in fin.items():
        ref = ref_for(g["startDate"])
        card = card_at(ref)
        c = next((x for x in card["games"] if x["away"] == away and x["home"] == home), None)
        if not c or not c.get("projSpread"):
            continue
        ours = -abs(c["projSpread"]["num"]) if c["projSpread"]["fav"] == home else abs(c["projSpread"]["num"])
        spread, total, mkt_home, snap = close.get((away, home), (None, None, None, None))
        if spread is None and c.get("marketSpread"):      # no capture: the card's own market line
            ms = c["marketSpread"]
            spread = -abs(ms["num"]) if ms["fav"] == home else abs(ms["num"])
            total = total if total is not None else c.get("marketTotal")
        fh, fa = int(g["homePoints"]), int(g["awayPoints"])
        row = {"away": away, "home": home, "kickoff": g["startDate"],
               "final": {"away": fa, "home": fh},
               "model": {"favored": c["projSpread"]["fav"], "homeMargin": round(-ours, 1),
                         "homeProb": None, "total": c.get("projTotal")},
               "close": {"spreadHome": spread, "total": total,
                         "homeProb": round(mkt_home, 3) if mkt_home is not None else None, "asOf": snap},
               "conf": c.get("conf"), "apAway": c.get("apAway"), "apHome": c.get("apHome")}
        row.update(grade_game(-ours, spread, c.get("projTotal"), total, fh - fa, fh + fa))
        out_games.append(row)
    out_games.sort(key=lambda g: g["kickoff"])

    # ---- props: as published at each game's kickoff, graded vs the file's (pregame) book line
    props = []
    teams = set()
    prow_by_game = {}
    for (away, home), g in fin.items():
        rows = [r for r in proj_at(ref_for(g["startDate"])) if r["game"] == f"{away} @ {home}" and r.get("book") is not None]
        if rows:
            prow_by_game[(away, home)] = (rows, lean_centres(proj_at(ref_for(g["startDate"]))))
            teams |= {away, home}
    act = cfb_actuals(season, week, teams, key)
    def num(x):
        try:
            return float(str(x).replace(",", ""))
        except (TypeError, ValueError):
            return None
    for (away, home), (rows, cen) in prow_by_game.items():
        for r in rows:
            a = act.get(norm(r["player"]))
            row = {"player": r["player"], "team": r.get("team") or "", "pos": r.get("pos") or "", "game": r["game"],
                   "cat": r["cat"], "market": r["market"], "line": r["book"], "lineSrc": "file",
                   "proj": r.get("proj"), "lean": prop_lean(r, cen), "actual": None, "result": None}
            if a is not None:
                if r["market"] == "anytime_td":
                    scored = (num(a.get("rushing|TD")) or 0) + (num(a.get("receiving|TD")) or 0) > 0
                    row["actual"] = 100.0 if scored else 0.0
                    if row["lean"]:
                        row["result"] = wl((row["lean"] == "over") == scored)
                else:
                    v = num(a.get(CFB_STAT[r["market"]]))
                    if v is not None:
                        row["actual"] = v
                        if row["lean"]:
                            hit = v > r["book"] if row["lean"] == "over" else v < r["book"]
                            row["result"] = wl(hit, v == r["book"])
            props.append(row)
    return {"sport": "ncaaf", "season": season, "week": week, "label": f"NCAAF Week {week}",
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "publishedRefs": sorted(set(refs.values())),
            "games": out_games, "gameSummary": summarize_games(out_games),
            "props": props, "propSummary": summarize_props(props)}


# ----------------------------------------------------------------------------- write
def load_existing():
    if not os.path.exists(OUT):
        return []
    s = open(OUT, encoding="utf-8").read()
    m = re.search(r"REPORT_CARDS: ReportCard\[\] = (\[.*\]);", s, re.S)
    return json.loads(m.group(1)) if m else []


def write(cards):
    cards.sort(key=lambda c: (c["season"], c["week"], c["sport"]), reverse=True)
    body = (
        "// AUTO-GENERATED by weekly_report.py -- do not edit by hand. Narrative lives in reportNotes.ts.\n"
        "export type WL = \"win\" | \"loss\" | \"push\";\n"
        "export interface Tally { w: number; l: number; p: number }\n"
        "export interface ReportGame {\n"
        "  away: string; home: string; kickoff: string; final: { away: number; home: number };\n"
        "  model: { favored: string; homeMargin: number; homeProb: number | null; total: number | null };\n"
        "  close: { spreadHome: number | null; total: number | null; homeProb: number | null; asOf: string | null };\n"
        "  su: WL; ats?: { side: \"home\" | \"away\"; num: number; lay: boolean; result: WL };\n"
        "  total?: { call: \"over\" | \"under\"; num: number; ours: number; result: WL };\n"
        "  conf?: string | null; apAway?: number | null; apHome?: number | null;\n"
        "}\n"
        "export interface ReportProp {\n"
        "  player: string; team: string; pos: string; game: string; cat: string; market: string;\n"
        "  line: number; lineSrc: string; proj: number | null; lean: \"over\" | \"under\" | null;\n"
        "  actual: number | null; result: WL | null;\n"
        "}\n"
        "export interface GameSummary {\n"
        "  games: number; su: Tally; ats: Tally; lay: Tally; dog: Tally; totals: Tally; overs: Tally; unders: Tally;\n"
        "  brier: number | null; marketBrier: number | null; marginMae: number | null; marketMarginMae: number | null;\n"
        "}\n"
        "export interface PropCatSummary {\n"
        "  n: number; graded: number; lean: Tally; overLean: Tally; underLean: Tally;\n"
        "  projMae: number | null; lineMae: number | null; projAboveLine: number | null; actualOver: number | null;\n"
        "  projBias: number | null;\n"
        "  tdRows?: number; meanOurs?: number; meanBook?: number; scoredPct?: number; brierOurs?: number; brierBook?: number;\n"
        "}\n"
        "export interface ReportCard {\n"
        "  sport: \"nfl\" | \"ncaaf\"; season: number; week: number; label: string; generatedAt: string;\n"
        "  publishedRefs: string[]; games: ReportGame[]; gameSummary: GameSummary;\n"
        "  props: ReportProp[]; propSummary: Record<string, PropCatSummary>;\n"
        "}\n"
        "export const REPORT_CARDS: ReportCard[] = " + json.dumps(cards, indent=1) + ";\n"
    )
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body)


def print_summary(card):
    s = card["gameSummary"]
    print(f"\n{card['label']} -- {s['games']} games graded (published refs: {', '.join(r[:7] for r in card['publishedRefs'])})")
    print(f"  straight-up {s['su']['w']}-{s['su']['l']}   vs close {s['ats']['w']}-{s['ats']['l']}-{s['ats']['p']}"
          f"   (laying {s['lay']['w']}-{s['lay']['l']}, taking {s['dog']['w']}-{s['dog']['l']})"
          f"   totals {s['totals']['w']}-{s['totals']['l']}-{s['totals']['p']} (overs {s['overs']['w']}-{s['overs']['l']}, unders {s['unders']['w']}-{s['unders']['l']})")
    print(f"  margin MAE ours {s['marginMae']} vs market {s['marketMarginMae']}   Brier ours {s['brier']} vs market {s['marketBrier']}")
    for cat, c in card["propSummary"].items():
        print(f"  props {cat:10} rows {c['n']:4} graded {c['graded']:4}  lean {c['lean']['w']}-{c['lean']['l']}"
              f" (over {c['overLean']['w']}-{c['overLean']['l']}, under {c['underLean']['w']}-{c['underLean']['l']})"
              f"  MAE ours {c['projMae']} book {c['lineMae']}  proj>line {c['projAboveLine']}% actual over {c['actualOver']}%  bias {c['projBias']}"
              + (f"  | TD: ours {c['meanOurs']}% book {c['meanBook']}% scored {c['scoredPct']}%  Brier ours {c['brierOurs']} book {c['brierBook']}" if "tdRows" in c else ""))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sport", choices=["nfl", "ncaaf"], required=True)
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--week", type=int, required=True)
    ap.add_argument("--dry", action="store_true", help="print, do not write")
    args = ap.parse_args(argv)
    oc.ensure_ssl_certs()
    card = build_nfl(args.season, args.week) if args.sport == "nfl" else build_ncaaf(args.season, args.week)
    print_summary(card)
    if args.dry:
        return 0
    cards = [c for c in load_existing()
             if not (c["sport"] == card["sport"] and c["season"] == card["season"] and c["week"] == card["week"])]
    cards.append(card)
    write(cards)
    print(f"Wrote {OUT} ({len(cards)} report cards).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
