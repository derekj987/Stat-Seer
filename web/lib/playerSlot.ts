// Player "slot" tag — position + depth-chart rank, e.g. "RB1", "WR2", "QB1". Shown next to a
// player's name on prop boards and baked into slip legs so a pick reads "CJ Bailey (QB1) O 237.5".
// Server-side only (imports the full depth chart + projection tables).
import { DEPTH } from "./depthChart";
import { NCAAF_DEPTH } from "./ncaafDepth";

// Same normalization the depth charts are keyed by (lowercase, strip punctuation + Jr/Sr/III…).
export const normName = (n: string) =>
  (n || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();

// Both leagues now have a real depth chart: NFL from nflverse, NCAAF scraped (Ourlads).
function slot(entry: { pos: string; rank: number } | undefined): string | null {
  return entry ? `${entry.pos}${entry.rank}` : null;
}

export function playerSlot(name: string, base: "nfl" | "ncaaf"): string | null {
  const key = normName(name);
  return base === "ncaaf" ? slot(NCAAF_DEPTH[key]) : slot(DEPTH[key]);
}

// The player's team, from the same depth-chart entry — so prop rows can read "Drake Maye (QB1, NE)"
// like the Model chart does. The odds feed only carries the two teams per GAME, not per player, so
// the depth chart is where a player-level team comes from.
export function playerTeam(name: string, base: "nfl" | "ncaaf"): string | null {
  const key = normName(name);
  const entry = base === "ncaaf" ? NCAAF_DEPTH[key] : DEPTH[key];
  return entry?.team ?? null;
}
