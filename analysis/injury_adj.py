"""
Injury adjustment for the game model — how many points a team loses to who is OUT.

Not an edge claim. This is a CORRECTION: a model that does not move when a starting quarterback is
ruled out produces a number that is knowably wrong, which is a different failure from failing to
beat the market. The standing rule in CLAUDE.md (a feature must beat the closing line to enter the
model) is about edges; this is about not publishing a number we already know is stale.

WHAT IS MEASURED, and how it is sized
-------------------------------------
For each team-week, the SHARE of that team's volume that is missing, per position group:

    QB -> pass attempts     RB -> carries     WR -> targets     TE -> targets

Share, not a headcount. The first cut of this used a binary "is a starter out", which treats a WR1
on a 28% target share the same as a WR2 on 15%, and it found nothing outside QB:

    binary spec   QB -3.59 (t -2.90)   RB -1.16 (t -0.99)   WR -1.09 (t -1.38)   TE +0.34 (t 0.31)

Weighting by the share of volume actually missing surfaces a real receiver effect the binary spec
had diluted away. Fitted on 2017-2022 (n=1567) against the model's own residual:

    share spec    QB -4.35 (t -2.94)   RB -2.25 (t -1.31)   WR -4.96 (t -2.24)   TE -1.45 (t -0.91)

Units are POINTS PER 100% OF THE GROUP'S VOLUME MISSING, so they scale with how much of a team is
actually gone:

    QB1 out, 95% of attempts   -> -4.14 pts
    WR1 out, 25% of targets    -> -1.24 pts
    RB1 out, 60% of carries    -> -1.35 pts
    TE1 out, 20% of targets    -> -0.29 pts

QB and WR are individually significant. RB and TE are NOT — they are the right sign and small, and
they are kept because they cost nothing (see below) and because the four-position spec does
slightly better on the games that matter most. That is a deliberate, stated choice, not a claim
that RB and TE are established.

DOES IT ACTUALLY HELP? Held out on 2023-2025, never fitted on:

    a QB1 is out         (n=70)   MAE 13.175 -> 12.311   -0.864
    a big WR absence     (n=190)  MAE 11.344 -> 11.217   -0.127
    any meaningful absence(n=527) MAE 10.990 -> 10.892   -0.099
    NOBODY out           (n=289)  MAE  9.048 ->  9.048   +0.000   <- no harm when it should do nothing

The season-by-season split is honest about the size of this: 2024 -0.228, but 2023 +0.008 and 2025
+0.029. Most of the aggregate gain is one season. What survives that is the shape above — it is
worth most of a point exactly where a starting QB is out, and it is inert when nobody is hurt. A
correction that does nothing on healthy teams cannot do much damage on them either.

The adjustment is ZERO whenever injury data is unavailable (preseason, or before a week's reports
are filed), so the model degrades to its uninjured self rather than to something arbitrary.
"""
import os
import sys
import urllib.request

import numpy as np
import pandas as pd

# Points per 100% of a position group's volume missing. Fitted on 2017-2022; see the docstring.
COEF = {"QB": -4.35, "RB": -2.25, "WR": -4.96, "TE": -1.45}
# Which volume defines "share of the team" for each group.
VOLUME = {"QB": "attempts", "RB": "carries", "WR": "targets", "TE": "targets"}
# A player carrying this little of his group's volume cannot move a game; ignoring him keeps the
# adjustment from accumulating rounding noise across a long inactive list.
MIN_SHARE = 0.02

INJ_URL = "https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_%d.csv"
ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_%d.csv"

# Every path here is anchored to the REPO, not to the working directory. game_model.py is written
# to run from analysis/ (its default games path is ../data/games.csv) while this module used plain
# "data/..." -- so invoked that way it found no injuries, no usage, and returned {} for every team.
# The model then predicted unadjusted and said so nowhere: the correction silently switched itself
# off depending on which directory you happened to be in. A relative path in a module that other
# modules import is a bug waiting for a different caller.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROSTER_LOCAL = os.path.join(_ROOT, "data", "roster_%d.csv")
# The season the news feed is allowed to apply to; older weeks stay on the official report.
CUR_SEASON = 2026
INJ_LOCAL = os.path.join(_ROOT, "data", "inj_%d.csv")
# "Doubtful" is included: historically it plays like Out far more often than like Questionable.
OUT_STATUS = ("Out", "Doubtful")


