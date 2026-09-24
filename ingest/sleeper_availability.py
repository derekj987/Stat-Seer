"""News-driven NFL availability -> Supabase, writing only what CHANGED.

The official injury report carries no designation before Friday and drops anyone moved to IR
entirely. Sleeper moves on the beat reporting instead, which is how it had Jaxson Dart "Out —
Knee - MCL, Surgery" and Caleb Williams "Doubtful — Hamstring" while our report had an undesignated
DNP and nothing at all. See ingest/sleeper_availability.sql for the full case.

Two things this does NOT do, on purpose:

  * It does not write a snapshot per run. A full snapshot every four hours is ~400k rows a season
    and this project has hit its storage limit once already. Only a new, changed, or cleared
    designation is written, which is on the order of a hundred rows a day.
  * It does not touch players outside QB/RB/WR/TE/K/FB. Sleeper carries ~14 designated players per
    team across the whole roster, mostly long-term IR that changes nothing this week. The skill
    positions are the ones whose absence moves a prop or a line; non-skill injuries keep coming
    from the official sources.

    python ingest/sleeper_availability.py              # dry run, prints the diff
    python ingest/sleeper_availability.py --write
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

import urllib.error
import urllib.request

SLEEPER_URL = "https://api.sleeper.app/v1/players/nfl"
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")

# Sleeper spells two clubs differently from nflverse, and still tags a few players OAK.
TEAM_ALIAS = {"LAR": "LA", "OAK": "LV"}
POSITIONS = {"QB", "RB", "WR", "TE", "K", "FB"}
# Statuses we record. "NA" is deliberately absent: Sleeper uses it for "no current information" and
# healthy starters carry it, so mapping it would put a designation on players with nothing wrong.
STATUSES = {"OUT", "IR", "PUP", "NFI", "DNR", "SUS", "DOUBTFUL", "QUESTIONABLE"}


def load_env(path=ENV_PATH):
    env = {}
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                name, _, value = line.partition("=")
                value = value.split("#", 1)[0].strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                env[name.strip()] = value
    for key, value in os.environ.items():
        if key in env or key.startswith("SUPABASE_"):
            env[key] = value
    return env


def ensure_ssl():
    if os.environ.get("SSL_CERT_FILE"):
        return
    try:
        import certifi
        os.environ["SSL_CERT_FILE"] = certifi.where()
    except Exception:  # noqa: BLE001
        pass


def norm(name: str) -> str:
    r"""Byte-for-byte the same as `normName` in web/lib/playerSlot.ts, the board's join key:

        (n || "").toLowerCase().replace(/[^a-z ]/g, "")
                 .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim()

    Note what it does NOT do: it never folds accents, it DELETES everything outside a-z. "José"
    becomes "jos", not "jose". The tidier Python spelling — NFKD, drop combining marks — produces
    "jose" and then simply never matches, and it does not raise: it quietly returns no availability
    for that player, so a broken key looks exactly like a quiet feed. Mirror the JS; if normName
    ever changes, change this with it, and let the self-check below catch the drift."""
    s = (name or "").lower()
    s = re.sub(r"[^a-z ]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


# Cases chosen to distinguish this from the obvious-but-wrong implementation — an accent-folding
# version fails "jos ramrez", a version that strips punctuation before a-z fails "aj brown".
# Checked on import, so drift surfaces on the cron's next run instead of as an empty board.
for _raw, _want in (("Michael Penix Jr.", "michael penix"), ("José Ramírez", "jos ramrez"),
                    ("A.J. Brown", "aj brown"), ("Ja'Marr Chase", "jamarr chase"),
                    ("Amon-Ra St. Brown", "amonra st brown")):
    assert norm(_raw) == _want, f"norm({_raw!r}) == {norm(_raw)!r}, expected {_want!r}"


def fetch_sleeper():
    ensure_ssl()
    req = urllib.request.Request(SLEEPER_URL, headers={"User-Agent": "statseer-avail/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def desired_state(all_players: dict) -> dict[str, dict]:
    """{player_key: row} for every skill player Sleeper currently designates."""
    out = {}
    for sid, p in all_players.items():
        if not p or not p.get("active") or not p.get("team") or not p.get("full_name"):
            continue
        if str(p.get("position") or "") not in POSITIONS:
            continue
        status = str(p.get("injury_status") or "").upper()
        if status not in STATUSES:
            continue
        team = TEAM_ALIAS.get(p["team"], p["team"])
        key = f"{norm(p['full_name'])}|{team}"
        news = p.get("news_updated")
        out[key] = {
            "player_key": key,
            "player": p["full_name"],
            "team": team,
            "pos": str(p["position"]),
            "status": status,
            "body_part": (p.get("injury_body_part") or None),
            "sleeper_id": str(sid),
            # Sleeper's gsis_id is populated on ~20% of players and some values carry leading
            # whitespace. Stored when present, never joined on.
            "gsis_id": (str(p.get("gsis_id")).strip() or None) if p.get("gsis_id") else None,
            "news_at": (
                __import__("datetime").datetime.fromtimestamp(
                    news / 1000, __import__("datetime").timezone.utc).isoformat()
                if isinstance(news, (int, float)) else None
            ),
        }
    return out


def sb(url, key, path, method="GET", body=None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}",
               "Content-Type": "application/json", "Range-Unit": "items"}
    if method == "GET":
        headers["Range"] = "0-9999"
    else:
        headers["Prefer"] = "return=minimal"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url.rstrip("/") + "/rest/v1/" + path, data=data,
                                 headers=headers, method=method)
    ensure_ssl()
    with urllib.request.urlopen(req, timeout=120) as r:
        if method != "GET":
            return None
        return json.loads(r.read().decode("utf-8", "replace"))


def current_state(url, key) -> dict[str, dict]:
    """What the table already believes, one row per player. Empty when the table is not created."""
    try:
        rows = sb(url, key, "sleeper_availability_current?select=player_key,player,team,pos,"
                            "status,body_part&limit=10000")
    except urllib.error.HTTPError as e:
        if e.code in (404, 406):
            print("  sleeper_availability_current not found — run ingest/sleeper_availability.sql "
                  "in the Supabase SQL editor first.", file=sys.stderr)
            return {}
        raise
    return {r["player_key"]: r for r in rows}


def diff(want: dict[str, dict], have: dict[str, dict]):
    """Rows to append: new designations, changed ones, and clearings.

    A clearing is a row with status NULL. It has to be written or the board would go on showing a
    player who has been activated — the bug this whole table exists to avoid, in reverse."""
    rows = []
    for k, w in want.items():
        h = have.get(k)
        if h is None or (h.get("status") or None) != w["status"] or \
                (h.get("body_part") or None) != w["body_part"]:
            rows.append(w)
    for k, h in have.items():
        if k in want or not h.get("status"):
            continue                      # already cleared, or still designated
        rows.append({"player_key": k, "player": h["player"], "team": h["team"], "pos": h["pos"],
                     "status": None, "body_part": None, "sleeper_id": "", "gsis_id": None,
                     "news_at": None})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="actually insert the changed rows")
    args = ap.parse_args()

    env = load_env()
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY missing", file=sys.stderr)
        return 1

    want = desired_state(fetch_sleeper())
    have = current_state(url, key)
    rows = diff(want, have)
    cleared = [r for r in rows if not r["status"]]
    print(f"sleeper: {len(want)} designated skill players | stored: {len(have)} | "
          f"changes: {len(rows)} ({len(cleared)} cleared)")
    for r in rows[:25]:
        was = (have.get(r["player_key"], {}) or {}).get("status") or "-"
        print(f"  {r['team']:4s} {r['player']:24s} {r['pos']:3s} {was:>12s} -> "
              f"{r['status'] or 'CLEAR'}  {r.get('body_part') or ''}")
    if len(rows) > 25:
        print(f"  ... {len(rows) - 25} more")

    if not args.write:
        print("\n(dry run — pass --write to insert)")
        return 0
    if not rows:
        print("nothing to write")
        return 0
    # Chunked so one oversized POST cannot fail the whole run.
    for i in range(0, len(rows), 500):
        sb(url, key, "sleeper_availability", method="POST", body=rows[i:i + 500])
    print(f"wrote {len(rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
