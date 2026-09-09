// Per-game referee crew (captured game-week). Joined to REF_STATS so the Context
// page can show the crew's real penalty tendency as a factor. Honest: penalties are
// a mild tendency; we never claim the crew corroborates a pick.
import { REF_STATS, REF_LEAGUE } from "./refStats";

export interface CrewFactor { referee: string; pen: number; tendency: "flag-happy" | "flag-light" | "average" }

const byName = new Map(REF_STATS.map((s) => [s.name, s]));

/** home_team -> crew factor, for a given week. Empty until assignments post. */
export async function weekRefs(week: number, season = 2026): Promise<Map<string, CrewFactor>> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const out = new Map<string, CrewFactor>();
  if (!url || !key) return out;
  try {
    const res = await fetch(
      `${url.replace(/\/$/, "")}/rest/v1/ref_assignments?season=eq.${season}&week=eq.${week}` +
      `&select=home_team,referee`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" },
    );
    if (!res.ok) return out; // table may not exist yet
    const rows = (await res.json()) as { home_team: string; referee: string }[];
    for (const r of rows) {
      const pen = byName.get(r.referee)?.pen ?? REF_LEAGUE.pen;
      const tendency = pen >= REF_LEAGUE.pen + 1 ? "flag-happy"
        : pen <= REF_LEAGUE.pen - 1 ? "flag-light" : "average";
      out.set(r.home_team, { referee: r.referee, pen, tendency });
    }
  } catch {
    /* ignore — no crews shown */
  }
  // The table is the history; ESPN is what makes the card work THIS week.
  //
  // publish_ref_assignments.py sources the crew from nflverse games.csv, and its own docstring
  // flagged the risk: "if nflverse turns out to fill `referee` only post-game, we swap the
  // source." It does. Measured: 272 of 272 games carry a referee for 2023, 2024 and 2025 — all
  // played — and 0 of 272 for 2026. So that capture can only ever produce a crew for a game that
  // has already happened, which is worthless as pre-game context, and the daily workflow has been
  // writing nothing while looking healthy.
  //
  // ESPN publishes the assigned crew BEFORE kickoff (gameInfo.officials, position "Referee").
  // Verified on the 2026 Week 1 NE @ SEA game hours before kick: Adrian Hill.
  await addEspnCrews(out, season, week);
  return out;
}

interface EspnOfficial { fullName?: string; position?: { name?: string } }

// ESPN abbreviates two clubs differently from nflverse; see nflInactives.ts.
const TEAM_ALIAS: Record<string, string> = { LAR: "LA", WSH: "WAS" };

async function addEspnCrews(out: Map<string, CrewFactor>, season: number, week: number) {
  const j = async (u: string, revalidate: number) => {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate } });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  };
  const board = await j(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
    `?year=${season}&seasontype=2&week=${week}`, 900);
  const events = (board?.events ?? []) as { id?: string; competitions?: {
    competitors?: { homeAway?: string; team?: { abbreviation?: string } }[] }[] }[];
  if (!events.length) return;
  await Promise.all(events.map(async (e) => {
    if (!e.id) return;
    const comps = e.competitions?.[0]?.competitors ?? [];
    const home = comps.find((c) => c.homeAway === "home")?.team?.abbreviation;
    if (!home) return;
    const team = TEAM_ALIAS[home] ?? home;
    if (out.has(team)) return;                        // our own capture wins if we have it
    const s = await j(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${e.id}`, 900);
    const officials = (s?.gameInfo?.officials ?? []) as EspnOfficial[];
    // The CREW CHIEF is the one REF_STATS is keyed on — a crew's penalty tendency is recorded
    // against its referee, not its side judge. Taking officials[0] would have grabbed whoever
    // ESPN happened to list first (a Field Judge, on the game checked).
    const ref = officials.find((o) => o.position?.name === "Referee")?.fullName;
    if (!ref) return;
    const pen = byName.get(ref)?.pen ?? REF_LEAGUE.pen;
    const tendency = pen >= REF_LEAGUE.pen + 1 ? "flag-happy"
      : pen <= REF_LEAGUE.pen - 1 ? "flag-light" : "average";
    out.set(team, { referee: ref, pen, tendency });
  }));
}
