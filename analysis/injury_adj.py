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
INJ_LOCAL = "data/inj_%d.csv"
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
            os.makedirs("data", exist_ok=True)
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
        p = f"data/stats_{y}.csv"
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
    adj = {}
    for team, grp in wk.groupby("team"):
        ids = set(grp.gsis_id)
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
