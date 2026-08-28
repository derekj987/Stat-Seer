// Player "slot" tag — position + depth-chart rank, e.g. "RB1", "WR2", "QB1". Shown next to a
// player's name on prop boards and baked into slip legs so a pick reads "CJ Bailey (QB1) O 237.5".
// Server-side only (imports the full depth chart + projection tables).
import { DEPTH } from "./depthChart";
import { NCAAF_PLAYER_PROJECTIONS } from "./ncaafPlayerProjections";

// Same normalization the depth chart is keyed by (lowercase, strip punctuation + Jr/Sr/III…).
export const normName = (n: string) =>
  (n || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();

// NFL: the depth chart already carries position + rank.
function nflSlot(name: string): string | null {
  const e = DEPTH[normName(name)];
  return e ? `${e.pos}${e.rank}` : null;
}

// NCAAF: no published depth chart, so infer it — rank players within their (team, position)
// by their headline yardage line (starters carry higher lines than backups). Built once.
const VOL = new Set(["pass_yds", "rush_yds", "rec_yds"]);
const ncaafSlots: Map<string, string> = (() => {
  const byPlayer = new Map<string, { team: string; pos: string; score: number }>();
  for (const r of NCAAF_PLAYER_PROJECTIONS) {
    const prev = byPlayer.get(r.player);
    const score = VOL.has(r.market) ? r.book : -1;
    if (!prev) byPlayer.set(r.player, { team: r.team, pos: r.pos, score });
    else if (score > prev.score) prev.score = score;
  }
  const groups = new Map<string, { player: string; score: number }[]>();
  for (const [player, v] of byPlayer) {
    const k = `${v.team}|${v.pos}`;
    const arr = groups.get(k) ?? [];
    arr.push({ player, score: v.score });
    groups.set(k, arr);
  }
  const out = new Map<string, string>();
  for (const [k, arr] of groups) {
    const pos = k.split("|")[1];
    arr.sort((a, b) => b.score - a.score);
    arr.forEach((x, i) => out.set(normName(x.player), `${pos}${i + 1}`));
  }
  return out;
})();

export function playerSlot(name: string, base: "nfl" | "ncaaf"): string | null {
  return base === "ncaaf" ? ncaafSlots.get(normName(name)) ?? null : nflSlot(name);
}
