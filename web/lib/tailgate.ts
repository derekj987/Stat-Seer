// Tailgate — fan-sentiment feed. This is deliberately NON-quantitative: it is a
// digest of what fans are saying on team message boards about players who might
// pop this week. It is NOT a StatSeer pick, not model output, and is never graded
// against results. It informs a member's own judgment — "more ammo" — nothing more.
//
// Phase 1 (now): a curated feed, hand-seeded below. Phase 2: an automated scan
// (Reddit team subreddits first, then select fan forums) → Claude extraction →
// this same shape. Keeping the type stable now means the page never changes when
// the live pipeline lands.

/** Move magnitude, like a stock's swing — how loud/strong the sentiment is. */
export type Heat = 1 | 2 | 3; // 1 slight · 2 notable · 3 strong

/** Which way the fan sentiment is pointing — bullish (up) or bearish (down). */
export type Direction = "up" | "down";

export interface BuzzSource {
  board: string;      // e.g. "r/BuffaloBills" or "Bills Mafia forum"
  url?: string;       // link back to the thread, when we have one
}

export interface Buzz {
  id: string;
  player: string;
  team: string;       // fan team, e.g. "Bills"
  matchup?: string;   // e.g. "BUF vs NYJ"
  angle: string;      // the prop fans are pointing at, e.g. "OVER 62.5 receiving yards"
  direction: Direction; // up = fans bullish; down = fans souring / production trending down
  heat: Heat;         // magnitude of the move (in either direction)
  take: string;       // what the boards are actually saying, and why
  sources: BuzzSource[];
  book?: string;      // sportsbook the prop is quoted at (illustrative in the seed;
                      // the real book comes from the live prop board when it matches)
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
    book: "DraftKings",
    direction: "up",
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
    book: "FanDuel",
    direction: "up",
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
    book: "BetMGM",
    direction: "up",
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
    book: "Caesars",
    direction: "up",
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
    book: "DraftKings",
    direction: "up",
    heat: 1,
    take:
      "Red-zone whispers on the Cowboys boards — fans have noticed the TE getting goal-line looks " +
      "in camp reports and think an early-season score is coming. Low-volume take, high upside if right.",
    sources: [
      { board: "r/cowboys" },
    ],
  },
  {
    id: "w1-pickens",
    player: "George Pickens",
    team: "Steelers",
    matchup: "PIT vs ATL",
    angle: "UNDER 58.5 receiving yards",
    book: "FanDuel",
    direction: "down",
    heat: 2,
    take:
      "Steelers boards are cooling on Pickens — recurring frustration about the target share drying up " +
      "and the offense running through other reads. 'Don't trust the volume right now' is the mood, not a blowup.",
    sources: [
      { board: "r/steelers" },
    ],
  },
  {
    id: "w1-gibbs",
    player: "Jahmyr Gibbs",
    team: "Lions",
    matchup: "DET vs GB",
    angle: "UNDER 68.5 rushing yards",
    book: "BetMGM",
    direction: "down",
    heat: 1,
    take:
      "Quiet worry on the Lions boards about a committee week and a tough front — a few threads flag the " +
      "rushing line as high if the game scripts pass-heavy. Soft signal, fans just less sure than usual.",
    sources: [
      { board: "r/detroitlions" },
    ],
  },
];

// Server-side read of the automated feed (Supabase `tailgate_buzz`, written by
// tailgate_reddit.py). Falls back to the seed when no rows exist yet or the read
// fails — so preseason and any hiccup just show the sample feed, never an error.
interface BuzzRow {
  id: string; player: string; team: string; matchup: string | null;
  angle: string; direction: string | null; heat: Heat; take: string; sources: BuzzSource[] | null;
}

async function fetchBuzz(week: number, season: number): Promise<Buzz[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return [];
  const q = `?season=eq.${season}&week=eq.${week}` +
    `&select=id,player,team,matchup,angle,direction,heat,take,sources&order=heat.desc`;
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/tailgate_buzz${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = (await res.json()) as BuzzRow[];
  return rows.map((r) => ({
    id: r.id, player: r.player, team: r.team,
    matchup: r.matchup ?? undefined,
    angle: r.angle,
    // Legacy rows written before the up/down split default to bullish.
    direction: r.direction === "down" ? "down" : "up",
    heat: r.heat, take: r.take,
    sources: r.sources ?? [],
  }));
}

// A buzz item only earns a spot if it maps to an ACTUAL sportsbook market — an
// anytime-TD (ATTD), or an over/under on a stat line. Narrative chatter with no
// bet attached ("breakout season expected", "named the starting QB") is trivia:
// it doesn't help the bottom line, so it never surfaces as a "player we like".
// Real sportsbook markets we recognize — passing/rushing/receiving volume &
// yardage, TDs, INTs, longest. A bettable angle names one of these AND a
// direction (over/under, or an anytime/first-TD), with or without a cited line.
const PROP_MARKET =
  /\b(rec(eption)?s?|catches|targets|rush(ing)?|carries|attempts?|att|pass(ing)?|completions?|comp|yards?|yds?|touchdowns?|tds?|interceptions?|ints?|longest)\b/i;

export function isBettableAngle(angle: string): boolean {
  const s = angle.trim();
  // TD markets stand on their own — no number needed.
  if (/\banytime\s+td\b|\battd\b|\banytime\s+touchdown\b|\bfirst\s+td\b/i.test(s)) return true;
  // Otherwise: a direction (OVER/UNDER, or bare "O 5.5"/"U 22") on a named market.
  const hasDir = /\b(over|under)\b/i.test(s) || /\b[ou]\s*\d/i.test(s);
  return hasDir && PROP_MARKET.test(s);
}

/** The week's fan feed — the live scan if it has anything, else the seed. Only
 *  bettable angles survive, so every card lines a fan take up with a real prop. */
export async function weekTailgate(week: number, season: number): Promise<TailgateWeek> {
  try {
    const buzz = (await fetchBuzz(week, season)).filter((b) => isBettableAngle(b.angle));
    if (buzz.length) return { week, season, sample: false, buzz };
  } catch { /* fall through to the seed */ }
  return { week, season, sample: true, buzz: SEED.filter((b) => isBettableAngle(b.angle)) };
}

// Stock-ticker labels — a bullish/bearish word scaled by how strong the move is.
const STOCK_LABEL: Record<Direction, Record<Heat, string>> = {
  up:   { 1: "Ticking up", 2: "Rising", 3: "Surging" },
  down: { 1: "Slipping", 2: "Sliding", 3: "Tanking" },
};

/** Human label for a fan-stock move, e.g. up+3 → "Surging", down+2 → "Sliding". */
export function stockLabel(direction: Direction, heat: Heat): string {
  return STOCK_LABEL[direction][heat];
}

/** Stacked stock arrows for a move — ▲ per unit up, ▼ per unit down. */
export function stockArrows(direction: Direction, heat: Heat): string {
  return (direction === "up" ? "▲" : "▼").repeat(heat);
}
