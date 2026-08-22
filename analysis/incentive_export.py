"""
incentive_export.py -- surface players who are CLOSE to hitting a contract incentive,
for the Special Considerations cards. Writes web/lib/incentiveWatch.ts.

Why this shape: contract incentives (e.g. "$500K at 1,000 rushing yards") are NOT in any
free feed -- nflverse doesn't carry them; Spotrac / OverTheCap are the public sources. So
the incentive LIST below is hand-curated (like web/lib/irList.ts). This script joins that
list with the player's live season production (nflverse weekly stats) and emits ONLY the
players within CLOSE_FRAC of their threshold but not yet over it -- so a card shows the
incentive as live context ("48 yards from a bonus"), never as trivia.

Preseason / pre-Week-1: the season stats file is empty or absent, so nobody is "close" and
the watch list is empty. It fills in as the season runs.

    python analysis/incentive_export.py            # build web/lib/incentiveWatch.ts

Populate INCENTIVES from a reliable source, one row per statistical incentive. Reads
nflverse (public, no key). Stdlib only (+ certifi for TLS).
"""
import csv
import io
import os
import re
import sys
import urllib.error
import urllib.request

try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except Exception:
    pass

SEASON = int(os.environ.get("SEASON", "2026"))
STATS_URL = ("https://github.com/nflverse/nflverse-data/releases/download/"
             "stats_player/stats_player_week_{season}.csv")
OUT = os.path.join("web", "lib", "incentiveWatch.ts")
UA = {"User-Agent": "statseer-incentives/1.0"}

# Show the incentive on a card once the player is at least this far toward it (and not yet
# over). 0.80 = "within the last 20%". Counting stats (TDs/receptions) also use a small
# absolute window so "2 TDs from 10" surfaces even early.
CLOSE_FRAC = 0.80
CLOSE_COUNT = 3   # for counting stats, also show when this many or fewer remain

# our stat key -> (nflverse weekly-stats column, human unit, is it a counting stat?)
STAT = {
    "rush_yds":  ("rushing_yards",   "rushing yards",   False),
    "rec_yds":   ("receiving_yards", "receiving yards", False),
    "pass_yds":  ("passing_yards",   "passing yards",   False),
    "receptions":("receptions",      "receptions",      True),
    "rush_tds":  ("rushing_tds",     "rushing TDs",     True),
    "rec_tds":   ("receiving_tds",   "receiving TDs",   True),
    "pass_tds":  ("passing_tds",     "passing TDs",     True),
    "sacks":     ("sacks",           "sacks",           True),
    "ints":      ("interceptions",   "interceptions",   True),
}

# ---------------------------------------------------------------------------
# HAND-CURATED contract incentives. One row per statistical incentive.
#   player    : player name (matched loosely to nflverse names)
#   team      : nflverse abbreviation (LA, KC, ...), for mapping onto the game card
#   stat      : a key from STAT above
#   threshold : the number that triggers the incentive
#   label     : short human description shown on the card
# Source these from Spotrac / OverTheCap. EMPTY until populated -- the watch list is then
# empty and nothing shows (honest), which is correct in the preseason anyway.
# Example shape (commented):
#   {"player": "Player Name", "team": "XXX", "stat": "rush_yds", "threshold": 1000,
#    "label": "$500K at 1,000 rushing yards"},
INCENTIVES = [
]


def norm(n: str) -> str:
    n = (n or "").lower()
    n = re.sub(r"[^a-z ]", "", n)
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", n)
    return re.sub(r"\s+", " ", n).strip()


def fetch_stats(season):
    req = urllib.request.Request(STATS_URL.format(season=season), headers=UA)
    with urllib.request.urlopen(req, timeout=90) as r:
        return list(csv.DictReader(io.StringIO(r.read().decode("utf-8", "replace"))))


def season_totals(rows):
    """(normalized name) -> {column -> season total} across all weeks played."""
    totals = {}
    for r in rows:
        name = norm(r.get("player_display_name") or r.get("player_name") or "")
        if not name:
            continue
        d = totals.setdefault(name, {})
        for _, (col, _u, _c) in STAT.items():
            v = r.get(col)
            if v not in (None, "", "NA"):
                try:
                    d[col] = d.get(col, 0.0) + float(v)
                except ValueError:
                    pass
    return totals


def main():
    watch = []
    if INCENTIVES:
        try:
            rows = fetch_stats(SEASON)
            totals = season_totals(rows)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                totals = {}   # stats not published yet (pre-Week-1) -> nobody is close
            else:
                raise
        for inc in INCENTIVES:
            key = inc["stat"]
            if key not in STAT:
                print(f"  skip {inc.get('player')}: unknown stat {key}", file=sys.stderr)
                continue
            col, unit, counting = STAT[key]
            thr = float(inc["threshold"])
            cur = totals.get(norm(inc["player"]), {}).get(col, 0.0)
            if thr <= 0 or cur >= thr:
                continue   # already hit (locked in) or bad threshold -> not "getting close"
            remaining = thr - cur
            close = (cur >= CLOSE_FRAC * thr) or (counting and remaining <= CLOSE_COUNT)
            if not close:
                continue
            watch.append({
                "player": inc["player"], "team": inc["team"].upper(),
                "stat": unit, "label": inc["label"],
                "current": round(cur, 1), "threshold": round(thr, 1),
                "remaining": round(remaining, 1),
                "pct": round(100.0 * cur / thr),
            })
        watch.sort(key=lambda w: -w["pct"])

    body = [
        "// AUTO-GENERATED by analysis/incentive_export.py — do not edit by hand.",
        "// Players CLOSE to a contract incentive (hand-curated list x live season stats).",
        "// Shown on Special Considerations cards as live context; empty until players near one.",
        "export interface IncentiveWatch { player: string; team: string; stat: string;",
        "  label: string; current: number; threshold: number; remaining: number; pct: number }",
        f"export const INCENTIVE_SEASON = {SEASON};",
        "export const INCENTIVE_WATCH: IncentiveWatch[] = [",
    ]
    for w in watch:
        body.append("  " + _ts(w) + ",")
    body.append("];")
    body.append("")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(body))
    print(f"wrote {len(watch)} player(s) close to an incentive -> {OUT} "
          f"({len(INCENTIVES)} incentives curated)")
    return 0


def _ts(w):
    return ("{ player: %r, team: %r, stat: %r, label: %r, current: %s, threshold: %s, "
            "remaining: %s, pct: %s }" % (w["player"], w["team"], w["stat"], w["label"],
            w["current"], w["threshold"], w["remaining"], w["pct"])).replace("'", '"')


if __name__ == "__main__":
    sys.exit(main())
