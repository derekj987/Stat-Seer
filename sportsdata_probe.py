"""
sportsdata_probe.py

Verify the SportsDataIO NFL Injuries feed BEFORE building a client against it.
Two questions to answer:
  1. Which endpoint path actually works on the trial key?
  2. Does the injury record carry the daily practice field (Practice /
     PracticeDescription) plus a player name we can resolve to gsis_id?

Tries several candidate paths for a completed week (real injury data), prints
status + the first record's fields, and saves the first 200 body to
fixtures/sportsdata_injuries_raw.json.

    python sportsdata_probe.py                # default 2024REG week 10
    python sportsdata_probe.py 2024REG 10
    python sportsdata_probe.py 2025REG 1

Reads SPORTSDATA_API_KEY from .env. Stdlib only (+ certifi via odds_client).
"""
import json
import os
import sys
import urllib.error
import urllib.request

import odds_client as oc  # reuse load_env() + ensure_ssl_certs()

# Candidate paths — SportsDataIO groups endpoints under feed segments and the
# Injuries route has lived under a few. Probe them; keep the first that returns 200.
CANDIDATES = [
    "https://api.sportsdata.io/v3/nfl/scores/json/Injuries/{sw}",
    "https://api.sportsdata.io/v3/nfl/stats/json/Injuries/{sw}",
    "https://api.sportsdata.io/v3/nfl/projections/json/Injuries/{sw}",
    "https://api.sportsdata.io/v3/nfl/scores/json/InjuriesByWeek/{sw}",
]
FIXTURE = os.path.join("fixtures", "sportsdata_injuries_raw.json")
PRACTICE_FIELDS = ("Practice", "PracticeDescription", "Status", "DeclaredInactive")
ID_FIELDS = ("Name", "PlayerID", "GsisPlayerID", "Position", "Team")


def get(url, key):
    req = urllib.request.Request(url + f"?key={key}",
                                 headers={"User-Agent": "nfl-advice-app/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.getcode(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        return None, str(e).encode()


def main():
    season = sys.argv[1] if len(sys.argv) > 1 else "2024REG"
    week = sys.argv[2] if len(sys.argv) > 2 else "10"
    sw = f"{season}/{week}"

    key = oc.load_env().get("SPORTSDATA_API_KEY")
    if not key:
        print("ERROR: SPORTSDATA_API_KEY missing in .env", file=sys.stderr)
        return 1
    oc.ensure_ssl_certs()

    print(f"Probing NFL Injuries for {sw}\n")
    winner = None
    for tmpl in CANDIDATES:
        url = tmpl.format(sw=sw)
        status, body = get(url, key)
        note = ""
        if status == 200:
            try:
                data = json.loads(body)
                note = f"{len(data)} records" if isinstance(data, list) else "non-list body"
            except Exception:
                note = "200 but unparseable"
            if winner is None and status == 200:
                winner = (url, body)
        else:
            note = body[:120].decode("utf-8", "replace")
        print(f"  [{status}] {tmpl.split('/json/')[-1]:<22} {note}")

    if not winner:
        print("\nNo endpoint returned 200. If these are 401/403, the trial may "
              "not include the Injuries scope, or the season/week is out of trial "
              "range. Try a different season/week, or check the subscription.")
        return 1

    url, body = winner
    data = json.loads(body)
    print(f"\nWORKING ENDPOINT: {url.split('?')[0]}")
    print(f"records: {len(data)}")

    if data:
        rec = data[0]
        keys = set(rec.keys())
        print(f"\nfields present ({len(keys)}):")
        print("  practice/status:")
        for f in PRACTICE_FIELDS:
            print(f"    {'YES' if f in keys else ' - '}  {f}"
                  + (f" = {rec.get(f)!r}" if f in keys else ""))
        print("  identity:")
        for f in ID_FIELDS:
            print(f"    {'YES' if f in keys else ' - '}  {f}"
                  + (f" = {rec.get(f)!r}" if f in keys else ""))
        print("\n  full sample record:")
        print("   ", json.dumps(rec, indent=2)[:900])

    os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
    with open(FIXTURE, "wb") as fh:
        fh.write(body)
    print(f"\nsaved raw body to {FIXTURE} ({len(body)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
