"""What changed since yesterday — the players, and what the model did about them.

Derek: "I do not want to ask every day 'Hey Player X is now out for the season. Do you know this and
have our numbers been updated?'"

The guardrail (analysis/injury_guardrail.py) answers the second half by shouting when the model has
NOT noticed. This answers the first half for the ordinary case, where everything worked and he still
wants to know: who went out, who came back, and which numbers moved because of it.

It is a DIFF, not a report. Both halves are already change logs by design:

  * `sleeper_availability` is written only when a player's status actually changes, so a row in the
    last day IS the news -- including a row whose status is NULL, which is someone being cleared.
  * `prediction_ledger` keeps every revision rather than overwriting, so a row published in the last
    day on a game that already had one IS the number moving.

Joining them by team turns two logs into one sentence: "Dart to IR. NYG 6.0 -> 3.1."

It sends nothing when nothing happened. A digest that arrives every day regardless is a digest
nobody opens by week three.

DELIVERY. Prints, writes to $GITHUB_STEP_SUMMARY, and e-mails via Resend when RESEND_API_KEY and
DIGEST_TO are both set. Neither is a GitHub Actions secret yet (the web app gets its Resend key from
Vercel), so until they are added this runs and reports without mailing rather than failing.

    python analysis/daily_digest.py
    python analysis/daily_digest.py --hours 48 --send
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "analysis"))
sys.path.insert(0, os.path.join(ROOT, "ingest"))
sys.path.insert(0, ROOT)

from weekly_flags import norm, sb, slot_of, depth_chart  # noqa: E402

OUT_LIKE = {"OUT", "IR", "PUP", "NFI", "DNR", "SUS", "DOUBTFUL"}
# Who is worth a NAME rather than a tally. The first run listed every move including WR9s, TE5s and
# fourth-string backs -- thirty-odd names, which is how a digest stops being read by week three.
# Deep reserves still get counted, so nothing is hidden; they just do not get a line each.
import re as _re
KEY_SLOT = _re.compile(r"^(QB[12]|RB[12]|WR[123]|TE1)$")
# A margin has to move by at least this much to be worth a line in the digest. Matches the
# publisher's own REVISE_MARGIN, so anything that got republished is worth mentioning.
MIN_MOVE = 0.75

LINES: list[str] = []


def say(x=""):
    print(x)
    LINES.append(x)


def player_changes(env, since_iso):
    """Rows written to the availability log in the window. A NULL status is someone CLEARED."""
    rows = sb(env, "sleeper_availability?select=player,team,pos,status,body_part,captured_at"
                   f"&captured_at=gte.{since_iso}&order=captured_at&limit=2000")
    went_out, came_back = [], []
    for r in rows:
        st = str(r.get("status") or "").upper()
        if st in OUT_LIKE:
            went_out.append(r)
        elif not r.get("status"):
            came_back.append(r)
    # One line per player: the newest row in the window is his current state.
    def dedupe(rs):
        seen = {}
        for r in rs:
            seen[(norm(r["player"]), r["team"])] = r
        return sorted(seen.values(), key=lambda r: (r["team"], r["player"]))
    return dedupe(went_out), dedupe(came_back)


def number_moves(env, season, since_iso):
    """Games republished in the window, with the margin they moved from."""
    rows = sb(env, f"prediction_ledger?section=eq.MODEL&season=eq.{season}"
                   "&select=event_id,subject,week,published_at,commence_time,reasoning"
                   "&order=published_at&limit=4000")
    hist = {}
    for r in rows:
        hist.setdefault(r["event_id"], []).append(r)
    moves = []
    for eid, rs in hist.items():
        if len(rs) < 2:
            continue
        newest = rs[-1]
        if str(newest.get("published_at") or "") < since_iso:
            continue                       # the latest revision predates the window
        prev = rs[-2]
        a = (prev.get("reasoning") or {}).get("pred_margin")
        b = (newest.get("reasoning") or {}).get("pred_margin")
        if a is None or b is None or abs(float(b) - float(a)) < MIN_MOVE:
            continue
        moves.append({"subject": newest.get("subject"), "week": newest.get("week"),
                      "was": float(a), "now": float(b),
                      "commence": newest.get("commence_time")})
    return sorted(moves, key=lambda m: -abs(m["now"] - m["was"]))


def send_mail(subject, text):
    """Resend, when the key and a recipient are configured. Silent no-op otherwise."""
    key = os.environ.get("RESEND_API_KEY")
    to = os.environ.get("DIGEST_TO")
    sender = os.environ.get("DIGEST_FROM", "StatSeer <noreply@statseer.app>")
    if not key or not to:
        return None
    body = json.dumps({"from": sender, "to": [to], "subject": subject, "text": text}).encode()
    req = urllib.request.Request("https://api.resend.com/emails", data=body,
                                 headers={"Authorization": f"Bearer {key}",
                                          "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return 200 <= r.getcode() < 300
    except urllib.error.HTTPError as e:
        print(f"  Resend {e.code}: {e.read().decode()[:200]}", file=sys.stderr)
        return False
    except Exception as e:  # noqa: BLE001
        print(f"  Resend failed: {e}", file=sys.stderr)
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--hours", type=float, default=26.0,
                    help="look-back window; slightly over a day so a late run cannot skip a day")
    ap.add_argument("--send", action="store_true", help="e-mail it when there is something to say")
    args = ap.parse_args()

    import injuries_nflverse as inj_env
    env = inj_env.load_env()
    inj_env.ensure_ssl()
    since = (dt.datetime.now(dt.timezone.utc)
             - dt.timedelta(hours=args.hours)).isoformat().replace("+00:00", "Z")

    out, back = player_changes(env, since)
    moves = number_moves(env, args.season, since)
    depth = depth_chart()

    if not out and not back and not moves:
        print(f"nothing changed in the last {args.hours:.0f}h — no digest sent")
        return 0

    say(f"# What changed — {dt.datetime.now(dt.timezone.utc):%a %d %b}")
    say()
    def split(rows):
        """(named, count of everyone else) -- starters get a line, depth gets a number."""
        key = [r for r in rows if KEY_SLOT.match(slot_of(depth, r["player"]) or "")]
        return key, len(rows) - len(key)

    key_out, rest_out = split(out)
    key_back, rest_back = split(back)

    if key_out or rest_out:
        say(f"## Out ({len(out)})")
        say()
        for r in key_out:
            slot = slot_of(depth, r["player"])
            detail = f" ({r['body_part'].lower()})" if r.get("body_part") else ""
            say(f"  {r['team']:4s} {r['player']:24s} {slot:5s} "
                f"{str(r.get('status')).upper()}{detail}")
        if not key_out:
            say("  No starter went out.")
        if rest_out:
            say(f"  ...and {rest_out} squad {'player' if rest_out == 1 else 'players'} "
                f"below the top of the depth chart.")
        say()
    if key_back or rest_back:
        say(f"## Back ({len(back)})")
        say()
        for r in key_back:
            say(f"  {r['team']:4s} {r['player']:24s} {slot_of(depth, r['player'])}")
        if not key_back:
            say("  No starter returned.")
        if rest_back:
            say(f"  ...and {rest_back} squad {'player' if rest_back == 1 else 'players'}.")
        say()
    if moves:
        say(f"## Model numbers that moved ({len(moves)})")
        say()
        say("  These are REVISIONS — the earlier number stays on the record beside them.")
        say()
        for m in moves:
            say(f"  wk{m['week']} {str(m['subject']):4s}  {m['was']:+.1f} -> {m['now']:+.1f}"
                f"   ({m['now'] - m['was']:+.1f})")
        say()
    else:
        say("## Model numbers")
        say()
        say("  No published number moved by more than "
            f"{MIN_MOVE} points. If a starter is listed above, the guardrail in "
            "publish-predictions.yml is the thing that would have failed.")
        say()

    text = "\n".join(LINES)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    if args.send:
        bits = []
        if key_out:
            bits.append(f"{len(key_out)} starter{'' if len(key_out) == 1 else 's'} out")
        elif out:
            bits.append(f"{len(out)} out")
        if key_back:
            bits.append(f"{len(key_back)} back")
        elif back:
            bits.append(f"{len(back)} back")
        if moves:
            bits.append(f"{len(moves)} numbers moved")
        sent = send_mail(f"StatSeer — {', '.join(bits)}", text)
        if sent is None:
            print("\n(no RESEND_API_KEY / DIGEST_TO — printed only)")
        else:
            print(f"\ne-mail sent: {sent}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
