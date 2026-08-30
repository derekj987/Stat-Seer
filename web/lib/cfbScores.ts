// Server-side CFB scores for the NCAAF boards. Fetches ESPN's public college-football scoreboard
// for a week (cached ~30s via ISR) and matches games to the model's team names. Rendered into the
// game cells on the server, so it works without any client hydration; a page load/refresh shows the
// latest score (final, live-as-of-load, or nothing for upcoming games).

export interface CfbScore {
  awayScore: number | null;
  homeScore: number | null;
  live: boolean;      // game in progress
  detail: string;     // "Final" | "Q3 5:23" | ...
}

interface Raw {
  away: string[]; home: string[];
  awayScore: number | null; homeScore: number | null;
  state: string; detail: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type Team = { location?: string; abbreviation?: string; shortDisplayName?: string; displayName?: string; name?: string };
const names = (t?: Team) =>
  [t?.location, t?.abbreviation, t?.shortDisplayName, t?.displayName, t?.name].filter(Boolean) as string[];

export async function fetchCfbScores(week: number, year = 2026): Promise<Raw[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard` +
    `?year=${year}&seasontype=2&week=${week}&groups=80&limit=300`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 30 } });
    if (!res.ok) return [];
    const d = await res.json();
    const events = Array.isArray(d.events) ? d.events : [];
    return events.map((e: Record<string, unknown>) => {
      const ev = e as { competitions?: { competitors?: { homeAway?: string; score?: string; team?: Team }[] }[]; status?: { type?: { state?: string; shortDetail?: string } } };
      const comps = ev.competitions?.[0]?.competitors ?? [];
      const home = comps.find((c) => c.homeAway === "home");
      const away = comps.find((c) => c.homeAway === "away");
      const st = ev.status?.type ?? {};
      return {
        away: names(away?.team), home: names(home?.team),
        awayScore: away?.score != null ? Number(away.score) : null,
        homeScore: home?.score != null ? Number(home.score) : null,
        state: st.state ?? "pre",
        detail: st.shortDetail ?? "",
      } as Raw;
    }).filter((g: Raw) => g.home.length > 0 && g.away.length > 0);
  } catch { return []; }
}

/** Match a model game (by team names) to a fetched score. null for no match or an upcoming game. */
export function scoreFor(scores: Raw[], away: string, home: string): CfbScore | null {
  const a = norm(away), h = norm(home);
  const g = scores.find((x) => x.away.some((n) => norm(n) === a) && x.home.some((n) => norm(n) === h));
  if (!g || g.state === "pre") return null;   // upcoming games already show a kickoff time
  return { awayScore: g.awayScore, homeScore: g.homeScore, live: g.state === "in", detail: g.detail };
}

export type CfbScores = Awaited<ReturnType<typeof fetchCfbScores>>;
