#!/usr/bin/env python3
"""Do our prop boards agree with the book — on WHO is listed, and on WHAT THEY ARE CALLED?

Derek: "scan all sports and ensure they align with fanduel. This includes games, dates, player
names, props, etc." Games and dates are `analysis/slate_audit.py`; this is the player half, and it
covers all four sports rather than the NFL alone.

WHY NOT FANDUEL DIRECTLY: their site is not scraped (terms). The licensed Odds API capture carries
FanDuel's own entries, so "agrees with FanDuel" is read from the <sport>_prop_snapshots tables, and
`LINE_BOOK = "fanduel"` in lib/board.ts is the same convention every market column already uses.

🚨 WHAT THIS MEASURES IS THE GENERATED FILE, NOT THE PAGE — and that distinction cost a whole
first draft, which reported five FAILURES that were all non-defects. `PlayerModelView` does three
things to the generated board before a member sees it, every one of which this script is blind to:

  - it OVERRIDES the market line from the newest capture. Measured 2026-10-24: the file had Sam
    Leavitt at 255.5 and the rendered page showed 251.5, which is FanDuel's current number.
  - it EXPANDS abbreviated names. The NHL file publishes "N. MacKinnon"; the page renders "Nathan
    MacKinnon", and 0 of 194 rendered names were abbreviated.
  - it MERGES live priced players who have no file row at all (Zonovan Knight was reported missing
    and is on the page).

So a difference found here is the generated file DRIFTING from the book between refreshes, which
is expected and is compensated for at render time. It is a freshness measure, not a board defect,
and every finding is worded that way. **The member-visible question can only be answered against
the RENDERED page** — drive the dev server and read the DOM, the way the visual-audit skill does.
Two separate lessons from this file apply at once: a probe that cries wolf buries the real bug, and
auditing the artifact you can reach instead of the one that ships is how you get a confident wrong
answer.

THREE CHECKS, and they fail in different ways:

  COVERAGE    a player the book prices with no row on our board. The market saying someone is
              worth a price is the market saying he matters; being silent on him is the bug
              `board_coverage.py` was written for after 136 of 552 priced NFL players (25%) had
              no row, including the four shortest anytime-TD prices on the slate. Ranked by
              SHORTEST price, never by count -- "136 missing" reads as a data gap you can defer,
              "the four shortest prices on the slate are missing" does not.

  SPELLING    a board name that does not appear verbatim in the feed. A reader checks our board
              against the FanDuel app by the name they see there, so "Isaiah Sategna" against the
              app's "Isaiah Sategna III" reads as a different player -- and an abbreviated
              "N. MacKinnon" is not a name anyone can look up at all.

  LINE        the number in our market column against the number the book posted. Only two sports
              can be checked this way: the NFL and NCAAF boards carry a `book` line per row, while
              MLB publishes probabilities and NHL publishes a projection with its over-table, so
              there is no posted line on the row to compare. Say so rather than reporting a clean
              zero for a check that never ran.

    python analysis/prop_alignment.py                 # every sport
    python analysis/prop_alignment.py --sport nhl
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

FAILS: list[str] = []
WARNS: list[str] = []


def fail(m):
    FAILS.append(m)
    print(f"  [FAIL] {m}")


def warn(m):
    WARNS.append(m)
    print(f"  [warn] {m}")


def ok(m):
    print(f"  [ok]   {m}")


def norm(s: str) -> str:
    """Suffix-blind, accent-folded key. Decompose BEFORE stripping, or 'San José' loses its e."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z ]", "", s.lower())
    s = re.sub(r"\s+", " ", s).strip()
    for suf in (" jr", " sr", " ii", " iii", " iv", " v"):
        if s.endswith(suf):
            s = s[: -len(suf)]
    return s.strip()


# A team defence is priced as a "player" by the books and is not one. Matched AFTER norm(), which
# strips the slash -- written as "d/st" first, it silently matched nothing and left twenty defences
# in the results looking like real misses.
NOT_A_PLAYER = ("dst", "defense", "no touchdown", "no scorer", "test player")

# Per sport: the capture table, what it calls the player column, the generated board, and whether
# the board carries a posted line we can compare.
#
# 🚨 THE COLUMN NAMES ARE NOT THE SAME ACROSS THE FOUR TABLES, and a wrong one is a PostgREST 400
# rather than an empty result — which at least fails loudly. `prop_snapshots` (NFL) calls the
# player `player_name` and the price `price_american`; the other three call the player `player`,
# and only MLB joins it with `price_american`. Introspect before assuming:
#     GET /rest/v1/<table>?select=*&limit=1
SPORTS = {
    "nfl":   dict(table="prop_snapshots",     player="player_name", price="price_american",
                  commence="commence_time",
                  board="web/lib/playerProjections.ts",      has_line=True),
    "ncaaf": dict(table="cfb_prop_snapshots", player="player",      price="price",
                  commence="commence",
                  board="web/lib/ncaafPlayerProjections.ts", has_line=True),
    "mlb":   dict(table="mlb_prop_snapshots", player="player",      price="price_american",
                  commence="commence_time",
                  board="web/lib/mlbPlayerProps.ts",         has_line=False),
    "nhl":   dict(table="nhl_prop_snapshots", player="player",      price="price",
                  commence="commence",
                  board="web/lib/nhlPlayerProjections.ts",   has_line=False, slate=False),
}

