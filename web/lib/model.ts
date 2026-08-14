// The Model — reads PUBLISHED line-blind predictions from the ledger + calibration.
// Server-side only (Supabase service key). Predictions are never recomputed here;
// they're read exactly as they were locked before kickoff.

export const MODEL_VERSION = "game-v1-powerdiff";

export interface ModelPrediction {
  eventId: string;
  home: string;
  away: string;
  commence: string;
  homeWinProb: number;
  predMargin: number;
  favored: string;
  neutral: boolean;
  venue: string | null;
  publishedAt: string;
}

export interface CalibrationRow {
  prob_bucket: number;
  mean_predicted: number;
  n: number;
  actual_rate: number | null;
  mean_clv: number | null;
}

async function pg(table: string, query: string): Promise<Record<string, unknown>[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>[];
}

export async function fetchModelWeek(week: number, season = 2026): Promise<ModelPrediction[]> {
  const preds = await pg("prediction_ledger",
    `?section=eq.MODEL&season=eq.${season}&week=eq.${week}` +
    `&select=event_id,subject,model_prob,commence_time,published_at,reasoning&order=commence_time`);
  if (!preds.length) return [];

  // event_id -> teams (from odds_snapshots; one page covers all games in a week)
  const rows = await pg("odds_snapshots",
    `?season=eq.${season}&week=eq.${week}&select=event_id,home_team,away_team&limit=1000`);
  const teams = new Map<string, { home: string; away: string }>();
  for (const r of rows) {
    const id = r.event_id as string;
    if (!teams.has(id)) teams.set(id, { home: r.home_team as string, away: r.away_team as string });
  }

  return preds.map((p) => {
    const reason = (p.reasoning ?? {}) as Record<string, unknown>;
    const t = teams.get(p.event_id as string) ?? { home: p.subject as string, away: "?" };
    return {
      eventId: p.event_id as string,
      home: t.home,
      away: t.away,
      commence: p.commence_time as string,
      homeWinProb: Number(p.model_prob),
      predMargin: Number(reason.pred_margin ?? 0),
      favored: (reason.favored as string) ?? t.home,
      neutral: Boolean(reason.neutral),
      venue: (reason.venue as string) ?? null,
      publishedAt: p.published_at as string,
    };
  });
}

/** Calibration from the public view. Empty until games are graded — that's honest. */
export async function fetchCalibration(season = 2026): Promise<CalibrationRow[]> {
  try {
    const rows = await pg("public_calibration",
      `?season=eq.${season}&section=eq.MODEL&order=prob_bucket`);
    return rows as unknown as CalibrationRow[];
  } catch {
    return [];
  }
}
