"""
cfb_depth.py -- current NCAAF depth charts, scraped from Ourlads (the one structured,
API-less source for college depth charts; CFBD exposes rosters but no depth order, and
ESPN's college depth-chart API is empty). Robots.txt permits the depth-chart path.

Produces, per FBS team, the ordered skill-position depth chart:
    { cfbd_school: { "QB": [name, ...], "RB": [...], "WR": [...], "TE": [...] } }
starter-first. Receivers (Ourlads splits them into WR-X / WR-Z / WR-H / slot) are
collapsed starters-first: each spot's WR1 comes before any spot's WR2.

    python cfb_depth.py --probe alabama   # scrape + print one team
    python cfb_depth.py                    # scrape all, write web/lib/ncaafDepth.ts

Writes web/lib/ncaafDepth.ts: { normName: { team, pos, rank } } so the app can tag a
player with their real depth slot (RB1/WR2). cfb_player_proj imports scrape_all() to pick
who to project. Stdlib only. Be polite: a short delay between team requests.
"""
import argparse
import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

BASE = "https://www.ourlads.com/ncaa-football-depth-charts/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) StatSeer/1.0"
# Ourlads offense row labels we keep, mapped to our position group. Receiver spots (WR-X,
# WR-Z, WR-H, slots) all fold into "WR"; a fullback folds into "RB".
POS_MAP = {
    "QB": "QB", "RB": "RB", "FB": "RB", "HB": "RB", "TE": "TE",
    "WR": "WR", "WR-X": "WR", "WR-Z": "WR", "WR-H": "WR", "WR-Y": "WR",
    "SL": "WR", "SLOT": "WR", "X": "WR", "Z": "WR", "H": "WR",
}


def _get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:                                   # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def _ascii(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()


def norm(name):
    """Match key mirroring the app's normName(): lowercase, letters+spaces only, drop
    suffixes (Jr/Sr/II…), collapse spaces. Keeps the single space so keys match the frontend
    (and the NFL depth chart), e.g. 'jayden maiava'."""
    s = re.sub(r"[^a-z ]", "", _ascii(name).lower())
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def tnorm(s):
    return " ".join("".join(c if c.isalnum() else " " for c in _ascii(s).lower()).split())


def clean_name(raw):
    """'Russell, Keelon RS FR' -> 'Keelon Russell'. Strips HTML, the trailing class-year
    (FR/SO/JR/SR/GR, optional RS prefix and /TR transfer tag), then flips 'Last, First'."""
    s = html.unescape(re.sub(r"<[^>]+>", "", raw))
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\s+(RS\s+)?(FR|SO|JR|SR|GR)(/[A-Z]{2,})?\s*$", "", s).strip()
    if "," in s:
        last, first = s.split(",", 1)
        s = f"{first.strip()} {last.strip()}"
    return re.sub(r"\s+", " ", s).strip()


def team_index():
    """[(display_name, slug, id)] for every team on the depth-chart index mega-menu."""
    idx = _get(BASE)
    out = []
    # Each team block: <div class='nfl-dc-mm-team-name'>NAME </div> ... depth-chart.aspx?s=SLUG&id=ID
    for m in re.finditer(
        r"nfl-dc-mm-team-name'>([^<]+)</div>.*?depth-chart\.aspx\?s=([^&']+)&id=(\d+)", idx, re.S):
        out.append((html.unescape(m.group(1)).strip(), m.group(2), m.group(3)))
    return out


def parse_depth(page):
    """{ 'QB':[...], 'RB':[...], 'WR':[...], 'TE':[...] } starter-first, from a team page.
    WR spots are collapsed round-robin (each spot's starter before any spot's backup)."""
    spots = {}   # our-pos -> list of per-spot ordered lists
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if not tds:
            continue
        label = re.sub(r"<[^>]+>", "", html.unescape(tds[0])).strip().upper()
        grp = POS_MAP.get(label)
        if not grp:
            continue
        names = [clean_name(a) for a in re.findall(r"<a[^>]*>(.*?)</a>", row, re.S)]
        names = [n for n in names if n and " " in n]     # real player names only
        if names:
            spots.setdefault(grp, []).append(names)
    out = {}
    for grp, lists in spots.items():
        merged, i = [], 0
        while any(i < len(l) for l in lists):            # round-robin: all WR1s, then WR2s…
            for l in lists:
                if i < len(l):
                    merged.append(l[i])
            i += 1
        # de-dup keeping order (a name can appear at two spots)
        seen, uniq = set(), []
        for n in merged:
            k = norm(n)
            if k and k not in seen:
                seen.add(k); uniq.append(n)
        out[grp] = uniq
    return out


