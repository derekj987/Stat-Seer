// Data sources the AI chart-builder can draw from. The AI never invents data — it only picks a
// source + options; we fetch the REAL StatSeer numbers here and shape them into a table. Keeping the
// menu fixed is what keeps the builder honest (and cheap: the model just parses intent).
import { weekProps } from "./props";
import { fetchWeek, buildBoard, weekRange, fmtOdds } from "./board";
import { cfbWeekProps } from "./cfbProps";
import { fetchModelWeek } from "./model";
import { auditVerdict, impliedProb, probToAmerican } from "./fairValue";

export type ChartType = "table" | "bar";
export interface ChartSpec {
  title: string;
  chartType: ChartType;
  source: ChartSourceId;
  sport?: "nfl" | "ncaaf";
  limit?: number;
}
export interface ChartData {
  title: string;
  chartType: ChartType;
  columns: string[];
  rows: (string | number)[][];
  note?: string;
}

export const CHART_SOURCES = {
  auditor_deals: "The best-priced player props right now, checked against the de-vigged fair price (Pick Auditor). Columns: Player, Bet, Book price, Fair price, Deal.",
  best_props: "Player props where one book is priced well above the field — the biggest line-shopping edges. Columns: Player, Bet, Best price, Book, Edge %.",
  value_lines: "The best available spread/total prices across books on this week's games, with the shopping edge. Columns: Game, Bet, Best price, Book, Edge %.",
  model_covers: "StatSeer's line-blind MODEL read of each game — its projected spread, which side of the market spread the model projects to cover, and its projected winner + win %. This is our published, publicly-graded model output (not a bet recommendation). Use this when the member asks what the model projects, who it likes to cover, or who it has winning. Columns: Game, Model spread, Model covers, Model winner.",
} as const;
export type ChartSourceId = keyof typeof CHART_SOURCES;

const SEASON = 2026;
const SHOP_WIN = 0.02;

async function curWeek(): Promise<number> {
  try { return (await weekRange(SEASON))?.min ?? 1; } catch { return 1; }
}
function shopEdge(price: number, byBook?: Record<string, number>): number {
  const others = byBook ? Object.values(byBook) : [];
  if (others.length < 2) return 0;
  const avg = others.reduce((s, p) => s + impliedProb(p), 0) / others.length;
  return avg - impliedProb(price);
}
function betLabel(marketLabel: string, side: string, line: number | null): string {
  if (side === "Yes") return marketLabel;
  if (side === "No") return `No — ${marketLabel}`;
  if (side === "Over" || side === "Under") return `${side} ${line ?? ""}`.trim();
  return line !== null ? `${side} ${line}` : side;
}

