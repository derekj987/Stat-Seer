// Which team is this player on? — the team tag beside a name on /nba/props.
//
// The prop feed names the two teams in a GAME and never the team of a PLAYER, so this resolves a
// feed name against the two rosters of his own game.
//
// 🚨 THIS IS A SEPARATE MODULE FROM lib/nbaRosters.ts ON PURPOSE. That file is written by
// nba_rosters.py and rewritten by a scheduled job; a helper added to a generated file is wiped by
// the next refresh, which has taken this project's build down before (see the AUTO-GENERATED rule).
// Data goes there, logic goes here.
//
// 🚨 A MISS IS CHEAP, A MISLABEL IS NOT. Putting "(MIA)" next to a Maverick is worse than putting
// nothing, because a reader cannot tell it is wrong. So every tier is exact string work and there
// is NO FUZZY MATCHING — the hockey version shipped with a 0.84-ratio fallback whose only two
// effects were to match "Damon Severson" to *Danton Heinen* and to break a genuine tie by coin
// flip. Dropping it cost nothing there and is not reintroduced here.
//
// 🚨 THE EXACT TIER RESOLVES 117 OF 117 (player, game) PAIRS on the first live NBA sweep, against
// 518 rostered players — but ONLY BECAUSE playerNorm EARNED IT. Before the initial-run merge below
// it was 116, with "C.J. McCollum" falling through to the surname tier. That one pair was worth
// chasing rather than absorbing: it was a structural disagreement between two sources about how to
// write initials, so it would have recurred for every P.J. and R.J. in the league and quietly made
// the loose tiers load-bearing.
//
// With that fixed, tiers 2 and 3 are INSURANCE, NOT LOAD-BEARING, and the distinction is worth
// keeping. Hockey genuinely needed its surname tier ("Yegor" vs the NHL's "Egor" Chinakhov) and
// still missed two players. If an NBA sweep starts leaning on tier 2 or 3, that is the feed's
// naming drifting — worth looking at rather than quietly absorbed.
import { NBA_TEAM_ABBREV, NBA_ROSTER } from "./nbaRosters";

/** Letters and digits only. Must stay identical to team_key() in nba_rosters.py. */
export const teamKey = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** "P.J. Washington" and "PJ Washington" → "pj washington"; "Tim Hardaway Jr." → "tim hardaway".
 *  Must stay identical to player_norm() in nba_rosters.py — two normalisers that only mostly agree
 *  is the worse outcome.
 *
 *  🚨 THE INITIAL-RUN MERGE IS LOAD-BEARING, NOT TIDINESS. NBA names lean on initials far harder
 *  than hockey names do, and THE TWO SOURCES DISAGREE ABOUT HOW TO WRITE THEM: the odds feed sends
 *  "C.J. McCollum" where ESPN's roster says "CJ McCollum". Dot-to-space alone gives
 *  "c j mccollum" vs "cj mccollum", which are not equal, so that pair fell through to the surname
 *  tier. Merging a run of single-letter tokens back into one is the correct reading — "C.J." and
 *  "CJ" are one name written two ways — and it generalises to every P.J., R.J., T.J. and A.J. in
 *  the league rather than special-casing one man. */
export const playerNorm = (s: string) => {
  const toks = s.replace(/\(.*?\)/g, " ")
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[.]/g, " ").replace(/['’]/g, "").replace(/-/g, " ")
    .split(/\s+/).filter((t) => t && !SUFFIXES.has(t));
  const out: string[] = [];
  let run: string[] = [];
  for (const t of toks) {
    if (t.length === 1) { run.push(t); continue; }
    if (run.length) { out.push(run.join("")); run = []; }
    out.push(t);
  }
  if (run.length) out.push(run.join(""));
  return out.join(" ");
};

/** The team abbreviation for a player in a given game, or null when it cannot be known.
 *
 *  Tiers run exact name → surname + first initial → surname alone. A bare surname is safe here
 *  only because the candidate pool is ~35 players rather than the league's 518 — the game is
 *  doing most of the work.
 *
 *  AN AMBIGUOUS PLAYER IS STILL A GOOD TAG IF THE TEAM AGREES. A tag names a team, not a person,
 *  so a tier that cannot tell two team-mates apart still answers the question asked. It returns
 *  null only when the surviving candidates sit on DIFFERENT teams, or when nothing matched at all
 *  — a player books still price while he is off the roster feed (G League assignment, a trade
 *  ESPN has not posted yet) renders with no tag, which is the honest outcome. */
export function nbaTeamFor(player: string, home: string, away: string): string | null {
  const abbrs = [NBA_TEAM_ABBREV[teamKey(home)], NBA_TEAM_ABBREV[teamKey(away)]].filter(Boolean);
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
    for (const ab of abbrs) for (const name of NBA_ROSTER[ab] ?? []) if (match(name)) hit.add(ab);
    if (hit.size === 1) return [...hit][0];
    if (hit.size > 1) return null;   // the teams disagree; a later tier cannot fix that
  }
  return null;
}
