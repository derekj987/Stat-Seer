"""
Vercel Cron handler: /api/cron/odds-pre-kickoff

Tight closing-line capture. Runs every 15 minutes across the game-day windows and
writes only games kicking off soon, so the last snapshot before commence_time (the
closing line, per the closing_lines view) is always captured without spamming rows.

Schedule (vercel.json): "*/15 16-23 * 9-12,1 0,1,4"
  every 15 min, 16:00-23:00 UTC, Sep-Jan, Sun/Mon/Thu.
Credit cost per run: markets x regions = 3 x 2 = 6 (unchanged by the row filter —
the API bills per call, not per game).

Only difference from odds-scheduled: capture_reason=PRE_KICKOFF and rows are filtered
to games within COMMENCE_WITHIN_MIN of kickoff. 25 min > the 15-min cron interval,
so no kickoff wave can slip between runs. Shares all logic with odds_client.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import odds_client as oc  # noqa: E402

CAPTURE_REASON = "PRE_KICKOFF"
MARKETS = "h2h,spreads,totals"
REGIONS = "us,us2"
COMMENCE_WITHIN_MIN = 25  # headroom over the 15-min cron so no kickoff is missed


def _cfg(key):
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
    snapshot_at = oc.snapshot_time_from_events(events)
    rows, unresolved = oc.parse_snapshot(events, snapshot_at, CAPTURE_REASON, week_map)
    rows = oc.filter_commence_window(rows, COMMENCE_WITHIN_MIN)

    # Nothing kicking off soon is the common case on most 15-min ticks — that is a
    # clean no-op, not an error. Skip the write and the credit-free path entirely.
    if not rows:
        return 200, {"ok": True, "capture_reason": CAPTURE_REASON, "parsed": 0,
                     "written": 0, "note": "no games within window",
                     "credit_cost": credit.get("last"),
                     "credits_remaining": credit.get("remaining")}

    url, key = _cfg("SUPABASE_URL"), _cfg("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return 500, {"ok": False, "error": "Supabase creds missing", "parsed": len(rows)}

    written = oc.write_supabase(rows, url, key)
    return 200, {
        "ok": True,
        "capture_reason": CAPTURE_REASON,
        "snapshot_at": snapshot_at,
        "credit_cost": credit.get("last"),
        "credits_remaining": credit.get("remaining"),
        "parsed": len(rows),
        "written": written,
        "unresolved": len(unresolved),
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        secret = os.environ.get("CRON_SECRET")
        if secret and self.headers.get("authorization") != f"Bearer {secret}":
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            code, payload = run_capture()
        except Exception as e:
            code, payload = 500, {"ok": False, "error": f"{type(e).__name__}: {e}"}
        self._send(code, payload)

    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)