export async function buildChart(spec: ChartSpec): Promise<ChartData> {
  const sport = spec.sport === "ncaaf" ? "ncaaf" : "nfl";
  const limit = Math.min(Math.max(spec.limit ?? 12, 3), 40);
  const week = await curWeek();

  if (spec.source === "auditor_deals" || spec.source === "best_props") {
    const games = sport === "ncaaf" ? await cfbWeekProps() : await weekProps(week, SEASON);
    type Row = { player: string; bet: string; price: number; fair: number | null; edge: number; verdictScore: number; deal: string };
    const rows: Row[] = [];
    for (const g of games) for (const m of g.markets) for (const q of m.quotes) {
      const a = auditVerdict(q.price, q.fairProb);
      const se = shopEdge(q.price, q.byBook);
      const isValue = (a && a.verdict === "value") || se >= SHOP_WIN;
      const deal = isValue ? "✓ Value" : a?.verdict === "cheat" ? "⚠ Overpriced" : "Fair";
      rows.push({
        player: q.slot ? `${q.player} (${q.slot})` : q.player,
        bet: betLabel(m.label, q.side, q.line),
        price: q.price,
        fair: q.fairProb != null ? probToAmerican(q.fairProb) : null,
        edge: Math.max(se, a ? a.edgePct : 0),
        verdictScore: isValue ? 2 : a?.verdict === "fair" ? 1 : 0,
        deal,
      });
    }
    if (spec.source === "auditor_deals") {
      const deals = rows.filter((r) => r.verdictScore === 2).sort((a, b) => b.edge - a.edge).slice(0, limit);
      return {
        title: spec.title || "Best deals on the Pick Auditor",
        chartType: "table",
        columns: ["Player", "Bet", "Book price", "Fair price", "Deal"],
        rows: deals.map((r) => [r.player, r.bet, fmtOdds(r.price), r.fair != null ? fmtOdds(r.fair) : "—", r.deal]),
        note: deals.length ? undefined : "No clear-value props right now — the market's efficient this week.",
      };
    }
    const best = rows.filter((r) => r.edge > 0).sort((a, b) => b.edge - a.edge).slice(0, limit);
    return {
      title: spec.title || "Biggest prop shopping edges",
      chartType: spec.chartType === "bar" ? "bar" : "table",
      columns: ["Player", "Bet", "Best price", "Edge %"],
      rows: best.map((r) => [r.player, r.bet, fmtOdds(r.price), Number((r.edge * 100).toFixed(1))]),
    };
  }

  if (spec.source === "model_covers") {
    const [preds, board] = await Promise.all([
      fetchModelWeek(week, SEASON).catch(() => []),
      fetchWeek(week, SEASON).then(buildBoard).catch(() => []),
    ]);
    const spreadByEvent = new Map(board.map((g) => [g.eventId, g.spread.consensus]));
    const rows = preds
      .filter((p) => p.favored)
      .map((p) => {
        const spread = spreadByEvent.get(p.eventId) ?? null; // home perspective, negative = home favored
        let covers = "—";
        if (spread != null) {
          const mag = Math.abs(spread);
          const marketFavHome = spread < 0;
          const fav = marketFavHome ? p.home : p.away;
          const dog = marketFavHome ? p.away : p.home;
          const modelMarginForFav = marketFavHome ? p.predMargin : -p.predMargin;
          covers = mag < 0.5 ? "pick'em" : modelMarginForFav >= mag ? `${fav} -${mag.toFixed(1)}` : `${dog} +${mag.toFixed(1)}`;
        }
        const winPct = Math.round((p.favored === p.home ? p.homeWinProb : 1 - p.homeWinProb) * 100);
        return {
          game: `${p.away} @ ${p.home}`,
          modelSpread: `${p.favored} -${Math.abs(p.predMargin).toFixed(1)}`,
          covers,
          winner: `${p.favored} (${winPct}%)`,
          margin: Math.abs(p.predMargin),
        };
      })
      .sort((a, b) => b.margin - a.margin)
      .slice(0, limit);
    return {
      title: spec.title || `What the Model projects — Week ${week}`,
      chartType: "table",
      columns: ["Game", "Model spread", "Model covers", "Model winner"],
      rows: rows.map((r) => [r.game, r.modelSpread, r.covers, r.winner]),
      note: rows.length ? "Line-blind model — published and graded in the open." : "No model reads published for this week yet.",
    };
  }

  // value_lines — best spread/total prices across books, by shopping edge.
  const board = buildBoard(await fetchWeek(week, SEASON));
  type LineRow = { game: string; bet: string; price: number; book: string; edge: number };
  const out: LineRow[] = [];
  for (const g of board) {
    const add = (bet: string, ln: { point: number | null; price: number; books: string[]; byBook: Record<string, number> } | null) => {
      if (!ln) return;
      const se = shopEdge(ln.price, ln.byBook);
      out.push({ game: g.matchup, bet: `${bet} ${ln.point ?? ""}`.trim(), price: ln.price, book: ln.books[0] ?? "", edge: se });
    };
    add(`${g.home}`, g.spread.home); add(`${g.away}`, g.spread.away);
    add("Over", g.total.over); add("Under", g.total.under);
  }
  const best = out.filter((r) => r.edge > 0).sort((a, b) => b.edge - a.edge).slice(0, limit);
  return {
    title: spec.title || "Best line-shopping value this week",
    chartType: "table",
    columns: ["Game", "Bet", "Best price", "Book", "Edge %"],
    rows: best.map((r) => [r.game, r.bet, fmtOdds(r.price), r.book, Number((r.edge * 100).toFixed(1))]),
  };
}