# Three of the four boards are SLATE boards — a row per player per game, carrying the kickoff.
# `nhlPlayerProjections.ts` is not: it is a league-wide player table (season shot rate shrunk to
# the prior season), one row per player per market with no game on it, and /nhl/props joins it to
# the night's games at render time. So its coverage is legitimately unscoped, and warning that it
# "may be comparing two different slates" would be a manufactured finding about a deliberate
# design. Absence of a kickoff is only a defect on a board that is supposed to have one.


ABBREV_RE = re.compile(r"^[A-Z]\.\s")


def is_abbrev(name: str) -> bool:
    """"A. Copp" yes, "Chase Brown" no.

    🚨 THE INITIAL-KEY MATCH IS ONLY SAFE ON A NAME THAT IS ACTUALLY ABBREVIATED. Applied to full
    names it matches any two players sharing a surname and a first initial, and it duly reported
    "Chase Brown" vs "Camden Brown", "Jameson Williams" vs "Javonte Williams" and "Darius Taylor"
    vs "DJ Taylor" as spelling defects. They are different people. A check that manufactures
    findings on common surnames is worse than no check, so the loose key is gated on the board
    name looking like an abbreviation in the first place.
    """
    return bool(ABBREV_RE.match(name or ""))


def initial_key(name: str):
    """('n', 'mackinnon') for both "N. MacKinnon" and "Nathan MacKinnon".

    🚨 WITHOUT THIS THE NHL AUDIT REPORTED 440 OF 440 PRICED PLAYERS MISSING — a 100% miss is
    never a real result, it is two name spaces that do not intersect. The NHL board publishes an
    abbreviated first name and the feed publishes the full one, so `norm` matched nothing and the
    coverage check was measuring the abbreviation rather than the coverage. Worse, the SPELLING
    check then passed vacuously, because it only considers board names already found in the feed.
    Matching on first-initial + surname lets coverage be answered honestly, and leaves the
    abbreviation to be reported where it belongs: as a name a reader cannot look up.
    """
    t = norm(name).split()
    return (t[0][:1], t[-1]) if len(t) >= 2 else (None, norm(name))


def load_env():
    env = {}
    for name in (".env", os.path.join("web", ".env.local")):
        p = os.path.join(ROOT, name)
        if not os.path.exists(p):
            continue
        for line in open(p, encoding="utf-8"):
            m = re.match(r"^([A-Za-z_0-9]+)=(.*)$", line.strip())
            if m and m.group(1) not in env:
                env[m.group(1)] = m.group(2)
    env.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    return env