def load_injuries(season, refresh=False):
    """Injury report for a season, or None when it does not exist yet.

    Returns None rather than raising: a preseason run, or a week before reports are filed, is a
    normal state and must leave the model unadjusted rather than fail."""
    path = INJ_LOCAL % season
    if refresh or not os.path.exists(path):
        try:
            import odds_client as oc
            oc.ensure_ssl_certs()
            data = urllib.request.urlopen(INJ_URL % season, timeout=120).read()
            os.makedirs(os.path.join(_ROOT, "data"), exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
        except Exception:                       # noqa: BLE001 — absence is a valid state
            if not os.path.exists(path):
                return None
    try:
        d = pd.read_csv(path, low_memory=False)
    except Exception:                           # noqa: BLE001
        return None
    if "game_type" in d.columns:
        d = d[d.game_type == "REG"]
    d = d[d.report_status.isin(OUT_STATUS)]
    d["gsis_id"] = d.gsis_id.astype(str)
    return d


def load_usage(seasons):
    """Per-player per-week volume, for computing share of a team's workload."""
    frames = []
    for y in seasons:
        p = os.path.join(_ROOT, "data", f"stats_{y}.csv")
        if not os.path.exists(p):
            continue
        s = pd.read_csv(p, low_memory=False)
        s = s[s.season_type == "REG"].copy()
        if "team" not in s.columns and "recent_team" in s.columns:
            s["team"] = s["recent_team"]
        for c in ("attempts", "carries", "targets"):
            s[c] = pd.to_numeric(s.get(c), errors="coerce").fillna(0.0)
        frames.append(s[["player_id", "position", "team", "season", "week",
                         "attempts", "carries", "targets"]])
    if not frames:
        return None
    u = pd.concat(frames, ignore_index=True)
    u["player_id"] = u.player_id.astype(str)
    return u


# How many games of evidence the PRIOR season is worth when working out a player's share of his
# team's volume. This exists because of a silent failure Derek walked into: the share used to come
# from current-season games only, so a starter who had been out since the opener had no volume,
# therefore no share, therefore NO ADJUSTMENT AT ALL. Atlanta, without Michael Penix Jr:
#
#     week 1   QB shares: Penix 0.51, Cousins 0.49        -> adjustment -2.20   (fires)
#     week 2   QB shares: Cooper Rush 1.00                -> adjustment  0.00   (silent)
#
# The longer a starter was out, the more completely the model forgot he existed, and it is the long
# absences that move a line. Blending the prior season in keeps him on the books.
#
# Be straight about what this buys: NOTHING MEASURABLE. Swept 0/2/4/6/10 on train 2017-22 and
# held-out 2023-25 (analysis/share_prior_sweep.py), every value lands within 0.05% of every other —
# train drifts slightly worse as K rises, held-out slightly better, which is two readings of noise.
# In three held-out seasons exactly ONE game is the forgotten-starter case, because a player who is
# out long enough usually goes to injured reserve and drops off the injury report altogether, at
# which point neither version can see him.
#
# It is kept anyway, on the same footing as the rest of this file: a correction, not an edge. The
# current behaviour is indefensible on inspection — a model that silently stops accounting for a
# quarterback the longer he is hurt is publishing a number we know is wrong — and the measurement
# says fixing it costs nothing.
SHARE_PRIOR_K = 4.0


def _shares(u, season, week):
    """{(team, pos): {player_id: share}} from games BEFORE `week` — no look-ahead.

    The prior season is folded in at SHARE_PRIOR_K games so that a player with no current-season
    volume keeps a share rather than vanishing. Week 1 has no current-season games at all, so it is
    the prior season alone, which is what was knowable at the time."""
    hist = u[(u.season == season) & (u.week < week)]
    prev = u[u.season == season - 1]
    if hist.empty:
        hist, prev = prev, prev.iloc[0:0]
    prev_games = max(int(prev.week.nunique()), 1) if len(prev) else 1
    out = {}
    for pos, col in VOLUME.items():
        sub = hist[hist.position == pos]
        pre = prev[prev.position == pos] if len(prev) else prev
        if sub.empty and (pre is None or pre.empty):
            continue
        tot = sub.groupby(["team", "player_id"], as_index=False)[col].sum() if not sub.empty             else pd.DataFrame(columns=["team", "player_id", col])
        if pre is not None and not pre.empty and SHARE_PRIOR_K > 0:
            pv = pre.groupby(["team", "player_id"], as_index=False)[col].sum().rename(
                columns={col: "prev"})
            # Carry a player on the team he is on NOW where we have one; a player who has not
            # taken a snap this season can only be placed by last season's team.
            cur_team = dict(zip(tot.player_id, tot.team)) if len(tot) else {}
            pv["team"] = [cur_team.get(pid, tm) for pid, tm in zip(pv.player_id, pv.team)]
            tot = pd.merge(tot, pv[["team", "player_id", "prev"]],
                           on=["team", "player_id"], how="outer")
            tot[col] = pd.to_numeric(tot.get(col), errors="coerce").fillna(0.0)
            tot["prev"] = pd.to_numeric(tot.get("prev"), errors="coerce").fillna(0.0)
            tot[col] = tot[col] + SHARE_PRIOR_K * (tot["prev"] / prev_games)
        if tot.empty:
            continue
        team_tot = tot.groupby("team")[col].transform("sum")
        tot["share"] = np.where(team_tot > 0, tot[col] / team_tot, 0.0)
        for team, grp in tot.groupby("team"):
            out[(team, pos)] = dict(zip(grp.player_id, grp.share))
    return out


_USAGE_CACHE = {}
_INJ_CACHE = {}


def _usage_for(season):
    """Cached usage frame. Without this, team_adjustment re-read every stats CSV on EVERY call —
    and model_win_curve asks for one adjustment per week per training season, so a single model run
    re-parsed ~175k rows a couple of hundred times."""
    if season not in _USAGE_CACHE:
        _USAGE_CACHE[season] = load_usage(range(season - 1, season + 1))
    return _USAGE_CACHE[season]


def _inj_for(season):
    if season not in _INJ_CACHE:
        _INJ_CACHE[season] = load_injuries(season)
    return _INJ_CACHE[season]


_SHARE_CACHE = {}


# ---- The news feed, for the absences the official report cannot express --------------------
#
# Derek, looking at the homepage spotlight: "Jaxson Dart is now out for the season and Jameis
# Winston is the new QB. Has this been updated in our model analysis? Or do we feel that NYG will
# not only cover the market's -2.5 but as much as -6?"
#
# It had not been. Dart is on injured reserve, and a player on IR drops OFF the weekly injury
# report entirely -- he is no longer on the active roster, so there is nothing to designate. The
# report had no NYG quarterback on it at all and this function returned +0.00 for New York: the
# model was pricing them as though nothing had happened, and publishing a number well clear of the
# market on the strength of it.
#
# `sleeper_availability` (written by capture-sleeper.yml) already knew. It is the same source that
# put Dart on the injury board hours before the league's own report would have, and it carries IR.
# Joining it here closes the loop between what the board SHOWS a reader and what the model USES.
#
# Names are mapped to gsis ids through the season roster, because the shares below are keyed on
# gsis and Sleeper's own gsis field is populated on only a fifth of players. Verified 8 of 8 on the
# quarterbacks it currently lists as unavailable.
_NEWS_CACHE = {}
# DOUBTFUL belongs here, and its absence cost us Chicago.
#
# Derek: "Bears winning without their starting QBs." Caleb Williams holds 94.8% of Chicago's pass
# attempts and the news feed had him DOUBTFUL; the league's own week-3 report had no CHI
# designation at all. This set excluded DOUBTFUL, so the model subtracted exactly nothing and
# published the Bears as though their quarterback were fine.
#
# It was also internally inconsistent: the OFFICIAL report path a hundred lines up has always used
# OUT_STATUS = ("Out", "Doubtful"), and daily_digest.py counts DOUBTFUL too. Only this path
# disagreed, so whether a doubtful starter moved the number depended on which feed happened to
# carry him first.
#
# Measured before changing it, on the 7,093 designations given to touch-taking players 2016-2026
# (players with 3+ touch weeks that season -- scoring linemen and defenders by whether they
# recorded a carry rates every one of them absent and puts Questionable at a nonsense 83%):
#
#     Out            n=2,674   100.0% did not play
#     Doubtful       n=  468    99.1% did not play
#     Questionable   n=3,951    39.9% did not play
#
# Doubtful is Out. Questionable stays out of this set for the same reason it always has -- it is a
# game-time decision that plays 60% of the time, and alerting on it would fire on half the league.
NEWS_OUT = {"OUT", "IR", "PUP", "NFI", "DNR", "SUS", "DOUBTFUL"}


def _news_out(season):
    """{team: {gsis_id}} the news feed says will not play. {} on any failure -- this is an
    enhancement to the official report, never a replacement for it."""
    if season in _NEWS_CACHE:
        return _NEWS_CACHE[season]
    out = {}
    try:
        import json as _json
        import urllib.request as _url
        import re as _re
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sys.path.insert(0, os.path.join(here, "ingest"))
        import injuries_nflverse as _inj
        env = _inj.load_env()
        base, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
        if not base or not key:
            _NEWS_CACHE[season] = {}
            return {}
        req = _url.Request(
            base.rstrip("/") + "/rest/v1/sleeper_availability_current"
            "?select=player,team,status&status=not.is.null&limit=2000",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Range": "0-1999"})
        rows = _json.load(_url.urlopen(req, timeout=60))

        def _n(x):
            y = _re.sub(r"[^a-z ]", "", str(x).lower())
            y = _re.sub(r"(jr|sr|ii|iii|iv|v)", "", y)
            return _re.sub(r"\s+", " ", y).strip()

        ros = pd.read_csv(ROSTER_LOCAL % season, low_memory=False)             if os.path.exists(ROSTER_LOCAL % season) else None
        if ros is None:
            import odds_client as oc
            oc.ensure_ssl_certs()
            data = _url.urlopen(ROSTER_URL % season, timeout=120).read()
            os.makedirs(os.path.join(_ROOT, "data"), exist_ok=True)
            open(ROSTER_LOCAL % season, "wb").write(data)
            ros = pd.read_csv(ROSTER_LOCAL % season, low_memory=False)
        gsis = {(_n(r.full_name), str(r.team)): str(r.gsis_id)
                for _, r in ros.iterrows() if pd.notna(r.get("gsis_id"))}
        for x in rows:
            if str(x.get("status") or "").upper() not in NEWS_OUT:
                continue
            g = gsis.get((_n(x.get("player")), str(x.get("team"))))
            if g:
                out.setdefault(str(x["team"]), set()).add(g)
    except Exception:  # noqa: BLE001 — never let the enhancement break the model
        out = {}
    _NEWS_CACHE[season] = out
    return out


def team_adjustment(season, week, u=None, inj=None):
    """{team: points} to ADD to that team's predicted margin. Negative = weakened by absences.

    Empty dict when injury or usage data is missing — the caller then predicts unadjusted."""
    if inj is None:
        inj = _inj_for(season)
    if inj is None or not len(inj):
        return {}
    if u is None:
        u = _usage_for(season)
    if u is None or not len(u):
        return {}
    ck = (season, week, id(u))
    if ck not in _SHARE_CACHE:
        _SHARE_CACHE[ck] = _shares(u, season, week)
    sh = _SHARE_CACHE[ck]
    wk = inj[inj.week == week]
    out_by_team = {str(t): set(g.gsis_id) for t, g in wk.groupby("team")}
    # The news feed is merged ONLY for the live week of the current season. Applying today's IR
    # list to a 2021 backtest would be a look-ahead, and the whole point of the historical path is
    # that it only knows what was knowable then.
    live_week = int(pd.to_numeric(inj.week, errors="coerce").max() or 0)
    if season >= CUR_SEASON and week >= live_week:
        for team, ids in _news_out(season).items():
            out_by_team.setdefault(team, set()).update(ids)
    adj = {}
    for team, ids in out_by_team.items():
        pts = 0.0
        for pos, coef in COEF.items():
            missing = sum(v for k, v in sh.get((team, pos), {}).items()
                          if k in ids and v >= MIN_SHARE)
            pts += coef * missing
        if pts:
            adj[team] = round(pts, 2)
    return adj


def describe(season, week, adj=None):
    """One line per affected team — for the publisher's log, so an adjustment is never silent."""
    adj = team_adjustment(season, week) if adj is None else adj
    if not adj:
        return f"  injury adjustment: none available for {season} week {week}"
    worst = sorted(adj.items(), key=lambda kv: kv[1])[:6]
    return ("  injury adjustment: %d teams affected; largest " % len(adj)
            + ", ".join(f"{t} {p:+.1f}" for t, p in worst))
