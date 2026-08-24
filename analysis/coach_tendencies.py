"""
coach_tendencies.py -- head-coach tendencies from play-by-play, for the Coach Analysis
Context card. Two stable, measurable identity signals:

  * 4th-down aggressiveness -- go-for-it rate in the "gray zone" (4th-and-<=2, midfield,
    competitive game) vs the league. The classic aggressive-vs-conservative metric.
  * Pass tendency (PROE)    -- mean pass-rate-over-expected on early downs (nflverse xpass
    model), competitive situations. Positive = pass-leaning, negative = run-leaning.

CONTEXT ONLY. Coaching identity is heavily priced by the market -- this informs, it is not
an edge (see EMPIRICAL_REFERENCE 9b: even our accurate projections don't beat the line).
Aggregated 2021-2024, mapped to each team's CURRENT coach. Writes web/lib/coachTendencies.ts.

    python analysis/coach_tendencies.py
"""
from pathlib import Path
import pandas as pd
import numpy as np

HERE = Path(__file__).resolve().parent
D = HERE.parent / "data"
OUT = HERE.parent / "web" / "lib" / "coachTendencies.ts"
SEASONS = range(2021, 2025)
MIN_4TH = 12      # gray-zone 4th downs needed to rate aggressiveness
MIN_ED = 250      # early-down plays needed to rate pass tendency


def coach_maps():
    g = pd.read_csv(D / "games.csv", low_memory=False)
    per_game = {}                 # (season, week, team) -> coach
    latest = {}                   # team -> (season, week, coach)
    for _, r in g.iterrows():
        if pd.isna(r.get("season")) or pd.isna(r.get("week")):
            continue
        s, w = int(r["season"]), int(r["week"])
        for side in ("home", "away"):
            team, coach = r.get(f"{side}_team"), r.get(f"{side}_coach")
            if pd.isna(team) or pd.isna(coach):
                continue
            per_game[(s, w, team)] = coach
            if team not in latest or (s, w) > latest[team][:2]:
                latest[team] = (s, w, coach)
    return per_game, {t: v[2] for t, v in latest.items()}


def load_pbp():
    keep = {"season", "week", "posteam", "play_type", "down", "ydstogo", "yardline_100",
            "field_goal_attempt", "punt_attempt", "qb_kneel", "qb_spike",
            "xpass", "pass_oe", "wp", "game_id", "yards_gained"}
    frames = []
    for y in SEASONS:
        p = D / f"pbp_{y}.csv.gz"
        if p.exists():
            frames.append(pd.read_csv(p, compression="gzip", low_memory=False,
                                      usecols=lambda c: c in keep))
    df = pd.concat(frames, ignore_index=True)
    return df


def label_agg(pct):
    return ("Very aggressive" if pct >= 85 else "Aggressive" if pct >= 60
            else "Conservative" if pct <= 15 else "Cautious" if pct <= 40 else "Balanced")


def label_proe(v):
    return ("Pass-heavy" if v >= 3 else "Pass-leaning" if v >= 1
            else "Run-heavy" if v <= -3 else "Run-leaning" if v <= -1 else "Balanced")


PRIOR_SEASON = 2024      # last completed season -> the "prior season" column
MIN_PROD_G = 8           # games needed before we show a production number


def points_by_coach():
    """Per-coach points scored per game, from final scores in games.csv.
    Career = the 2021-2024 window (kept in step with the play-by-play span used for
    yards, so the two columns describe the same games); prior = 2024 only."""
    g = pd.read_csv(D / "games.csv", low_memory=False)
    rows = []
    for _, r in g.iterrows():
        if pd.isna(r.get("season")):
            continue
        s = int(r["season"])
        if s not in set(SEASONS):
            continue
        for side in ("home", "away"):
            coach, score = r.get(f"{side}_coach"), r.get(f"{side}_score")
            if pd.isna(coach) or pd.isna(score):
                continue
            rows.append((coach, s, float(score)))
    p = pd.DataFrame(rows, columns=["coach", "season", "pts"])
    career = p.groupby("coach")["pts"].agg(pts="mean", g="count")
    prior = p[p.season == PRIOR_SEASON].groupby("coach")["pts"].agg(pts="mean", g="count")
    return career, prior


