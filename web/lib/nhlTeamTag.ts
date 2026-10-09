// Which club is this player on? — the team tag beside a name on /nhl/props.
//
// The prop feed names the two clubs in a GAME and never the club of a PLAYER, so this resolves a
// feed name against the two rosters of his own game.
//
// 🚨 THIS IS A SEPARATE MODULE FROM lib/nhlRosters.ts ON PURPOSE. That file is written by
// nhl_rosters.py and rewritten by a scheduled job; a helper added to a generated file is wiped by
// the next refresh, which has taken this project's build down before (see the AUTO-GENERATED rule).
// Data goes there, logic goes here.
//
// 🚨 A MISS IS CHEAP, A MISLABEL IS NOT. Putting "(BOS)" next to a Flyer is worse than putting
// nothing, because a reader cannot tell it is wrong. So every tier is exact string work and there
// is NO FUZZY MATCHING — an earlier cut had a 0.84-ratio fallback whose only two effects were to
// match "Damon Severson" to *Danton Heinen* and to break a tie by coin flip. Dropping it cost
// nothing: measured against all 353 (player, game) pairs on a live sweep, the tiers below resolved
// 351, and the two misses are one man.
import { NHL_TEAM_ABBREV, NHL_ROSTER } from "./nhlRosters";

/** Letters and digits only. The feed writes "St Louis Blues", the NHL writes "St. Louis Blues";
 *  this also absorbs a feed that one day drops the accent from "Montréal Canadiens". Must stay
 *  identical to team_key() in nhl_rosters.py. */
export const teamKey = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** "Elias Pettersson (2004)" → "elias pettersson". Must stay identical to player_norm(). */
export const playerNorm = (s: string) =>
  s.replace(/\(.*?\)/g, " ")
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[.]/g, " ").replace(/['’]/g, "").replace(/-/g, " ")
    .split(/\s+/).filter((t) => t && !SUFFIXES.has(t))
    .join(" ");

/** The club abbreviation for a player in a given game, or null when it cannot be known.
 *
 *  Tiers run exact name → surname + first initial → surname alone. A bare surname is safe here
 *  only because the candidate pool is ~46 players rather than the league's 772 — the game is
 *  doing most of the work, which is also why "Yegor Chinakhov" finds the NHL's "Egor Chinakhov".
 *
 *  AN AMBIGUOUS PLAYER IS STILL A GOOD TAG IF THE CLUB AGREES. Vancouver have two Elias
 *  Petterssons and the feed disambiguates one as "Elias Pettersson (2004)", so both names match
 *  both men — and both men are Canucks. A tag names a team, not a person, so a tier that cannot
 *  tell two team-mates apart still answers the question asked. It returns null only when the
 *  surviving candidates sit on DIFFERENT clubs, or when nothing matched at all (a player on
 *  long-term injury reserve is off the roster feed while books still price him). */
export function nhlTeamFor(player: string, home: string, away: string): string | null {
  const abbrs = [NHL_TEAM_ABBREV[teamKey(home)], NHL_TEAM_ABBREV[teamKey(away)]].filter(Boolean);
  if (!abbrs.length) return null;
  const n = playerNorm(player);
  const toks = n.split(" ").filter(Boolean);
  if (!toks.length) return null;
  const last = toks[toks.length - 1];
  const initial = toks[0][0];

  const tiers: Array<(name: string) => boolean> = [
    (name) => name === n,
    (name) => { const t = name.split(" "); return t[t.length - 1] === last && t[0][0] === initial; },
    (name) => { const t = name.split(" "); return t[t.length - 1] === last; },
  ];
  for (const match of tiers) {
    const hit = new Set<string>();
    for (const ab of abbrs) for (const name of NHL_ROSTER[ab] ?? []) if (match(name)) hit.add(ab);
    if (hit.size === 1) return [...hit][0];
    if (hit.size > 1) return null;   // the clubs disagree; a later tier cannot fix that
  }
  return null;
}
