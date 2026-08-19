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
import { weekProps } from "./props";

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
  // The model's actionable read vs the market number (null when they're within
  // half a point — i.e. the model has no real lean). Derived, tracked in public.
  spreadLean: { side: string; num: string } | null;   // e.g. { side:"NE", num:"+3.5" }
  totalLean: { dir: "OVER" | "UNDER"; num: number } | null;
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
  angle: string;      // the raw fan angle, e.g. "OVER 74.5 rush yds" (fallback text)
  dir: "up" | "down"; // over/bullish (up) vs under/bearish (down) — sets the arrow
  // The prop stated in full, so a card reads "Caleb Douglas · Over 2.5 receptions".
  // line + market come from the live prop board when the player matches; otherwise
  // they fall back to whatever the fan angle itself named.
  side: "Over" | "Under" | "Yes"; // the bet side ("Yes" = an anytime/first TD)
  line: number | null;            // the prop number, e.g. 2.5
  marketLabel: string | null;     // e.g. "receptions", "receiving yards", "anytime TD"
  book: string | null;            // sportsbook the prop is quoted at
  sources: string[];  // boards/blogs the player was mentioned on
}

// Map fan-angle wording to an odds market key + a human label. Ordered: the more
// specific "… yards" markets must be tested before the bare volume markets.
const PROP_MARKETS: [RegExp, string, string][] = [
  [/reception\s*y(ar)?ds?|receiving\s*y(ar)?ds?|\brec\s*yds?\b/i, "player_reception_yds", "receiving yards"],
  [/receptions?|catches/i, "player_receptions", "receptions"],
  [/rush(ing)?\s*y(ar)?ds?/i, "player_rush_yds", "rushing yards"],
  [/(rush(ing)?\s*(attempts?|att))|carries/i, "player_rush_attempts", "rush attempts"],
  [/pass(ing)?\s*(tds?|touchdowns?)/i, "player_pass_tds", "passing TDs"],
  [/pass(ing)?\s*y(ar)?ds?/i, "player_pass_yds", "passing yards"],
  [/interceptions?|\bints?\b/i, "player_pass_interceptions", "interceptions"],
  [/receiving\s*(tds?|touchdowns?)/i, "player_anytime_td", "receiving TD"],
];

/** Break a free-text fan angle into a bet side, a numeric line, and a market. */
function parseAngle(angle: string, dir: "up" | "down") {
  const s = angle.trim();
  const isTD = /(anytime|1st|first|last)\s*(td|touchdown)|\battd\b/i.test(s);
  const side: PlayerPick["side"] = isTD
    ? "Yes"
    : (/\bunder\b/i.test(s) || /\bu\s*\d/i.test(s) || dir === "down") ? "Under" : "Over";
  const m = s.match(/(\d+(?:\.\d+)?)/);
  const line = m ? parseFloat(m[1]) : null;
  let marketKey: string | null = null;
  let marketLabel: string | null = null;
  if (isTD) { marketKey = "player_anytime_td"; marketLabel = "anytime TD"; }
  else for (const [re, key, label] of PROP_MARKETS) {
    if (re.test(s)) { marketKey = key; marketLabel = label; break; }
  }
  // Fallback label: strip the over/under words + the number, keep what's left.
  const fallback = s.replace(/\b(over|under|o|u)\b/ig, "").replace(/\d+(\.\d+)?/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
  return { side, line, marketKey, marketLabel: marketLabel ?? (fallback || null) };
}

const normName = (n: string) =>
  n.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();

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

    // Spread lean: compare the model's margin for the MARKET's favorite against the
    // market number. Model laying more than the line → back the favorite; less (or
    // the underdog) → take the dog getting points. Only when the gap clears ½ point.
    const c = g.spread.consensus;
    let spreadLean: CardRow["spreadLean"] = null;
    if (p && c !== null && c !== 0) {
      const marketFav = c < 0 ? g.home : g.away;
      const marketDog = c < 0 ? g.away : g.home;
      const favMag = Math.abs(c);
      const modelForFav = p.favored === marketFav ? Math.abs(p.predMargin) : -Math.abs(p.predMargin);
      const edge = modelForFav - favMag;
      if (Math.abs(edge) >= 0.5) {
        spreadLean = edge > 0
          ? { side: marketFav, num: `-${favMag}` }
          : { side: marketDog, num: `+${favMag}` };
      }
    }
    // Total lean: model's combined-points read vs the market total, same ½-pt gate.
    let totalLean: CardRow["totalLean"] = null;
    if (modelTotal !== null && g.total.consensus !== null) {
      const te = modelTotal - g.total.consensus;
      if (Math.abs(te) >= 0.5) totalLean = { dir: te > 0 ? "OVER" : "UNDER", num: g.total.consensus };
    }

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
      spreadLean,
      totalLean,
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

  // A few players the boards have a real prop lean on — a teaser, not our pick.
  // weekTailgate already drops non-bettable trivia; we keep both overs (up) and
  // unders (down), loudest first, so "take the under" leans surface too. Each is
  // enriched with the actual line + sportsbook from the live prop board when the
  // player and market match; otherwise it falls back to the fan angle's own words.
  let players: PlayerPick[] = [];
  try {
    const tg = await weekTailgate(week, season);
    const top = tg.buzz.sort((a, z) => z.heat - a.heat).slice(0, 3);

    let quotes: import("./props").Quote[] = [];
    try {
      const games = await weekProps(week, season);
      quotes = games.flatMap((g) => g.markets.flatMap((m) => m.quotes));
    } catch { quotes = []; }

    players = top.map((b) => {
      const p = parseAngle(b.angle, b.direction);
      // Best-price quote for this player + market + side, if the board has it.
      const q = quotes.find((x) =>
        normName(x.player) === normName(b.player) &&
        x.market === p.marketKey &&
        x.side.toLowerCase() === p.side.toLowerCase());
      return {
        id: b.id, player: b.player, team: b.team, angle: b.angle, dir: b.direction,
        side: p.side,
        line: q?.line ?? p.line,
        marketLabel: p.marketLabel,
        book: q?.books?.[0] ?? b.book ?? null,
        sources: b.sources.map((s) => s.board),
      };
    });
  } catch { players = []; }

  return { week, season, hasModel: preds.length > 0, card, upsets, players };
}
