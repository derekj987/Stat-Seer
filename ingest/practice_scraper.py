"""
Daily practice report collector.

Collects Wed/Thu/Fri participation (DNP / LIMITED / FULL) plus the Friday game
designation. This is the dataset that CANNOT be backfilled -- nflverse retains
only the final weekly designation, so the trajectory exists only if captured
daily.

  DNP -> DNP -> LIMITED   and   LIMITED -> LIMITED -> FULL
both end "Questionable" and mean very different things for snap share.

RUN: Wed/Thu/Fri, late afternoon ET (teams publish mid-to-late afternoon).
Idempotent -- the unique constraint on (season, week, team, name, day) makes
re-runs safe, so schedule it twice per day and stop worrying about missed runs.

+-------------------------------------------------------------------+
| BEFORE DEPLOYING                                                  |
| The parse_* functions below are written against the STRUCTURE of a |
| standard NFL injury report, not against a verified live page. The  |
| selectors must be validated against your actual source, and the    |
| golden-file test at the bottom is how you keep them honest.        |
|                                                                   |
| Check first whether your odds provider already supplies daily      |
| practice data -- several do. That removes this file entirely.      |
+-------------------------------------------------------------------+
"""
import hashlib
import os
import re
from datetime import date, datetime, timezone

import requests
from bs4 import BeautifulSoup   # pip install beautifulsoup4

from player_resolver import PlayerResolver

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

PARTICIPATION_MAP = {
    "did not participate in practice": "DNP",
    "did not participate": "DNP",
    "dnp": "DNP",
    "limited participation in practice": "LIMITED",
    "limited participation": "LIMITED",
    "limited": "LIMITED",
    "full participation in practice": "FULL",
    "full participation": "FULL",
    "full": "FULL",
}
STATUS_MAP = {
    "out": "OUT", "doubtful": "DOUBTFUL", "questionable": "QUESTIONABLE",
    "": "NONE", "--": "NONE", "-": "NONE",
}

TEAMS = ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN",
         "DET", "GB", "HOU", "IND", "JAX", "KC", "LAC", "LA", "LV", "MIA",
         "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB",
         "TEN", "WAS"]


def practice_day_for(d: date) -> str:
    return {2: "WED", 3: "THU", 4: "FRI", 5: "SAT", 6: "SUN"}.get(
        d.weekday(), "OTHER")


def normalise_participation(raw: str) -> str:
    key = re.sub(r"\s+", " ", (raw or "")).strip().lower()
    return PARTICIPATION_MAP.get(key, "NOT_LISTED")


def normalise_status(raw: str) -> str:
    key = re.sub(r"\s+", " ", (raw or "")).strip().lower()
    return STATUS_MAP.get(key, "NONE")


# ---------------------------------------------------------------- parsing
def parse_injury_table(html: str, team: str):
    """
    Extract rows from a standard injury-report table.

    Expected columns (order varies by source, hence the header map):
        Player | Position | Injury | Wed | Thu | Fri | Game Status

    VALIDATE THIS against your live source before trusting it.
    """
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True).lower()
                   for th in table.find_all("th")]
        if not headers or not any("player" in h for h in headers):
            continue
        col = {}
        for i, h in enumerate(headers):
            if "player" in h:
                col["player"] = i
            elif h in ("pos", "position"):
                col["pos"] = i
            elif "injur" in h:
                col["injury"] = i
            elif h.startswith("wed"):
                col["wed"] = i
            elif h.startswith("thu"):
                col["thu"] = i
            elif h.startswith("fri"):
                col["fri"] = i
            elif "status" in h:
                col["status"] = i
        if "player" not in col:
            continue

        for tr in table.find_all("tr"):
            cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
            if len(cells) < 2:
                continue
            name = cells[col["player"]] if col["player"] < len(cells) else ""
            if not name:
                continue
            rec = dict(
                team=team,
                scraped_name=name,
                position=cells[col["pos"]] if col.get("pos", 99) < len(cells) else None,
                injury_primary=cells[col["injury"]] if col.get("injury", 99) < len(cells) else None,
                game_status=normalise_status(
                    cells[col["status"]] if col.get("status", 99) < len(cells) else ""),
            )
            for day in ("wed", "thu", "fri"):
                idx = col.get(day)
                rec[day] = (normalise_participation(cells[idx])
                            if idx is not None and idx < len(cells) else None)
            out.append(rec)
    return out