def page(url, key, table, params):
    """Every PostgREST read pages until a SHORT page comes back. `limit=` does not raise the cap,
    and a response sitting exactly at it is indistinguishable from a complete one."""
    out, start = [], 0
    while True:
        q = urllib.parse.urlencode(params, safe="*.,()")
        req = urllib.request.Request(
            f"{url.rstrip('/')}/rest/v1/{table}?{q}",
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Range": f"{start}-{start + 999}", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as r:
            rows = json.loads(r.read().decode())
        out += rows
        if len(rows) < 1000:
            return out
        start += 1000


def board_rows(path):
    """Every {"player": ...} object the generated board publishes, with its market and book line
    where it has them. A parser that matches nothing reports a clean zero, which is a false pass."""
    src = open(os.path.join(ROOT, path), encoding="utf-8").read()
    rows = []
    for m in re.finditer(r'\{"[^{}]*?"player": *"([^"]+)"[^{}]*\}', src):
        blob, name = m.group(0), m.group(1)
        mk = re.search(r'"market": *"([^"]+)"', blob)
        bk = re.search(r'"book": *(-?[0-9.]+)', blob)
        # The kickoff the row belongs to, as a UTC date. This is what scopes the coverage check to
        # one slate; see the comment at its call site. Matching on TEAM NAME was tried first and is
        # a dead end -- the file says "Indiana" where the feed says "Indiana Hoosiers", so the
        # intersection is empty and the scoping silently does nothing at all.
        cm = re.search(r'"commence": *"(\d{4}-\d{2}-\d{2})', blob)
        rows.append({"player": name, "market": mk.group(1) if mk else None,
                     "book": float(bk.group(1)) if bk else None,
                     "day": cm.group(1) if cm else None})
    return rows


def stale_vs_main(path):
    """Is our copy of this AUTO-GENERATED board different from origin/main's?

    🚨 THE WORKTREE IS NOT WHAT SHIPS. This cost the audit its two loudest findings: run from a
    branch 24 commits behind main, the script reported NCAAF and MLB as "a slate behind — the
    board is built for 2026-10-24 and the book is pricing 2026-10-27", complete with a confident
    instruction to regenerate. Both boards were already correct on main (card week 9, not 8); the
    refresh crons had run green all along and the stale file was mine. A branch does not normally
    touch these files -- they are written by the refresh workflows -- so any difference from
    origin/main means the audit is measuring an artifact nobody is served.
    """
    import subprocess
    try:
        mine = subprocess.run(["git", "hash-object", path], cwd=ROOT, capture_output=True,
                              text=True, timeout=30)
        theirs = subprocess.run(["git", "rev-parse", f"origin/main:{path}"], cwd=ROOT,
                                capture_output=True, text=True, timeout=30)
        if mine.returncode or theirs.returncode:
            return None
        return mine.stdout.strip() != theirs.stdout.strip()
    except Exception:
        return None


def audit(sport, cfg, env):
    print(f"\n## {sport.upper()}")
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    path = os.path.join(ROOT, cfg["board"])
    if not os.path.exists(path):
        return fail(f"{sport}: board file missing — {cfg['board']}")
    if stale_vs_main(cfg["board"]):
        return fail(f"{sport}: our copy of {cfg['board']} differs from origin/main, so this "
                    f"check would measure a file nobody is served — every finding from it would "
                    f"be about the checkout, not the board. NOTHING WAS AUDITED; merge main "
                    f"(or run from a current checkout) and re-run.")

    pcol = cfg["player"]
    latest = page(url, key, cfg["table"],
                  {"select": "snapshot_at", "order": "snapshot_at.desc", "limit": "1"})
    if not latest:
        return fail(f"{sport}: {cfg['table']} is empty — NOTHING WAS AUDITED")
    snap = latest[0]["snapshot_at"]
    ccol = cfg["commence"]
    rows = page(url, key, cfg["table"],
                {"select": f"{pcol},market,line,{cfg['price']},book,{ccol}",
                 "snapshot_at": f"eq.{snap}"})
    if not rows:
        return fail(f"{sport}: newest capture {snap[:16]} has no rows — NOTHING WAS AUDITED")

    board = board_rows(cfg["board"])
    if len(board) < 20:
        return fail(f"{sport}: parsed only {len(board)} rows from {cfg['board']} — shape changed? "
                    f"NOTHING WAS AUDITED")
    print(f"  capture {snap[:16]}Z · {len(rows)} priced rows · board {len(board)} rows")

    # 🚨 SCOPE COVERAGE TO THE SLATE THE BOARD WAS BUILT FOR. The capture is whatever the book
    # prices right now; the generated file is the slate it was last built for. On a midweek run
    # those barely overlap — NCAAF reported "82 of 94 priced players (87%) have no row" while
    # comparing a Monday capture against a file built for Saturday. Two different slates is not a
    # coverage gap, it is the calendar. Kickoff DATE is the join: it needs no name matching, which
    # team names cannot survive ("Indiana" here, "Indiana Hoosiers" in the feed).
    board_days = {b["day"] for b in board if b["day"]}
    if not cfg.get("slate", True):
        board_days = set()  # league-wide player table by design; see the note under SPORTS
        print("  [info] board is a league-wide player table, not a slate board — coverage is "
              "scoped to the whole league, which is correct here")
    elif not board_days:
        warn(f"{sport}: no kickoff date parsed from {cfg['board']}, so coverage is UNSCOPED and "
             f"may be comparing two different slates")

    # ---- COVERAGE ----
    priced, best = {}, {}
    off_slate = 0
    for r in rows:
        raw = r.get(pcol)
        if not raw:
            continue
        day = (r.get(ccol) or "")[:10]
        if board_days and day not in board_days:
            off_slate += 1
            continue
        k = norm(raw)
        if not k or any(w in k for w in NOT_A_PLAYER):
            continue
        priced[k] = raw
        p = r.get(cfg["price"])
        if p is not None and (k not in best or abs(int(p)) < abs(best[k])):
            best[k] = int(p)
    if off_slate:
        on = sorted({(r.get(ccol) or "")[:10] for r in rows if (r.get(ccol) or "")[:10]
                     in board_days})
        print(f"  [info] {off_slate} of {len(rows)} priced rows are for kickoffs outside the "
              f"board's slate and are not counted against coverage — the overlap the check "
              f"actually ran on is {', '.join(on) or 'nothing'}")
    if not priced:
        cap = sorted({(r.get(ccol) or "")[:10] for r in rows} - {""})
        return fail(
            f"{sport}: the generated board is built for {', '.join(sorted(board_days))}, and the "
            f"book is pricing {', '.join(cap)} — ZERO overlap, so no player could be checked. "
            f"The board is a slate behind: regenerate it for the games now priced.")
    # Covered if the board carries the name OR an abbreviated form of it — see initial_key.
    shown = {norm(b["player"]) for b in board}
    shown_ini = {initial_key(b["player"]) for b in board if is_abbrev(b["player"])}
    missing = sorted((k for k in priced
                      if k not in shown and initial_key(priced[k]) not in shown_ini),
                     key=lambda k: best.get(k, 99999))
    if missing:
        worst = ", ".join(f"{priced[k]} ({best.get(k, '?')})" for k in missing[:5])
        pct = len(missing) / len(priced) * 100
        # Not a FAIL: the page merges live priced players, so a file gap is usually invisible.
        warn(f"{sport}: {len(missing)} of {len(priced)} priced players ({pct:.0f}%) have no row "
             f"in the generated FILE — the page merges live rows, so confirm on the page before "
             f"acting; shortest prices first: {worst}")
    else:
        ok(f"{sport}: every priced player has a row in the generated file ({len(priced)} players)")

    # ---- SPELLING ----
    feed_exact = {r.get(pcol) for r in rows if r.get(pcol)}
    by_ini = {initial_key(v): v for v in priced.values()}
    odd = []
    for b in board:
        if b["player"] in feed_exact:
            continue
        # Only a name the book actually prices can be compared — anything else is simply a player
        # the market has not priced, not a spelling defect.
        # The loose initial key is ONLY consulted for a board name that is actually abbreviated —
        # see is_abbrev. Applied to full names it reports every shared surname as a defect.
        book_name = priced.get(norm(b["player"]))
        if not book_name and is_abbrev(b["player"]):
            book_name = by_ini.get(initial_key(b["player"]))
        if book_name:
            odd.append((b["player"], book_name))
    odd = sorted(set(odd))
    if odd:
        warn(f"{sport}: {len(odd)} FILE name(s) differ from the book's spelling — the page "
             f"expands abbreviations, so confirm in the DOM before calling it a defect; e.g. " +
             ", ".join(f'"{a}" vs "{b}"' for a, b in odd[:4]))
    else:
        ok(f"{sport}: every board name matches the book's spelling verbatim")

    # ---- LINE ----
    if not cfg["has_line"]:
        warn(f"{sport}: board publishes no posted line (probabilities/projections), so the "
             f"line check does not apply — this is absence of a check, not a clean result")
        return
    fd = {}
    for r in rows:
        if (r.get("book") or "") != "fanduel" or r.get("line") is None:
            continue
        if board_days and (r.get(ccol) or "")[:10] not in board_days:
            continue  # same player, a different week's line — not a drift in this slate's number
        fd[(norm(r.get(pcol) or ""), r.get("market"))] = float(r["line"])
    checked = bad = 0
    examples = []
    for b in board:
        if b["book"] is None or not b["market"]:
            continue
        for mk in (b["market"], "player_" + b["market"]):
            if (norm(b["player"]), mk) in fd:
                checked += 1
                posted = fd[(norm(b["player"]), mk)]
                if abs(posted - b["book"]) > 0.001:
                    bad += 1
                    if len(examples) < 4:
                        examples.append(f'{b["player"]} {b["market"]}: ours {b["book"]} vs '
                                        f'FanDuel {posted}')
                break
    if not checked:
        warn(f"{sport}: no board row joined to a FanDuel line — market names may not match "
             f"between the board and the feed; NOTHING WAS COMPARED")
    elif bad:
        warn(f"{sport}: {bad} of {checked} FILE lines have drifted from FanDuel since the last "
             f"refresh — the page overrides from the newest capture, so this is staleness, not "
             f"a wrong number on the board — " + "; ".join(examples))
    else:
        ok(f"{sport}: all {checked} comparable board lines match FanDuel's posted number")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sport", choices=list(SPORTS) + ["all"], default="all")
    a = ap.parse_args(argv)
    env = load_env()
    if not env.get("SUPABASE_URL") or not env.get("SUPABASE_SERVICE_KEY"):
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    print("# Prop alignment — board vs the book's own entries in our capture")
    for s in (list(SPORTS) if a.sport == "all" else [a.sport]):
        try:
            audit(s, SPORTS[s], env)
        except Exception as e:  # noqa: BLE001
            fail(f"{s}: audit raised {type(e).__name__}: {e}")
    print("\n---")
    if FAILS:
        print(f"**{len(FAILS)} FAILURE(S)**, {len(WARNS)} warning(s).")
        return 1
    print(f"**All clear.** {len(WARNS)} warning(s)." if WARNS else "**All clear.**")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
