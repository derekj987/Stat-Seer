"""Which week should the report card grade?

The most recently COMPLETED week — every game final — not "the current week". Grading a week with
games still to play locks a short denominator into reportCards.ts, and that file is append-merged
by sport+season+week, so a half-graded week sits there until someone notices and regenerates it.

Writes `nfl=` and `ncaaf=` to $GITHUB_OUTPUT. An empty value means "nothing complete to grade",
which the workflow treats as a clean no-op rather than an error — the first Tuesday of the season
and the weeks after it ends are both legitimately empty.

A manual run can force the NFL week with the `week` input (WEEK_IN); NCAAF still resolves itself,
because the two sports do not share a week numbering in practice.
"""
import os
import sys

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SEASON = 2026


def last_complete_nfl():
    path = os.path.join(ROOT, "data", "games.csv")
    if not os.path.exists(path):
        print("no data/games.csv — cannot resolve a week", file=sys.stderr)
        return ""
    g = pd.read_csv(path, low_memory=False)
    g = g[(g.season == SEASON) & (g.game_type == "REG")]
    if not len(g):
        return ""
    done = []
    for wk, grp in g.groupby("week"):
        # EVERY game final, not most of them. A week with one game outstanding is not gradeable:
        # the Monday-night result is exactly the one a Tuesday job exists to wait for.
        if grp.home_score.notna().all():
            done.append(int(wk))
    return str(max(done)) if done else ""


def last_complete_ncaaf(nfl_week):
    """College has no equivalent schedule file here, and its weeks run a week ahead of the NFL's in
    this project's numbering. Grade the week before the NFL's, which is complete by Tuesday, and
    let the job's continue-on-error absorb a miss rather than guessing harder."""
    if not nfl_week:
        return ""
    return str(int(nfl_week) + 1)


def main():
    forced = (os.environ.get("WEEK_IN") or "").strip()
    nfl = forced or last_complete_nfl()
    ncaaf = last_complete_ncaaf(nfl)
    print(f"nfl week to grade:   {nfl or '(none complete)'}")
    print(f"ncaaf week to grade: {ncaaf or '(none)'}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"nfl={nfl}\n")
            fh.write(f"ncaaf={ncaaf}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
