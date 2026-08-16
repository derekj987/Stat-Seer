"""
Vercel Cron handler: /api/cron/odds-scheduled

Twice-daily snapshot of every upcoming NFL game across all books and the three
game markets. Thin HTTP shell over odds_client — all parsing/writing logic lives
there and is unit-tested against the golden fixture.

Schedule (vercel.json): "0 9,21 * * *"  — 09:00 and 21:00 UTC daily.
Credit cost per run: markets x regions = 3 x 1 = 3.

Deployment requirements (see api/cron/README for the full list):
  * Env vars on Vercel: ODDS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET
  * vercel.json must includeFiles "odds_client.py" so the shared module ships with
    the function (the runtime sys.path insert below defeats Vercel's import tracer).
  * The nflverse schedule is fetched at runtime (data/games.csv is not deployed).
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

# Repo root holds odds_client.py — three levels up from api/cron/<this>.py.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import odds_client as oc  # noqa: E402

CAPTURE_REASON = "SCHEDULED"
MARKETS = "h2h,spreads,totals"
REGIONS = "us"
COMMENCE_WITHIN_MIN = None  # scheduled = capture all upcoming games


def _cfg(key):
    """Config from Vercel env vars, falling back to a local .env for dev runs."""
    val = os.environ.get(key)
    if val:
        return val
    return oc.load_env().get(key)


def run_capture():
    api_key = _cfg("ODDS_API_KEY")
    if not api_key:
        return 500, {"ok": False, "error": "ODDS_API_KEY missing"}

    status, _headers, events, credit = oc.fetch_live(api_key, MARKETS, REGIONS)
    if status != 200:
        return 502, {"ok": False, "upstream_status": status, "credit": credit}

    week_map = oc.load_week_map()
    season_starts = oc.load_season_starts()
    reg_events, pre_events = oc.split_events(events, season_starts)
    snapshot_at = oc.snapshot_time_from_events(events)
    rows, unresolved = oc.parse_snapshot(reg_events, snapshot_at, CAPTURE_REASON, week_map)
    pre_rows, _pre_unresolved = oc.parse_preseason(pre_events, snapshot_at, CAPTURE_REASON)
    if COMMENCE_WITHIN_MIN is not None:
        rows = oc.filter_commence_window(rows, COMMENCE_WITHIN_MIN)

    url, key = _cfg("SUPABASE_URL"), _cfg("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return 500, {"ok": False, "error": "Supabase creds missing", "parsed": len(rows)}

    written = oc.write_supabase(rows, url, key)
    pre_written = oc.write_preseason(pre_rows, url, key) if pre_rows else 0
    return 200, {
        "ok": True,
        "capture_reason": CAPTURE_REASON,
        "snapshot_at": snapshot_at,
        "credit_cost": credit.get("last"),
        "credits_remaining": credit.get("remaining"),
        "parsed": len(rows),
        "written": written,
        "unresolved": len(unresolved),
        "preseason_parsed": len(pre_rows),
        "preseason_written": pre_written,
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        secret = os.environ.get("CRON_SECRET")
        if secret and self.headers.get("authorization") != f"Bearer {secret}":
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            code, payload = run_capture()
        except Exception as e:  # a bad run must return JSON, not a 500 HTML page
            code, payload = 500, {"ok": False, "error": f"{type(e).__name__}: {e}"}
        self._send(code, payload)

    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)
