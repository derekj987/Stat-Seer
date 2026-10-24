"""
inseason_weight_sweep.py -- is the model too slow to believe this season? Sweep before answering.

    python analysis/inseason_weight_sweep.py

Written for Derek's week-6 question: "Have we been using in-season data? We need to adjust our
model." The answer is yes, and no adjustment is available — EMPIRICAL_REFERENCE §21 has the
numbers. This script is kept so the sweep is one command rather than a session.

Walk-forward and strictly no look-ahead: every game is predicted from the weeks BEFORE it, with
the prior season as the only outside input. The three knobs are the ones game_model.py actually
exposes — PRIOR_K (how much last season still counts), REGRESS (how far a rating gap is shrunk
toward the mean) and HFA.

🚨 READ THE PER-SEASON COLUMNS, NOT THE MEAN. The shipped settings are within 0.03-0.08 points of
the best on every season tested, and the per-season optimum WANDERS (best PRIOR_K is 2, 3 and 8 on
2024/2025/2026). That wandering on a flat curve is the signal that these are not levers. Picking a
season's winner is fitting that season's noise, which is the mistake this file exists to prevent.
"""
import csv, collections, statistics as st
G=[]
for r in csv.DictReader(open('data/games.csv',encoding='utf-8')):
    if r.get('game_type')!='REG' or r.get('result') in (None,'','NA'): continue
    try:
        G.append(dict(season=int(r['season']),week=int(r['week']),home=r['home_team'],away=r['away_team'],
                      hs=int(r['home_score']),as_=int(r['away_score']),
                      neutral=str(r.get('location','')).lower()=='neutral'))
    except (TypeError,ValueError): continue

def prior_means(season):
    d=collections.defaultdict(list)
    for g in G:
        if g['season']==season: d[g['home']].append(g['hs']-g['as_']); d[g['away']].append(g['as_']-g['hs'])
    return {t: st.fmean(v) for t,v in d.items() if v}

def run(season,K,regress,hfa):
    prior=prior_means(season-1); cur=collections.defaultdict(list); errs=[]
    for g in sorted([x for x in G if x['season']==season],key=lambda x:x['week']):
        rt={}
        for t in set(list(cur)+list(prior)):
            c=cur.get(t,[]); n=len(c)
            rt[t]=(n*(st.fmean(c) if c else 0.0)+K*prior.get(t,0.0))/(n+K)
        h=0.0 if g['neutral'] else hfa
        pred=regress*(rt.get(g['home'],0.0)-rt.get(g['away'],0.0))+h
        a=g['hs']-g['as_']; errs.append(abs(pred-a))
        cur[g['home']].append(a); cur[g['away']].append(-a)
    return st.fmean(errs)

SEASONS=(2023,2024,2025,2026)
print("REGRESS sweep (K=5, HFA=2.0) — MAE per season")
print(f"{'REGRESS':>9}" + "".join(f"{s:>9}" for s in SEASONS) + f"{'mean':>9}")
for rg in (0.45,0.55,0.60,0.65,0.70,0.80,0.95):
    v=[run(s,5.0,rg,2.0) for s in SEASONS]
    tag='  <- shipped' if abs(rg-0.65)<1e-9 else ''
    print(f"{rg:>9.2f}" + "".join(f"{x:>9.3f}" for x in v) + f"{st.fmean(v):>9.3f}{tag}")
print()
print("HFA sweep (K=5, REGRESS=0.65)")
print(f"{'HFA':>9}" + "".join(f"{s:>9}" for s in SEASONS) + f"{'mean':>9}")
for h in (0.5,1.0,1.5,2.0,2.5,3.0):
    v=[run(s,5.0,0.65,h) for s in SEASONS]
    tag='  <- shipped' if abs(h-2.0)<1e-9 else ''
    print(f"{h:>9.1f}" + "".join(f"{x:>9.3f}" for x in v) + f"{st.fmean(v):>9.3f}{tag}")
print()
# what home field ACTUALLY was
for s in SEASONS:
    gs=[g for g in G if g['season']==s and not g['neutral']]
    print(f"   {s}: actual mean home margin {st.fmean(g['hs']-g['as_'] for g in gs):+.2f}  (n={len(gs)})")
