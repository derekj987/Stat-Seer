"""
Resolve scraped player names to gsis_id.

Practice reports and pressers give you "T. Hill" or "Tyreek Hill" or
"Hill, Tyreek". The panel needs gsis_id. This is the unglamorous plumbing that
determines whether the collected data is usable at all -- an unresolved name is
a hole in the panel, and holes are invisible until a backtest silently drops rows.

Strategy, in order:
  1. exact match on display_name within team
  2. exact match on "First Last" reconstruction within team
  3. last-name + first-initial within team + position
  4. fuzzy (token-set ratio) within team, above threshold
  5. league-wide fuzzy above a HIGHER threshold (players get cut mid-week)
  6. give up -> alias queue for manual review

Anything resolved below full confidence is recorded with its score so the
queue can be audited.
"""
import re
import unicodedata
from difflib import SequenceMatcher
import pandas as pd

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def norm(s):
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace(".", " ").replace("'", "").replace("-", " ")
    toks = [t for t in re.split(r"\s+", s) if t and t not in SUFFIXES]
    return " ".join(toks)


def flip_if_comma(name):
    """'Hill, Tyreek' -> 'Tyreek Hill'"""
    if "," in name:
        parts = [p.strip() for p in name.split(",", 1)]
        if len(parts) == 2 and parts[1]:
            return f"{parts[1]} {parts[0]}"
    return name


def ratio(a, b):
    return SequenceMatcher(None, a, b).ratio()


class PlayerResolver:
    def __init__(self, players_df):
        p = players_df.copy()
        p = p[p.gsis_id.notna()]
        p["n_display"] = p.display_name.map(norm)
        p["n_first"] = p.first_name.map(norm)
        p["n_last"] = p.last_name.map(norm)
        p["n_football"] = p.get("football_name", p.display_name).map(norm)
        self.p = p
        self.by_team = {t: d for t, d in p.groupby(
            p.latest_team.fillna("__NONE__"))}

    # ------------------------------------------------------------------
    def resolve(self, scraped_name, team=None, position=None):
        raw = flip_if_comma(str(scraped_name).strip())
        n = norm(raw)
        if not n:
            return None, 0.0, "empty"

        pools = []
        if team and team in self.by_team:
            pools.append(("team", self.by_team[team]))
        pools.append(("league", self.p))

        for scope, pool in pools:
            thresh = 0.86 if scope == "team" else 0.94

            # 1 / 2: exact on display or football name
            hit = pool[(pool.n_display == n) | (pool.n_football == n)]
            if len(hit) == 1:
                return hit.iloc[0].gsis_id, 1.0, f"exact_{scope}"
            if len(hit) > 1 and position:
                hp = hit[hit.position == position]
                if len(hp) == 1:
                    return hp.iloc[0].gsis_id, 1.0, f"exact_{scope}_pos"

            # 3: last name + first initial
            toks = n.split()
            if len(toks) >= 2:
                last = toks[-1]
                fi = toks[0][0]
                cand = pool[(pool.n_last == last)
                            & (pool.n_first.str.startswith(fi, na=False))]
                if position is not None and len(cand) > 1:
                    cand = cand[cand.position == position]
                if len(cand) == 1:
                    return cand.iloc[0].gsis_id, 0.95, f"initial_{scope}"

            # 4 / 5: fuzzy
            sub = pool
            if position:
                pos_sub = pool[pool.position == position]
                if len(pos_sub) > 0:
                    sub = pos_sub
            best_id, best_score = None, 0.0
            for _, row in sub.iterrows():
                sc = max(ratio(n, row.n_display), ratio(n, row.n_football))
                if sc > best_score:
                    best_id, best_score = row.gsis_id, sc
            if best_score >= thresh:
                return best_id, round(best_score, 3), f"fuzzy_{scope}"

        return None, 0.0, "unresolved"


# ----------------------------------------------------------------- self-test
if __name__ == "__main__":
    p = pd.read_csv("../data/players.csv", low_memory=False)
    r = PlayerResolver(p)

    # realistic scraped-name variants an injury report actually produces
    cases = [
        ("Patrick Mahomes", "KC", "QB"),
        ("P. Mahomes", "KC", "QB"),
        ("Mahomes, Patrick", "KC", None),
        ("Travis Kelce", "KC", "TE"),
        ("T. Kelce", "KC", "TE"),
        ("Ja'Marr Chase", "CIN", "WR"),
        ("JaMarr Chase", "CIN", "WR"),
        ("Amon-Ra St. Brown", "DET", "WR"),
        ("Amon Ra St Brown", "DET", "WR"),
        ("Christian McCaffrey", "SF", "RB"),
        ("C. McCaffrey", "SF", None),
        ("Brian Robinson Jr.", None, "RB"),
        ("Odell Beckham", None, "WR"),
        ("Nonexistent Player", "KC", "QB"),
    ]
    print(f"{'scraped name':<26}{'team':>6}{'resolved':>14}"
          f"{'score':>8}  method")
    print("-" * 78)
    ok = 0
    for name, team, pos in cases:
        gid, score, method = r.resolve(name, team, pos)
        disp = ""
        if gid:
            row = p[p.gsis_id == gid]
            if len(row):
                disp = row.iloc[0].display_name
            ok += 1
        print(f"{name:<26}{str(team):>6}{str(gid or '-'):>14}"
              f"{score:>8.3f}  {method}"
              + (f"  -> {disp}" if disp else ""))
    print(f"\nresolved {ok}/{len(cases)} "
          f"(the last case is expected to fail)")
