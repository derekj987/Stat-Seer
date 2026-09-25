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


# ---- Baseball -----------------------------------------------------------------------------
#
# MLB has no append-only log to diff. Its four boards are AUTO-GENERATED files that
# refresh-mlb-availability.yml overwrites and commits once a day, so yesterday's numbers are not
# in a table anywhere -- they are in git. That turns out to be a better change log than the one
# football has: one commit per day, every day, with the whole board in each.
#
# So the same "diff two change logs" shape holds, with `git show <sha>:<path>` standing in for the
# second log. What is worth reporting is what baseball's guardrail cannot see: not whether the
# board is right NOW, but what moved since yesterday -- a starter swapped, a projected total that
# shifted, a regular who stopped being a regular.
MLB_FILE = "web/lib/mlbGameModel.ts"
# A projected total has to move by at least this much to be worth a line. Held-out MAE on the
# game model is 3.49 runs, so anything under a run is well inside the noise it already admits to.
MLB_TOTAL_MOVE = 1.0


def _mlb_parse(text):
    """{gameKey: row} from a generated mlbGameModel.ts blob.

    Anchors on '= [' rather than the first '[': the first bracket on the line belongs to the type
    annotation (`MlbGame[]`), and slicing from there yields '[] = [{...' and a JSON error that
    names column 4 of a 400KB line."""
    for line in text.splitlines():
        if line.startswith("export const MLB_GAMES"):
            rows = json.loads(line[line.index("= [") + 2:line.rindex("]") + 1])
            return {str(r["gameKey"]): r for r in rows}
    return {}


def mlb_changes(hours):
    """(starter changes, total moves) between the newest MLB commit and the last one before it."""
    import subprocess
    root = ROOT

    def git(*args):
        return subprocess.run(["git", *args], cwd=root, capture_output=True,
                              text=True, encoding="utf-8", errors="replace").stdout

    shas = [s for s in git("log", "-3", "--format=%H", "--", MLB_FILE).split() if s]
    if len(shas) < 2:
        # Almost always a SHALLOW CHECKOUT rather than a genuinely new file -- Actions fetches one
        # commit by default, which leaves exactly one sha here and makes the baseball section
        # disappear without a word. Say so rather than returning a quiet empty.
        print(f"  MLB: only {len(shas)} commit(s) of {MLB_FILE} are reachable, so there is nothing "
              "to diff. If this is CI, the checkout needs fetch-depth: 0.", file=sys.stderr)
        return [], []
    try:
        now = _mlb_parse(git("show", f"{shas[0]}:{MLB_FILE}"))
        prev = _mlb_parse(git("show", f"{shas[1]}:{MLB_FILE}"))
    except Exception:  # noqa: BLE001 — a malformed old blob must not take the digest down
        return [], []
    starters, totals = [], []
    for key, cur in now.items():
        old = prev.get(key)
        if not old:
            continue                       # a new day's slate, not a change
        for side, fld in (("home", "homeSpName"), ("away", "awaySpName")):
            a, b = old.get(fld) or "", cur.get(fld) or ""
            if a != b and b:               # announced, or swapped; losing a name is not news
                starters.append({"game": cur.get("game"), "side": side, "was": a, "now": b,
                                 # Doubleheaders are two gameKeys with one matchup name, so the
                                 # first cut printed "Dodgers @ Giants away" twice with different
                                 # pitchers and no way to tell which game was which.
                                 "when": str(cur.get("commence") or "")[5:16].replace("T", " ")})
        ta, tb = old.get("total"), cur.get("total")
        if ta is not None and tb is not None and abs(float(tb) - float(ta)) >= MLB_TOTAL_MOVE:
            totals.append({"game": cur.get("game"), "was": float(ta), "now": float(tb)})
    totals.sort(key=lambda m: -abs(m["now"] - m["was"]))
    return starters, totals


# ---- College football ---------------------------------------------------------------------
#
# Same shape as the baseball half and for the same reason: NCAAF has no append-only table either,
# just a generated board that refresh-cfb-ratings commits every six hours. Git is the change log.
#
# What is worth saying is narrow. College has no injury report, so there is no availability news to
# report; the rating only moves when games are PLAYED, so a mid-week move in our own number is
# genuinely notable rather than noise. The other half is the market arriving: books post college
# lines a few days out, so "this game now has a price" is the change a reader actually acts on.
NCAAF_FILE = "web/app/ncaaf/model-data.ts"
# Our projected margin has to move by this much to be worth a line. The rating is a function of
# completed games, so between Tuesday and Friday the honest expectation is that nothing moves at
# all -- a point is already a lot when nothing has been played.
NCAAF_MOVE = 1.0


def _ncaaf_parse(text):
    """{(away, home): game} for the board's CURRENT week, out of a generated model-data.ts."""
    i = text.index("export const NCAAF_MODEL")
    card = json.loads(text[text.index("= {", i) + 2:text.rindex("}") + 1])["card"]
    wk = next((w for w in card.get("weeks", []) if w["week"] == card["week"]), None)
    games = wk["games"] if wk else card.get("games", [])
    return card["week"], {(g["away"], g["home"]): g for g in games}


