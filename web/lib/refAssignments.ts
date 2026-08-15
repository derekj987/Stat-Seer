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
  return out;
}
