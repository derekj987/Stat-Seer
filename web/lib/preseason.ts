// Preseason "test-run" sandbox model — server-side. Mirrors analysis/game_model.py
// (rating = mean point differential, heavily shrunk) but on preseason box scores
// from the ISOLATED preseason_team_games table. This is a walled-off machinery
// demo: never published as a StatSeer prediction, never graded, never calibrated.

const REGRESS_PRE = 0.35; // shrink harder than the real model — preseason is noisier
const SHRINK_K = 2.0;     // sample-size shrink: n games count n/(n+K)

export interface PreRating {
  team: string;
  gp: number;
  rawDiff: number; // mean point differential (unshrunk)
  rating: number;  // shrunk rating used for "predictions"
}

interface TeamGameRow {
  team: string;
  points_for: number | null;
  points_against: number | null;
}

async function pgFrom(table: string, path: string): Promise<unknown[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return (await res.json()) as unknown[];
}

/** Shrunk preseason ratings, best-first. Empty array when no preseason data yet. */
export async function fetchPreseasonRatings(season = 2026): Promise<PreRating[]> {
  let rows: TeamGameRow[];
  try {
    rows = (await pgFrom("preseason_team_games",
      `?season=eq.${season}&select=team,points_for,points_against`)) as TeamGameRow[];
  } catch {
    return [];
  }
  const diff = new Map<string, number>();
  const cnt = new Map<string, number>();
  for (const r of rows) {
    if (r.points_for === null || r.points_against === null) continue;
    diff.set(r.team, (diff.get(r.team) ?? 0) + (r.points_for - r.points_against));
    cnt.set(r.team, (cnt.get(r.team) ?? 0) + 1);
  }
  const out: PreRating[] = [];
  for (const [team, d] of diff) {
    const n = cnt.get(team)!;
    const rawDiff = d / n;
    const rating = rawDiff * (n / (n + SHRINK_K));
    out.push({ team, gp: n, rawDiff, rating });
  }
  out.sort((a, b) => b.rating - a.rating);
  return out;
}
