"""
Probe The Odds API player-props for NFL: availability, structure, and credit cost.

Player props are per-EVENT on the v4 API (/events/{id}/odds), and cost markets x
regions per call — pricier than the flat game-line endpoint. Books also post props
late (often game week), so this checks whether they exist yet at all.

    python props_probe.py            # nearest event, a few common prop markets

Reads ODDS_API_KEY from .env. Saves the raw props body to fixtures/props_event_raw.json.
"""
import json
import os
import sys
import urllib.error
import urllib.request

import odds_client as oc  # reuse load_env + ensure_ssl_certs

BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl"
MARKETS = "player_pass_yds,player_rush_yds,player_reception_yds,player_anytime_td"
FIXTURE = os.path.join("fixtures", "props_event_raw.json")


def get(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "statseer/1.0"}), timeout=45)
        return r.getcode(), r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def main():
    key = oc.load_env().get("ODDS_API_KEY")
    if not key:
        print("ERROR: ODDS_API_KEY missing in .env", file=sys.stderr)
        return 1
    oc.ensure_ssl_certs()

    # 1. List events (this endpoint is free — 0 credits).
    status, hdr, body = get(f"{BASE}/events?apiKey={key}")
    print(f"events: HTTP {status}  cost={hdr.get('x-requests-last')}  "
          f"remaining={hdr.get('x-requests-remaining')}")
    if status != 200:
        print(body.decode("utf-8", "replace")[:300]); return 1
    events = json.loads(body)
    print(f"  {len(events)} upcoming events")
    if not events:
        print("  no events — nothing to probe"); return 0

    ev = events[0]
    print(f"\nprobing props for nearest event: {ev.get('away_team')} @ {ev.get('home_team')} "
          f"({ev.get('commence_time')})\n  id={ev['id']}\n")

    # 2. Props for that event.
    url = (f"{BASE}/events/{ev['id']}/odds?apiKey={key}&regions=us"
           f"&markets={MARKETS}&oddsFormat=american")
    status, hdr, body = get(url)
    print(f"props: HTTP {status}  cost={hdr.get('x-requests-last')}  "
          f"remaining={hdr.get('x-requests-remaining')}")
    if status != 200:
        print("  body:", body.decode("utf-8", "replace")[:400]); return 1

    data = json.loads(body)
    books = data.get("bookmakers", [])
    markets_seen = sorted({m["key"] for b in books for m in b.get("markets", [])})
    print(f"  bookmakers offering props: {len(books)}")
    print(f"  prop markets present: {markets_seen}")

    # sample outcomes — show the structure (player identity, over/under, line, price)
    for b in books[:1]:
        for m in b.get("markets", [])[:1]:
            print(f"\n  sample: {m['key']} @ {b['key']}")
            for o in m.get("outcomes", [])[:4]:
                print("   ", json.dumps(o))

    os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
    with open(FIXTURE, "wb") as fh:
        fh.write(body)
    print(f"\nsaved raw props body to {FIXTURE} ({len(body)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