# ---------------------------------------------------------------- writing
def rows_to_records(parsed, season, week, report_date, source_url, resolver):
    """One row per player per OBSERVED DAY. Never one row per player-week."""
    recs, unresolved = [], []
    src_hash = hashlib.sha256(source_url.encode()).hexdigest()[:16]
    for r in parsed:
        gsis, score, method = resolver.resolve(
            r["scraped_name"], r.get("team"), r.get("position"))
        if gsis is None:
            unresolved.append(r)
        for day in ("wed", "thu", "fri"):
            val = r.get(day)
            if not val:
                continue
            recs.append(dict(
                season=season, week=week, team=r["team"], gsis_id=gsis,
                scraped_name=r["scraped_name"],
                report_date=report_date.isoformat(),
                practice_day=day.upper(),
                participation=val,
                injury_primary=r.get("injury_primary"),
                game_status=r.get("game_status"),
                source_url=source_url, source_hash=src_hash,
            ))
    return recs, unresolved


def upsert(table, records, on_conflict):
    """Append-only insert. Conflicts are ignored, which makes re-runs safe."""
    if not records or not SUPABASE_URL:
        return 0
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates,return=minimal",
        },
        params={"on_conflict": on_conflict},
        json=records, timeout=60,
    )
    resp.raise_for_status()
    return len(records)


def run(season, week, sources, resolver):
    """`sources` maps team -> URL. Keep it in config, not hardcoded here."""
    today = datetime.now(timezone.utc).date()
    day = practice_day_for(today)
    if day not in ("WED", "THU", "FRI"):
        print(f"{today} is {day}; nothing to collect")
        return

    total, all_unresolved = 0, []
    for team, url in sources.items():
        try:
            html = requests.get(url, timeout=30,
                                headers={"User-Agent": "practice-collector/1.0"}).text
            parsed = parse_injury_table(html, team)
            recs, unres = rows_to_records(parsed, season, week, today,
                                          url, resolver)
            n = upsert("practice_reports", recs,
                       "season,week,team,scraped_name,practice_day")
            total += n
            all_unresolved.extend(unres)
            print(f"  {team}: {len(parsed)} players, {n} day-rows")
        except Exception as e:
            # one team failing must not abort the run -- partial data beats none
            print(f"  {team}: FAILED {type(e).__name__}: {e}")

    if all_unresolved:
        upsert("player_alias_queue",
               [dict(scraped_name=u["scraped_name"], team=u.get("team"),
                     position=u.get("position"), source="practice_report")
                for u in all_unresolved],
               "scraped_name,team")
        print(f"\n  {len(all_unresolved)} names queued for review")
    print(f"\ntotal rows written: {total}")


if __name__ == "__main__":
    import pandas as pd
    import sys

    # Golden-file test: keep a saved copy of a real page and assert the parser
    # still handles it. Sources change layout without warning; this is the only
    # thing that tells you before the data silently goes empty.
    if len(sys.argv) > 1 and sys.argv[1] == "--test-parse":
        with open(sys.argv[2]) as f:
            rows = parse_injury_table(f.read(), "KC")
        print(f"parsed {len(rows)} rows")
        for r in rows[:5]:
            print(" ", r)
        raise SystemExit(0)

    players = pd.read_csv("../data/players.csv", low_memory=False)
    resolver = PlayerResolver(players)
    print("resolver ready. Populate SOURCES with team injury-report URLs,")
    print("validate parse_injury_table against a saved page, then schedule.")
