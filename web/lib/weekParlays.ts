// THE one definition of "this week's tickets".
//
// 🚨 WHY THIS IS A MODULE AND NOT THREE LINES IN THE PAGE. Two things now need the selection: the
// board that shows it, and the publisher that locks it into parlay_ledger before kickoff. If each
// kept its own copy, the published record and the rendered card would drift apart at the first
// change to either — and a graded record that does not match what the reader was shown is worse
// than no record at all, because it looks like evidence.
//
// `assembleParlays` is pure and takes data the caller already has, so the board pays for no extra
// read; `buildWeekParlays` fetches first, for the publisher, which has nothing in hand.
import { fetchWeek, buildBoard, type Game } from "./board";
import { fetchModelWeek, type ModelPrediction } from "./model";
import { weekProps, type PropGame } from "./props";
import { candidateLegs, pickParlays, type Parlay } from "./parlayOfWeek";
import { propLegs, TD_MARKETS, SKILL_MARKETS } from "./propParlay";

/** The three tickets, in the order they are shown. One ticket each, so the ticket TYPES are what
 *  differ rather than three variations on the same market. */
export function assembleParlays(
  built: Game[],
  preds: ModelPrediction[],
  propGames: PropGame[],
  now = new Date(),
): Parlay[] {
  return [
    ...pickParlays(candidateLegs(built, preds, now), 1).map((p) => ({ ...p, title: "Game lines" })),
    ...pickParlays(propLegs(propGames, TD_MARKETS, now), 1).map((p) => ({ ...p, title: "Player touchdowns" })),
    ...pickParlays(propLegs(propGames, SKILL_MARKETS, now), 1).map((p) => ({ ...p, title: "Player props" })),
  ];
}

/** Same selection, fetching its own inputs. Each read is wrapped the way the board wraps it: a
 *  feed that is down costs the tickets it feeds, never the whole publish. */
export async function buildWeekParlays(week: number, season: number, now = new Date()): Promise<Parlay[]> {
  let built: Game[] = [];
  try { built = buildBoard(await fetchWeek(week, season)); } catch { built = []; }
  let preds: ModelPrediction[] = [];
  try { preds = await fetchModelWeek(week, season); } catch { preds = []; }
  let propGames: PropGame[] = [];
  try { propGames = await weekProps(week, season); } catch { propGames = []; }
  return assembleParlays(built, preds, propGames, now);
}