def yards_by_coach(pbp):
    """Per-coach team offensive yards per game (run + pass yards_gained, summed per game
    then averaged). Same career/prior split as points."""
    off = pbp[pbp["play_type"].isin(["run", "pass"])].copy()
    per_game = off.groupby(["coach", "season", "game_id"])["yards_gained"].sum().reset_index()
    career = per_game.groupby("coach")["yards_gained"].agg(yds="mean", g="count")
    prior = per_game[per_game.season == PRIOR_SEASON].groupby("coach")["yards_gained"].agg(yds="mean", g="count")
    return career, prior


def main():
    per_game, current = coach_maps()
    pbp = load_pbp()
    pbp["coach"] = [per_game.get((int(s), int(w), t)) if pd.notna(t) else None
                    for s, w, t in zip(pbp.season, pbp.week, pbp.posteam)]
    pbp = pbp[pbp["coach"].notna()].copy()

    # --- production: yards/game + points/game, career (2021-24) and prior season ---
    yds_career, yds_prior = yards_by_coach(pbp)
    pts_career, pts_prior = points_by_coach()

    comp = pbp["wp"].between(0.10, 0.90)
    not_qb = (pbp["qb_kneel"] != 1) & (pbp["qb_spike"] != 1)

    # --- 4th-down aggressiveness: gray-zone go rate ---
    m4 = (pbp["down"] == 4) & (pbp["ydstogo"] <= 2) & pbp["yardline_100"].between(28, 70) & comp & not_qb
    f4 = pbp[m4].copy()
    went = f4["play_type"].isin(["run", "pass"])
    kick = (f4["field_goal_attempt"] == 1) | (f4["punt_attempt"] == 1)
    f4 = f4[went | kick]
    f4["go"] = f4["play_type"].isin(["run", "pass"]).astype(int)
    agg = f4.groupby("coach")["go"].agg(go="sum", n="count")
    agg["go_rate"] = agg["go"] / agg["n"]
    lg_go = f4["go"].mean()

    # --- pass tendency (PROE): early downs, competitive ---
    med = (pbp["down"].isin([1, 2])) & pbp["xpass"].notna() & comp & not_qb
    ed = pbp[med]
    proe = ed.groupby("coach")["pass_oe"].agg(proe="mean", plays="count")

    tbl = agg.join(proe, how="outer")
    rated = tbl[tbl["n"] >= MIN_4TH]
    tbl["agg_pct"] = np.nan
    if len(rated):
        ranks = rated["go_rate"].rank(pct=True) * 100
        tbl.loc[ranks.index, "agg_pct"] = ranks

    # --- console summary ---
    print(f"league gray-zone 4th-down go rate: {100*lg_go:.1f}%   (n={int(agg['n'].sum())})")
    print(f"coaches rated on aggressiveness (>= {MIN_4TH} 4th downs): {int((tbl['n']>=MIN_4TH).sum())}")
    print(f"\n{'coach':<22}{'go%':>6}{'pct':>5}  {'agg label':<16}{'PROE':>7}  {'pass label':<12}{'4th n':>6}")
    show = tbl.sort_values("go_rate", ascending=False)
    for coach, r in show.iterrows():
        gr = f"{100*r['go_rate']:.0f}" if pd.notna(r["go_rate"]) else "-"
        pc = f"{r['agg_pct']:.0f}" if pd.notna(r["agg_pct"]) else "-"
        al = label_agg(r["agg_pct"]) if pd.notna(r["agg_pct"]) else "(low n)"
        pr = f"{r['proe']:+.1f}" if pd.notna(r["proe"]) else "-"
        pl = label_proe(r["proe"]) if pd.notna(r["proe"]) and r["plays"] >= MIN_ED else "(low n)"
        nn = int(r["n"]) if pd.notna(r["n"]) else 0
        print(f"{str(coach)[:21]:<22}{gr:>6}{pc:>5}  {al:<16}{pr:>7}  {pl:<12}{nn:>6}")

    # --- emit web/lib/coachTendencies.ts, keyed by CURRENT team ---
    def num(v):
        return None if (v is None or (isinstance(v, float) and np.isnan(v))) else round(float(v), 3)

    def prod(frame, coach, key):
        if coach not in frame.index:
            return None, None
        row = frame.loc[coach]
        if row["g"] < MIN_PROD_G:
            return None, int(row["g"])
        return round(float(row[key]), 1 if key == "pts" else 0), int(row["g"])

    entries = {}
    for team, coach in sorted(current.items()):
        yc, ycg = prod(yds_career, coach, "yds")
        yp, ypg = prod(yds_prior, coach, "yds")
        pc, _ = prod(pts_career, coach, "pts")
        pp, _ = prod(pts_prior, coach, "pts")
        e = {"team": team, "coach": coach}
        # production (the current card): yards/game + points/game, career & prior season
        e.update({
            "ydsCareer": yc, "ydsPrior": yp, "ptsCareer": pc, "ptsPrior": pp,
            "gCareer": ycg, "gPrior": ypg,
        })
        # aggressiveness / pass tendency kept in the data for later (not shown for now)
        r = tbl.loc[coach] if coach in tbl.index else None
        if r is not None and pd.notna(r.get("agg_pct")):
            e.update({
                "rated": True,
                "goRate": round(100 * r["go_rate"], 1),
                "goRateLg": round(100 * lg_go, 1),
                "aggPct": round(r["agg_pct"]),
                "aggLabel": label_agg(r["agg_pct"]),
                "fourthN": int(r["n"]),
                "proe": num(r["proe"]) if pd.notna(r.get("proe")) and r["plays"] >= MIN_ED else None,
                "proeLabel": label_proe(r["proe"]) if pd.notna(r.get("proe")) and r["plays"] >= MIN_ED else None,
            })
        else:
            e["rated"] = False
        entries[team] = e

    import json
    body = ",\n  ".join(f'"{t}": {json.dumps(e)}' for t, e in entries.items())
    ts = (
        "// AUTO-GENERATED by analysis/coach_tendencies.py — do not edit by hand.\n"
        "// Head-coach CONTEXT (not an edge), keyed by each team's current coach.\n"
        "// Shown now: production — offensive yards/game + points/game, career (2021-24, the\n"
        "// span of our play-by-play) and the prior season (2024). null = under a half-season\n"
        "// of games with us. Aggressiveness (gray-zone 4th-down go rate) + pass tendency (PROE)\n"
        "// are also carried for later use; `rated:false` = new coach / not enough history yet.\n"
        "export interface CoachTendency {\n"
        "  team: string; coach: string; rated: boolean;\n"
        "  ydsCareer?: number | null; ydsPrior?: number | null;\n"
        "  ptsCareer?: number | null; ptsPrior?: number | null;\n"
        "  gCareer?: number | null; gPrior?: number | null;\n"
        "  goRate?: number; goRateLg?: number; aggPct?: number; aggLabel?: string; fourthN?: number;\n"
        "  proe?: number | null; proeLabel?: string | null;\n"
        "}\n"
        f"export const LEAGUE_GO_RATE = {round(100*lg_go,1)};\n"
        "export const COACH_TENDENCIES: Record<string, CoachTendency> = {\n  "
        + body + ",\n};\n"
    )
    OUT.write_text(ts, encoding="utf-8")
    print(f"\nwrote {OUT}  ({len(entries)} teams)")


if __name__ == "__main__":
    main()