def ncaaf_changes():
    """(model-spread moves, games that just got a market line) since the previous commit."""
    import subprocess

    def git(*args):
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                              text=True, encoding="utf-8", errors="replace").stdout

    shas = [s for s in git("log", "-3", "--format=%H", "--", NCAAF_FILE).split() if s]
    if len(shas) < 2:
        print(f"  NCAAF: only {len(shas)} commit(s) of {NCAAF_FILE} reachable — nothing to diff. "
              "If this is CI, the checkout needs fetch-depth: 0.", file=sys.stderr)
        return [], []
    try:
        wk_now, now = _ncaaf_parse(git("show", f"{shas[0]}:{NCAAF_FILE}"))
        wk_prev, prev = _ncaaf_parse(git("show", f"{shas[1]}:{NCAAF_FILE}"))
    except Exception:  # noqa: BLE001
        return [], []
    if wk_now != wk_prev:
        return [], []                      # the board rolled to a new week; everything "changed"
    moves, priced = [], []
    for key, cur in now.items():
        old = prev.get(key)
        if not old:
            continue
        a, b = (old.get("projSpread") or {}), (cur.get("projSpread") or {})
        if a.get("num") is not None and b.get("num") is not None:
            # projSpread is always the FAVOURITE's negative number, so compare signed margins
            # about the home team or a flip reads as a 7-point move when it is a 0.2 wobble.
            sa = -float(a["num"]) if a.get("fav") == key[1] else float(a["num"])
            sb_ = -float(b["num"]) if b.get("fav") == key[1] else float(b["num"])
            if abs(sb_ - sa) >= NCAAF_MOVE:
                moves.append({"game": f"{key[0]} @ {key[1]}",
                              "was": f"{a.get('fav')} {a.get('num')}",
                              "now": f"{b.get('fav')} {b.get('num')}",
                              "delta": sb_ - sa})
        if not old.get("marketSpread") and cur.get("marketSpread"):
            ms = cur["marketSpread"]
            priced.append({"game": f"{key[0]} @ {key[1]}",
                           "line": f"{ms.get('fav')} {ms.get('num')}"})
    moves.sort(key=lambda m: -abs(m["delta"]))
    return moves, priced


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
    mlb_sp, mlb_totals = mlb_changes(args.hours)
    mlb_swaps = [s for s in mlb_sp if s["was"]]
    cfb_moves, cfb_priced = ncaaf_changes()
    depth = depth_chart()

    if not out and not back and not moves and not mlb_sp and not mlb_totals             and not cfb_moves and not cfb_priced:
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

    # Baseball. Its own heading rather than mixed in with football: the two sports fail in
    # different places, and a reader scanning for "did anything happen to my sport" should not have
    # to filter. Silent when the slate simply rolled over with nothing changing.
    if mlb_sp or mlb_totals:
        say("## Baseball")
        say()
        # A SWAP gets a line; a first announcement gets counted. Every day's refresh names a dozen
        # starters that were blank the day before, because probables are announced a day or two
        # out -- that is the calendar working, not news, and listing all thirteen every morning is
        # how this section stops being read. A starter REPLACED after being announced is the real
        # event: it is the baseball equivalent of a quarterback going on injured reserve, and it
        # moves the only input the game model gains anything from.
        swaps, named = mlb_swaps, len(mlb_sp) - len(mlb_swaps)
        if swaps:
            say(f"  Starting pitchers CHANGED ({len(swaps)})")
            for s in swaps:
                say(f"    {s['when']} {s['game'][:40]:40s} {s['side']:4s} "
                    f"{s['was']} -> {s['now']}")
            say()
        if named:
            say(f"  ...and {named} starter{'' if named == 1 else 's'} announced for the first "
                "time, which is the normal day-ahead rhythm.")
            say()
        if mlb_totals:
            say(f"  Projected totals that moved a run or more ({len(mlb_totals)})")
            for m in mlb_totals:
                say(f"    {m['game'][:44]:44s} {m['was']:5.2f} -> {m['now']:5.2f}"
                    f"  ({m['now'] - m['was']:+.2f})")
            say("    A run-plus move on a baseball total is almost always a starter being named "
                "or swapped — the game model measured no gain from anything else.")
            say()

    # College football. Its own heading for the same reason baseball has one.
    if cfb_moves or cfb_priced:
        say("## College football")
        say()
        if cfb_moves:
            say(f"  Our number moved ({len(cfb_moves)})")
            for m in cfb_moves[:12]:
                say(f"    {m['game'][:42]:42s} {m['was']:>16s} -> {m['now']:<16s}"
                    f" ({m['delta']:+.1f})")
            say("    The rating is a function of completed games, so a mid-week move means "
                "results landed — not that the market pulled us.")
            say()
        if cfb_priced:
            say(f"  Newly priced by the books ({len(cfb_priced)})")
            for g in cfb_priced[:12]:
                say(f"    {g['game'][:42]:42s} {g['line']}")
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
        if mlb_swaps:
            bits.append(f"{len(mlb_swaps)} MLB starter"
                        f"{'' if len(mlb_swaps) == 1 else 's'} changed")
        elif mlb_totals:
            bits.append(f"{len(mlb_totals)} MLB total{'' if len(mlb_totals) == 1 else 's'} moved")
        if cfb_moves:
            bits.append(f"{len(cfb_moves)} NCAAF moved")
        elif cfb_priced:
            bits.append(f"{len(cfb_priced)} NCAAF priced")
        sent = send_mail(f"StatSeer — {', '.join(bits)}", text)
        if sent is None:
            print("\n(no RESEND_API_KEY / DIGEST_TO — printed only)")
        else:
            print(f"\ne-mail sent: {sent}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
