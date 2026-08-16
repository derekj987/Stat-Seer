// Tailgate — fan-sentiment feed. This is deliberately NON-quantitative: it is a
// digest of what fans are saying on team message boards about players who might
// pop this week. It is NOT a StatSeer pick, not model output, and is never graded
// against results. It informs a member's own judgment — "more ammo" — nothing more.
//
// Phase 1 (now): a curated feed, hand-seeded below. Phase 2: an automated scan
// (Reddit team subreddits first, then select fan forums) → Claude extraction →
// this same shape. Keeping the type stable now means the page never changes when
// the live pipeline lands.

/** Fan hype level. Deliberately subjective — this is vibe, not a probability. */
export type Heat = 1 | 2 | 3; // 1 simmering · 2 heating up · 3 on fire

export interface BuzzSource {
  board: string;      // e.g. "r/BuffaloBills" or "Bills Mafia forum"
  url?: string;       // link back to the thread, when we have one
}

export interface Buzz {
  id: string;
  player: string;
  team: string;       // fan team, e.g. "Bills"
  matchup?: string;   // e.g. "BUF vs NYJ"
  angle: string;      // the over fans are buzzing, e.g. "OVER 62.5 receiving yards"
  heat: Heat;
  take: string;       // what the boards are actually saying, and why
  sources: BuzzSource[];
}

export interface TailgateWeek {
  week: number;
  season: number;
  /** true until the live fan scan is deployed — the page shows a clear sample banner. */
  sample: boolean;
  buzz: Buzz[];
}

// --- Seed feed (sample) -----------------------------------------------------
// Illustrative entries that show the format. Preseason, so there is no real
// board chatter yet; the live scan replaces these once it is deployed. Board
// names are examples of WHERE each item would be sourced.
const SEED: Buzz[] = [
  {
    id: "w1-cook",
    player: "James Cook",
    team: "Bills",
    matchup: "BUF vs NYJ",
    angle: "OVER 74.5 rushing yards",
    heat: 3,
    take:
      "Bills boards are loud on Cook this week — the read is a heavy early-down script " +
      "against a front they think Buffalo can move, with fans expecting a lead-and-run game " +
      "into the fourth quarter. Recurring theme: 'get the ball to Cook and salt it away.'",
    sources: [
      { board: "r/BuffaloBills" },
      { board: "Bills Mafia forum" },
    ],
  },
  {
    id: "w1-flowers",
    player: "Zay Flowers",
    team: "Ravens",
    matchup: "BAL vs CLE",
    angle: "OVER 5.5 receptions",
    heat: 2,
    take:
      "Ravens fans keep pointing at Flowers as the short-area outlet if the game scripts pass-heavy. " +
      "Less about a blowup line, more a steady target-share bet — 'he's going to see 8+ looks.'",
    sources: [
      { board: "r/ravens" },
    ],
  },
  {
    id: "w1-mbs",
    player: "Marvin Mims Jr.",
    team: "Broncos",
    matchup: "DEN vs TEN",
    angle: "OVER 38.5 receiving yards",
    heat: 2,
    take:
      "A genuine sleeper buzz — Broncos boards think Mims has carved out a bigger role and like his " +
      "matchup against the slot. Classic 'nobody's talking about him but us' thread energy.",
    sources: [
      { board: "r/DenverBroncos" },
      { board: "MileHighReport community" },
    ],
  },
  {
    id: "w1-mooney",
    player: "Darnell Mooney",
    team: "Falcons",
    matchup: "ATL vs CAR",
    angle: "OVER 44.5 receiving yards",
    heat: 1,
    take:
      "Quieter chatter, but a few Falcons threads flag Mooney as the deep-shot beneficiary if " +
      "the offense opens it up. Simmering, not consensus — worth watching, not leaning on.",
    sources: [
      { board: "r/falcons" },
    ],
  },
  {
    id: "w1-schoonmaker",
    player: "Luke Schoonmaker",
    team: "Cowboys",
    matchup: "DAL vs NYG",
    angle: "ANYTIME TD",
    heat: 1,
    take:
      "Red-zone whispers on the Cowboys boards — fans have noticed the TE getting goal-line looks " +
      "in camp reports and think an early-season score is coming. Low-volume take, high upside if right.",
    sources: [
      { board: "r/cowboys" },
    ],
  },
];

// Server-side read of the automated feed (Supabase `tailgate_buzz`, written by
// tailgate_reddit.py). Falls back to the seed when no rows exist yet or the read
// fails — so preseason and any hiccup just show the sample feed, never an error.
interface BuzzRow {
  id: string; player: string; team: string; matchup: string | null;
  angle: string; heat: Heat; take: string; sources: BuzzSource[] | null;
}

async function fetchBuzz(week: number, season: number): Promise<Buzz[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return [];
  const q = `?season=eq.${season}&week=eq.${week}` +
    `&select=id,player,team,matchup,angle,heat,take,sources&order=heat.desc`;
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/tailgate_buzz${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = (await res.json()) as BuzzRow[];
  return rows.map((r) => ({
    id: r.id, player: r.player, team: r.team,
    matchup: r.matchup ?? undefined,
    angle: r.angle, heat: r.heat, take: r.take,
    sources: r.sources ?? [],
  }));
}

/** The week's fan feed — the live scan if it has anything, else the seed. */
export async function weekTailgate(week: number, season: number): Promise<TailgateWeek> {
  try {
    const buzz = await fetchBuzz(week, season);
    if (buzz.length) return { week, season, sample: false, buzz };
  } catch { /* fall through to the seed */ }
  return { week, season, sample: true, buzz: SEED };
}

export const HEAT_LABEL: Record<Heat, string> = {
  1: "Simmering",
  2: "Heating up",
  3: "On fire",
};