# Ourlads display name (tnorm) -> CFBD school, where neither an exact nor a prefix match
# bridges the naming convention.
ALIAS = {
    "central florida": "UCF", "connecticut": "UConn", "hawaii": "Hawai'i",
    "miami florida": "Miami", "miami ohio": "Miami (OH)",
    "appalachian state": "App State", "north carolina state": "NC State",
    "louisiana monroe": "UL Monroe", "louisiana lafayette": "Louisiana",
    "mississippi": "Ole Miss", "southern mississippi": "Southern Miss",
    "texas san antonio": "UT San Antonio", "texas el paso": "UTEP",
    "nevada las vegas": "UNLV", "middle tennessee state": "Middle Tennessee",
    "florida international": "Florida International", "san jose state": "San José State",
}


def map_to_cfbd(index, cfbd_schools):
    """display-name -> CFBD school. Exact match wins; then prefer a CFBD name that is a prefix
    of the Ourlads name ('Miami Florida' -> 'Miami'); only fall back to the reverse ('Arizona'
    -> 'Arizona State') when nothing better exists — so 'Arizona' never steals 'Arizona State'."""
    by_tnorm = {tnorm(s): s for s in cfbd_schools}
    out = {}
    for name, slug, tid in index:
        on = tnorm(name)
        if on in ALIAS:
            out[(name, slug, tid)] = ALIAS[on]; continue
        if on in by_tnorm:                                   # exact
            out[(name, slug, tid)] = by_tnorm[on]; continue
        best, best_kind, best_len = None, 9, 0
        for cn, sc in by_tnorm.items():
            if on.startswith(cn + " "):                      # Ourlads is more specific
                kind, ln = 0, len(cn)
            elif cn.startswith(on + " "):                    # Ourlads is less specific (risky)
                kind, ln = 1, -len(cn)
            else:
                continue
            if kind < best_kind or (kind == best_kind and ln > best_len):
                best, best_kind, best_len = sc, kind, ln
        out[(name, slug, tid)] = best
    return out


def scrape_all(cfbd_schools, delay=0.6, log=lambda *a: None):
    """{ cfbd_school: {QB:[...],RB:[...],WR:[...],TE:[...]} } for every team we can map."""
    index = team_index()
    log(f"  {len(index)} teams on the Ourlads index")
    cmap = map_to_cfbd(index, cfbd_schools)
    depth = {}
    for (name, slug, tid), school in cmap.items():
        if not school:
            log(f"  ! no CFBD match for '{name}'"); continue
        try:
            page = _get(f"{BASE}depth-chart.aspx?s={urllib.parse.quote(slug)}&id={tid}")
            d = parse_depth(page)
            if d:
                depth[school] = d
        except Exception as e:                                   # noqa: BLE001
            log(f"  ! {school} ({slug}) failed: {e}")
        time.sleep(delay)
    return depth


def to_rank_map(depth):
    """Flatten to { normName: {team, pos, rank} } for the frontend slot tags."""
    out = {}
    for team, groups in depth.items():
        for pos, names in groups.items():
            for i, n in enumerate(names):
                k = norm(n)
                if k and k not in out:
                    out[k] = {"team": team, "pos": pos, "rank": i + 1}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--probe", metavar="SLUG", help="scrape one team by Ourlads slug and print")
    ap.add_argument("--out", default="web/lib/ncaafDepth.ts")
    args = ap.parse_args(argv)

    import odds_client as oc
    import cfbd_client as cc
    oc.ensure_ssl_certs()

    if args.probe:
        idx = {s: (n, i) for n, s, i in team_index()}
        if args.probe not in idx:
            print("slug not found; sample:", list(idx)[:8]); return 1
        name, tid = idx[args.probe]
        d = parse_depth(_get(f"{BASE}depth-chart.aspx?s={args.probe}&id={tid}"))
        print(name); print(json.dumps(d, indent=1)); return 0

    key = oc.load_env().get("CFBD_API_KEY")
    st, teams = cc.cfbd_get("/teams/fbs", {"year": 2026}, key)
    schools = [t.get("school") for t in teams if t.get("school")] if isinstance(teams, list) else []
    print(f"{len(schools)} FBS teams from CFBD; scraping Ourlads depth charts…")
    depth = scrape_all(schools, log=lambda *a: print(*a))
    ranks = to_rank_map(depth)
    print(f"scraped {len(depth)} teams, {len(ranks)} skill players")

    body = (
        "// AUTO-GENERATED by cfb_depth.py -- do not edit by hand.\n"
        "// Current NCAAF skill-position depth charts (Ourlads). normName -> slot; drives the\n"
        "// RB1/WR2 tags and which starters the player model projects before props post.\n"
        "export interface CfbDepthEntry { team: string; pos: string; rank: number }\n"
        "export const NCAAF_DEPTH: Record<string, CfbDepthEntry> = {\n"
        + "".join(f"  {json.dumps(k)}: {json.dumps(v)},\n" for k, v in sorted(ranks.items()))
        + "};\n"
    )
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(body)
    # also drop a json next to it for the python projector to read
    with open(os.path.join(os.path.dirname(os.path.abspath(args.out)), "..", "..", "cfb_depth.json"), "w", encoding="utf-8") as f:
        json.dump(depth, f)
    print(f"Wrote {args.out} and cfb_depth.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
