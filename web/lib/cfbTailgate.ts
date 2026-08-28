// CFB Local Intelligence — the college analog of lib/tailgate.ts. Same Buzz shape, same
// "sentiment not signal, never graded" framing. A digest of what fans are saying on team
// boards / r/CFB about players who might pop — ammo for a member's own research, not a pick.
//
// Phase 1 (now): a hand-seeded sample so the page reads real. Phase 2: an automated scan
// (r/CFB + team subreddits) → Claude extraction → the same `cfb_tailgate_buzz` table, exactly
// like the NFL pipeline. Keeping the type identical means the page never changes when the
// live scan lands.
import { isBettableAngle, isSidelinedForSeason, type Buzz, type TailgateWeek } from "./tailgate";

export type { Buzz, TailgateWeek } from "./tailgate";
export { stockLabel, stockArrows } from "./tailgate";

// Illustrative opening-weekend entries using real current starters, so the sample shows the
// format with names members recognize. Board names are examples of WHERE each would be sourced.
const SEED: Buzz[] = [
  {
    id: "cfb-maiava", player: "Jayden Maiava", team: "USC", matchup: "SJSU @ USC",
    angle: "OVER 284.5 passing yards", book: "DraftKings", direction: "up", heat: 3,
    take:
      "USC boards are loud on Maiava in the opener — the read is a get-right script at home against a " +
      "Group-of-Five secondary, with fans expecting the offense to air it out early and often before the " +
      "backups come in. Recurring theme: 'this is a 300-yard, four-score kind of Saturday.'",
    sources: [{ board: "r/uscfootball" }, { board: "WeAreSC boards" }],
  },
  {
    id: "cfb-payne", player: "Jeremy Payne", team: "TCU", matchup: "UNC @ TCU",
    angle: "OVER 79.5 rushing yards", book: "FanDuel", direction: "up", heat: 3,
    take:
      "The buzz all camp has been Payne taking over the backfield — fans point to the late-season carry " +
      "spike and think he's the clear lead back now, not a rotation piece. 'Give him 18+ and let him eat.'",
    sources: [{ board: "r/CFB" }, { board: "KillerFrogs community" }],
  },
  {
    id: "cfb-bailey", player: "CJ Bailey", team: "NC State", matchup: "NC State @ Virginia",
    angle: "OVER 1.5 passing TDs", book: "BetMGM", direction: "up", heat: 2,
    take:
      "Wolfpack fans are bullish on a Year-2 leap for Bailey — the read is a QB with a full offseason as " +
      "the starter and more trust to throw in the red zone. Steady confidence, not a blowup call.",
    sources: [{ board: "r/NCSU" }],
  },
  {
    id: "cfb-june", player: "Demon June", team: "North Carolina", matchup: "UNC @ TCU",
    angle: "ANYTIME TD", book: "Caesars", direction: "up", heat: 2,
    take:
      "Sleeper chatter on the UNC boards — fans like June as the goal-line and change-of-pace back and " +
      "expect him to find the end zone even in a tough road spot. 'He's the one who punches it in.'",
    sources: [{ board: "r/tarheels" }],
  },
  {
    id: "cfb-jordan", player: "Waymond Jordan", team: "USC", matchup: "SJSU @ USC",
    angle: "OVER 65.5 rushing yards", book: "DraftKings", direction: "up", heat: 1,
    take:
      "Quieter, but a few USC threads flag Jordan as the early-down back in what they expect to be a " +
      "run-it-late blowout. Simmering, not consensus — worth watching, not leaning on.",
    sources: [{ board: "r/uscfootball" }],
  },
  {
    id: "cfb-denman", player: "Jon Denman", team: "TCU", matchup: "UNC @ TCU",
    angle: "UNDER 27.5 rushing yards", book: "FanDuel", direction: "down", heat: 1,
    take:
      "TCU boards are cooling on Denman's volume with Payne ascending — recurring worry the touches dry up " +
      "in a committee. 'Don't trust the carries right now' is the mood, not a blowup.",
    sources: [{ board: "r/CFB" }],
  },
];

interface BuzzRow {
  id: string; player: string; team: string; matchup: string | null;
  angle: string; direction: string | null; heat: Buzz["heat"]; take: string;
  sources: Buzz["sources"] | null;
}

async function fetchBuzz(week: number, season: number): Promise<Buzz[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return [];
  const q = `?season=eq.${season}&week=eq.${week}` +
    `&select=id,player,team,matchup,angle,direction,heat,take,sources&order=heat.desc`;
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/cfb_tailgate_buzz${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = (await res.json()) as BuzzRow[];
  return rows.map((r) => ({
    id: r.id, player: r.player, team: r.team,
    matchup: r.matchup ?? undefined, angle: r.angle,
    direction: r.direction === "down" ? "down" : "up",
    heat: r.heat, take: r.take, sources: r.sources ?? [],
  }));
}

/** The week's CFB fan feed — the live scan if it has bettable angles, else the seed sample. */
export async function cfbWeekTailgate(week: number, season: number): Promise<TailgateWeek> {
  const keep = (b: Buzz) => isBettableAngle(b.angle) && !isSidelinedForSeason(b.take);
  try {
    const buzz = (await fetchBuzz(week, season)).filter(keep);
    if (buzz.length) return { week, season, sample: false, buzz };
  } catch { /* fall through to the seed */ }
  return { week, season, sample: true, buzz: SEED.filter(keep) };
}
