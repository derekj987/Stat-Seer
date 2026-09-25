// The Model — reads PUBLISHED line-blind predictions from the ledger + calibration.
// Server-side only (Supabase service key). Predictions are never recomputed here;
// they're read exactly as they were locked before kickoff.

import { fetchWeek, implied, median, type OddsRow } from "./board";

/** Which published model the board reads. Bumped when the METHOD changes, so old predictions stay
 *  attributed to the method that made them and calibration is never computed across two of them.
 *
 *  Must match analysis/game_model.MODEL_VERSION, and it can only be raised once rows for the new
 *  version actually exist in the ledger — fetchModelWeek returns [] for a version with no rows, so
 *  bumping first would blank the board.
 *
 *  v3 -> v4 (2026-09-05): adds an injury correction — points off a team's margin for the SHARE of
 *  its volume that is ruled out, by position (QB/RB/WR/TE). Held-out 2023-2025: MAE 10.303 ->
 *  10.239, Brier .2240 -> .2224, and exactly 0.000 change on the 289 games where nobody was out.
 *  Currently contributes nothing — no 2026 injury reports are filed yet — and activates on its own
 *  once nflverse publishes them, which is why v4's Week 1 numbers equal v3's.
 *
 *  v2 -> v3 (2026-09-05): v2 rated teams on LAST season's point differential only, so it produced
 *  the same number for a given matchup every day of the season. v3 blends the current season in as
 *  results arrive. On held-out 2023-2025: margin MAE 11.095 -> 10.303, calibration -1.5 -> +0.0,
 *  Brier .2420 -> .2240 (closing line 9.744 — still sharper, as it should be). The v1/v2 rows stay
 *  in the ledger as the record of what was claimed on 2026-08-14. */
export const MODEL_VERSION = "game-v4-injury";

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
    `?section=eq.MODEL&season=eq.${season}&week=eq.${week}&model_version=eq.${MODEL_VERSION}` +
    `&select=event_id,subject,model_prob,commence_time,published_at,reasoning&order=published_at`);
  if (!preds.length) return [];

  // The ledger is append-only and a game is REPUBLISHED when its number genuinely moves -- a
  // starting quarterback going on injured reserve, say. So a week can hold several rows for one
  // game, and what a reader must see is the CURRENT one. Ordered by published_at ascending, the
  // last write per event wins; the superseded rows stay on the record, which is the point of
  // publishing this way rather than overwriting.
  const latest = new Map<string, Record<string, unknown>>();
  for (const p of preds) latest.set(`${p.event_id}|${p.subject}`, p);
  const current = [...latest.values()].sort((a, b) =>
    String(a.commence_time).localeCompare(String(b.commence_time)));

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

  return current.map((p) => {
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
