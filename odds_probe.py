"""
odds_probe.py

Single raw probe of The Odds API v4 NFL odds endpoint.

Makes ONE GET request, then dumps the exchange verbatim:
  - HTTP status line
  - every response header, exactly as returned
  - the raw JSON body (pretty-printed only; no field parsing / interpretation)

The raw body is also saved byte-for-byte to fixtures/odds_v4_raw.json.

Reads ODDS_API_KEY from a local .env file (KEY=VALUE lines). Uses only the
Python standard library so it runs without any pip installs.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ENDPOINT = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds"
ENV_PATH = ".env"
FIXTURE_PATH = os.path.join("fixtures", "odds_v4_raw.json")


def load_env_key(env_path, key):
    """Minimal .env reader: returns the value of `key`, or None if absent."""
    if not os.path.exists(env_path):
        return None
    with open(env_path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            if name.strip() == key:
                # Strip surrounding whitespace and optional quotes.
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                return value
    return None


def main():
    api_key = load_env_key(ENV_PATH, "ODDS_API_KEY")
    if not api_key:
        print("ERROR: ODDS_API_KEY not found (or empty) in .env", file=sys.stderr)
        return 1

    params = {
        "apiKey": api_key,
        "regions": "us",
        "markets": "h2h",
        "oddsFormat": "american",
    }
    url = ENDPOINT + "?" + urllib.parse.urlencode(params)

    # Make the single GET. Capture the response object even on HTTP errors so we
    # can dump status/headers/body for non-2xx responses too.
    try:
        resp = urllib.request.urlopen(urllib.request.Request(url, method="GET"))
    except urllib.error.HTTPError as e:
        resp = e
    except urllib.error.URLError as e:
        print(f"ERROR: request failed: {e}", file=sys.stderr)
        return 1

    status = resp.getcode()
    headers = resp.headers  # http.client.HTTPMessage — preserves order & duplicates
    body_bytes = resp.read()

    # --- HTTP status ---
    print("=" * 60)
    print(f"HTTP STATUS: {status} {getattr(resp, 'reason', '')}".rstrip())
    print("=" * 60)

    # --- Response headers, verbatim ---
    print("RESPONSE HEADERS:")
    for name, value in headers.items():
        print(f"{name}: {value}")
    print("=" * 60)

    # --- Raw JSON body (pretty-printed only) ---
    print("RAW JSON BODY:")
    text = body_bytes.decode("utf-8", errors="replace")
    try:
        parsed = json.loads(text)
        print(json.dumps(parsed, indent=2, ensure_ascii=False))
    except json.JSONDecodeError:
        # Not valid JSON — print exactly what came back.
        print(text)
    print("=" * 60)

    # --- Save raw body byte-for-byte ---
    os.makedirs(os.path.dirname(FIXTURE_PATH), exist_ok=True)
    with open(FIXTURE_PATH, "wb") as fh:
        fh.write(body_bytes)
    print(f"Raw body saved to {FIXTURE_PATH} ({len(body_bytes)} bytes)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
