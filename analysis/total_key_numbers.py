"""
Are there "key numbers" for game TOTALS the way there are for spreads (3, 7)?
Measure the distribution of total points (home+away) and the push value at each
whole number — P(total lands exactly on N) — so we only ever flag a total sweet
spot on numbers that actually carry value, with the honest value attached.

    python analysis/total_key_numbers.py
"""
import pandas as pd

g = pd.read_csv("data/games.csv", low_memory=False)
s = g[(g.game_type == "REG") & g.home_score.notna()].copy()
s["total"] = s.home_score + s.away_score
n = len(s)
print(f"REG games with scores: {n}  ({int(s.season.min())}-{int(s.season.max())})\n")

vc = s["total"].value_counts().sort_index()
freq = (vc / n * 100).round(2)

print("Top 12 most common totals (push value = P(total == N)):")
top = freq.sort_values(ascending=False).head(12)
for tot, pct in top.items():
    print(f"  {int(tot):>3}  {pct:>5.2f}%")

# For comparison: spread key numbers from EMPIRICAL are 3 = 9.0%, 7 = 6.2%.
print("\nCumulative share of the top 6 totals:",
      f"{top.head(6).sum():.1f}%")
print("For reference, margin lands on 3 in 15.0% and 7 in 9.1% of games.")

# Value of a whole-number total vs its neighbors (is N a genuine spike?)
print("\nSpike check — is each top whole total a local peak vs N-1 and N+1?")
for tot in sorted(top.head(8).index):
    tot = int(tot)
    here = freq.get(tot, 0)
    lo = freq.get(tot - 1, 0)
    hi = freq.get(tot + 1, 0)
    peak = "PEAK" if here > lo and here > hi else "flat"
    print(f"  {tot:>3}: {here:>4.2f}%   (N-1 {lo:>4.2f}, N+1 {hi:>4.2f})  {peak}")
