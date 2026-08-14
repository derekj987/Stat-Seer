// The Model — reads PUBLISHED line-blind predictions from the ledger + calibration.
// Server-side only (Supabase service key). Predictions are never recomputed here;
// they're read exactly as they were locked before kickoff.

import { fetchWeek, implied, median, type OddsRow } from "./board";

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
  // Market comparison (current de-vigged moneyline). null when no odds captured.
  marketFavored: string | null;
  marketFavProb: number | null;
  disagree: boolean;
}

/** De-vigged market win prob for the home team, medianed across books (same
 * method Value Finder uses for its fair-price check). null if no h2h prices. */
function marketHomeProb(rows: OddsRow[], home: string, away: string): number | null {
  const byBook: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (r.market !== "h2h") continue;
    (byBook[r.book] ??= {})[r.outcome_name] = r.price_american;
  }
  const fair: number[] = [];
  for (const sides of Object.values(byBook)) {
    if (!(home in sides) || !(away in sides)) continue;
    const pH = implied(sides[home]);
    const pA = implied(sides[away]);
    const s = pH + pA;
    if (s > 0) fair.push(pH / s);
  }
  return fair.length ? median(fair) : null;
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

  // One consistent snapshot of the week's odds — gives us both team names and the
  // current de-vigged moneyline to compare each locked prediction against.
  let odds: OddsRow[] = [];
  try {
    odds = await fetchWeek(week, season);
  } catch {
    odds = [];
  }
  const teams = new Map<string, { home: string; away: string }>();
  const oddsByEvent = new Map<string, OddsRow[]>();
  for (const r of odds) {
    if (!teams.has(r.event_id)) teams.set(r.event_id, { home: r.home_team, away: r.away_team });
    (oddsByEvent.get(r.event_id) ?? oddsByEvent.set(r.event_id, []).get(r.event_id)!).push(r);
  }

  return preds.map((p) => {
    const reason = (p.reasoning ?? {}) as Record<string, unknown>;
    const id = p.event_id as string;
    const t = teams.get(id) ?? { home: p.subject as string, away: "?" };
    const favored = (reason.favored as string) ?? t.home;

    const mHome = marketHomeProb(oddsByEvent.get(id) ?? [], t.home, t.away);
    const marketFavored = mHome === null ? null : mHome >= 0.5 ? t.home : t.away;
    const marketFavProb = mHome === null ? null : mHome >= 0.5 ? mHome : 1 - mHome;

    return {
      eventId: id,
      home: t.home,
      away: t.away,
      commence: p.commence_time as string,
      homeWinProb: Number(p.model_prob),
      predMargin: Number(reason.pred_margin ?? 0),
      favored,
      neutral: Boolean(reason.neutral),
      venue: (reason.venue as string) ?? null,
      publishedAt: p.published_at as string,
      marketFavored,
      marketFavProb,
      disagree: marketFavored !== null && marketFavored !== favored,
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
