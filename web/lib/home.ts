// Home page data — assembles "The Card" (model vs market, per game) and the
// "Upsets of the Week" (underdogs the model picks to win). Server-side only.
//
// Sources, all already published elsewhere in the app:
//   - fetchModelWeek  → the locked line-blind predictions (margin + favored + market compare)
//   - buildBoard      → the market's spread + total consensus per game
//   - MODEL_TOTALS    → the model's own total (combined points), static per week
// Nothing is fabricated: model columns are null until the week's predictions lock.

import { weekRange, currentWeek, fetchWeek, buildBoard, type Game } from "./board";
import { fetchModelWeek, type ModelPrediction } from "./model";
import { MODEL_TOTALS } from "./modelTotals";
import { weekTailgate } from "./tailgate";

export interface CardRow {
  eventId: string;
  away: string;
  home: string;
  commence: string;
  marketSpread: string | null; // favored side, e.g. "BAL -2.5"
  modelSpread: string | null;  // model's favored side, e.g. "BAL -3.1"
  marketTotal: number | null;
  modelTotal: number | null;
  off: boolean;                // model and market disagree on the side
}

export interface UpsetRow {
  eventId: string;
  dog: string;      // the underdog the model backs
  matchup: string;  // e.g. "at Packers" / "vs Texans"
  spread: string | null; // the dog's market spread, e.g. "+3"
  modelPct: number; // model's win prob for the dog (%)
  marketPct: number;// market-implied win prob for the dog (%)
  byPoints: number; // model's margin for the dog
}

export interface PlayerPick {
  id: string;
  player: string;
  team: string;
  angle: string;      // the prop the boards are buzzing, e.g. "OVER 74.5 rush yds"
  sources: string[];  // boards/blogs the player was mentioned on
}

export interface HomeData {
  week: number;
  season: number;
  hasModel: boolean; // any locked predictions for the week yet
  card: CardRow[];
  upsets: UpsetRow[];
  players: PlayerPick[]; // a few risers from Fan Stock — teaser into Fan Analysis
}

/** "FAV -mag" from a home-perspective consensus spread (negative = home favored). */
function fmtMarketSpread(g: Game): string | null {
  const c = g.spread.consensus;
  if (c === null) return null;
  if (c === 0) return "Pick'em";
  const fav = c < 0 ? g.home : g.away;
  return `${fav} -${Math.abs(c)}`;
}

export async function fetchHome(season = 2026): Promise<HomeData> {
  // Show the CURRENT NFL week (rotates as the season moves), clamped to weeks we
  // actually have odds for. Falls back to the earliest available week.
  let week = 1;
  try {
    const [cur, range] = await Promise.all([currentWeek(season), weekRange(season)]);
    week = cur ?? range?.min ?? 1;
    if (range) week = Math.min(range.max, Math.max(range.min, week));
  } catch { /* default week 1 */ }

  // Market board (present well before kickoff) + locked model predictions (may be empty).
  let board: Game[] = [];
  try { board = buildBoard(await fetchWeek(week, season)); } catch { board = []; }
  let preds: ModelPrediction[] = [];
  try { preds = await fetchModelWeek(week, season); } catch { preds = []; }

  const predByEvent = new Map(preds.map((p) => [p.eventId, p]));

  const card: CardRow[] = board.map((g) => {
    const p = predByEvent.get(g.eventId);
    const modelSpread = p ? `${p.favored} -${Math.abs(p.predMargin).toFixed(1)}` : null;
    // MODEL_TOTALS is keyed away-home; fall back to the reversed order so a home/away
    // ordering difference between the odds feed and the schedule still resolves.
    const modelTotal = MODEL_TOTALS[`${week}-${g.away}-${g.home}`]
      ?? MODEL_TOTALS[`${week}-${g.home}-${g.away}`] ?? null;
    return {
      eventId: g.eventId,
      away: g.away,
      home: g.home,
      commence: g.commence,
      marketSpread: fmtMarketSpread(g),
      modelSpread,
      marketTotal: g.total.consensus,
      modelTotal,
      off: p?.disagree ?? false,
    };
  });

  // Upsets: off-consensus games where the model's pick is the market's underdog.
  const spreadMag = new Map(board.map((g) => [g.eventId, g.spread.consensus]));
  const upsets: UpsetRow[] = preds
    .filter((p) => p.disagree && p.marketFavored !== null && p.marketFavProb !== null)
    .map((p) => {
      const dogIsHome = p.favored === p.home;
      const modelPct = Math.round((dogIsHome ? p.homeWinProb : 1 - p.homeWinProb) * 100);
      const marketPct = Math.round((1 - (p.marketFavProb as number)) * 100);
      const c = spreadMag.get(p.eventId);
      const spread = c === null || c === undefined ? null
        : `+${Math.abs(c)}`;
      return {
        eventId: p.eventId,
        dog: p.favored,
        matchup: dogIsHome ? `vs ${p.away}` : `at ${p.home}`,
        spread,
        modelPct,
        marketPct,
        byPoints: Math.abs(p.predMargin),
      };
    })
    // biggest model-vs-market gap first — the juiciest alerts lead.
    .sort((a, z) => (z.modelPct - z.marketPct) - (a.modelPct - a.marketPct));

  // A few players fans are highest on (Fan Stock risers) — a teaser, not our pick.
  let players: PlayerPick[] = [];
  try {
    const tg = await weekTailgate(week, season);
    players = tg.buzz
      .filter((b) => b.direction === "up")
      .sort((a, z) => z.heat - a.heat)
      .slice(0, 3)
      .map((b) => ({
        id: b.id, player: b.player, team: b.team, angle: b.angle,
        sources: b.sources.map((s) => s.board),
      }));
  } catch { players = []; }

  return { week, season, hasModel: preds.length > 0, card, upsets, players };
}
