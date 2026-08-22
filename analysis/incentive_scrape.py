"""
incentive_scrape.py -- populate web/lib/incentiveWatch.ts from Over The Cap's weekly
"Incentives Watch" (https://overthecap.com/{season}-incentives-watch-week-{n}).

Why OTC: contract incentives aren't in any free feed, but OTC PUBLISHES a weekly watch of
players within practical reach of one -- exactly the "getting close" list we want, already
computed. It's a plain HTML table (Player | Team | Amount | Requirement | Currently |
Needed), team is already an nflverse-ish abbreviation. We mirror it verbatim (no fabricated
numbers) onto the Special Considerations cards.

Preseason / before Week 1: no page exists yet -> nothing scraped -> empty watch (correct).
The site is scraped politely (one page, plain UA, small backoff). If OTC changes its markup
or blocks the request, we log and write an empty file rather than fail.

    python analysis/incentive_scrape.py                 # latest published week
    python analysis/incentive_scrape.py --week 18        # a specific week
    python analysis/incentive_scrape.py --season 2025 --week 18   # test on last year

Stdlib only (+ certifi for TLS).
"""
import argparse
import datetime as dt
import html
import os
import re
import sys
import urllib.error
import urllib.request

try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except Exception:
    pass

SEASON = int(os.environ.get("SEASON", "2026"))
URL = "https://overthecap.com/{season}-incentives-watch-week-{week}"
OUT = os.path.join("web", "lib", "incentiveWatch.ts")
UA = {"User-Agent": "Mozilla/5.0 (compatible; statseer/1.0; +https://statseer.vercel.app)"}
# OTC abbreviations -> the nflverse abbreviations the board/cards use.
TEAM_ALIAS = {"LAR": "LA", "WSH": "WAS", "JAC": "JAX", "OAK": "LV", "SD": "LAC", "STL": "LA"}


def fetch(season, week):
    """Return page HTML, or None on 404/403/network error (treated as 'no watch')."""
    req = urllib.request.Request(URL.format(season=season, week=week), headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            print(f"  OTC returned {e.code} (blocked/limited) for week {week}", file=sys.stderr)
        return None
    except urllib.error.URLError as e:
        print(f"  network error for week {week}: {e.reason}", file=sys.stderr)
        return None


def current_week(season):
    """NFL week number for today, or 0 in the preseason. Week 1 kicks off the Thursday
    after Labor Day (the first Monday of September)."""
    d = dt.date(season, 9, 1)
    first_monday = d + dt.timedelta(days=(0 - d.weekday()) % 7)
    kickoff = first_monday + dt.timedelta(days=3)   # Thursday
    today = dt.date.today()
    if today < kickoff:
        return 0
    return min(18, (today - kickoff).days // 7 + 1)


def latest_week_html(season, explicit):
    """Page HTML for `explicit` week, or for the current week (falling back to the prior
    week, since OTC posts mid-week). Returns (week, html) or (week, None)."""
    if explicit:
        return explicit, fetch(season, explicit)
    w = current_week(season)
    if w == 0:
        return 0, None                        # preseason — don't hit the site
    for cand in (w, w - 1):                    # this week, else last week's post
        if cand >= 1:
            h = fetch(season, cand)
            if h and "<td>" in h.lower():
                return cand, h
    return w, None


def _cells(row_html):
    return [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
            for c in re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.S | re.I)]


def _num(s):
    m = re.search(r"(\d[\d,]*(?:\.\d+)?)", s or "")
    return float(m.group(1).replace(",", "")) if m else None


def parse(html_text):
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html_text, re.S | re.I):
        c = _cells(tr)
        if len(c) != 6 or c[0].strip().lower() == "player":
            continue
        player, team, amount, requirement, currently, needed = c
        if not player or not team:
            continue
        team = TEAM_ALIAS.get(team.upper(), team.upper())
        thr, cur = _num(requirement), _num(currently)
        pct = round(100.0 * cur / thr) if (thr and cur is not None and thr > 0) else None
        rows.append({
            "player": player, "team": team, "amount": amount.strip(),
            "requirement": requirement.strip(), "currently": currently.strip(),
            "needed": needed.strip(), "pct": pct,
        })
    # de-dupe (a player can have multiple incentives — keep them), sort by closeness.
    rows.sort(key=lambda r: (r["pct"] is None, -(r["pct"] or 0)))
    return rows


def _ts(w):
    p = "null" if w["pct"] is None else w["pct"]
    return ('{ player: %r, team: %r, amount: %r, requirement: %r, currently: %r, '
            'needed: %r, pct: %s }' % (w["player"], w["team"], w["amount"],
            w["requirement"], w["currently"], w["needed"], p)).replace("'", '"')


def write(week, rows):
    body = [
        "// AUTO-GENERATED by analysis/incentive_scrape.py — do not edit by hand.",
        "// Over The Cap weekly Incentives Watch — players within practical reach of a",
        "// contract incentive. Shown on Special Considerations cards. Empty in the preseason.",
        "export interface IncentiveWatch { player: string; team: string; amount: string;",
        "  requirement: string; currently: string; needed: string; pct: number | null }",
        f"export const INCENTIVE_SEASON = {SEASON};",
        f"export const INCENTIVE_WEEK = {week if week else 0};",
        "export const INCENTIVE_WATCH: IncentiveWatch[] = [",
    ]
    body += ["  " + _ts(w) + "," for w in rows]
    body += ["];", ""]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(body))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, default=SEASON)
    ap.add_argument("--week", type=int, default=None)
    args = ap.parse_args(argv)

    week, page = latest_week_html(args.season, args.week)
    rows = parse(page) if page else []
    write(week, rows)
    if page:
        print(f"scraped OTC {args.season} week {week}: {len(rows)} incentive row(s) -> {OUT}")
    else:
        print(f"no OTC incentives watch found for {args.season} (preseason / not published) "
              f"-> wrote empty {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
