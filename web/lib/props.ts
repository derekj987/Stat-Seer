import { deVig } from "@/lib/fairValue";
// Player-props line shopping — reads prop_snapshots, best price per player across books.
// Server-side only (Supabase service key).

export const PROP_LABELS: Record<string, string> = {
  player_anytime_td: "ATTD",
  player_1st_td: "1st TD",
  player_last_td: "Last TD",
  player_pass_yds: "Pass Yds",
  player_pass_tds: "Pass TDs",
  player_pass_completions: "Comp",
  player_pass_attempts: "Pass Att",
  player_pass_interceptions: "Int",
  player_pass_longest_completion: "Long Comp",
  player_rush_yds: "Rush Yds",
  player_rush_attempts: "Rush Att",
  player_rush_longest: "Long Rush",
  player_reception_yds: "Rec Yds",
  player_receptions: "Rec",
  player_reception_longest: "Long Rec",
  player_rush_reception_yds: "Rush+Rec Yds",
  player_pass_rush_reception_yds: "Pass+Rush+Rec Yds",
  player_pass_rush_reception_tds: "Pass+Rush+Rec TDs",
  player_kicking_points: "Kick Pts",
  player_field_goals: "FG",
  player_pats: "XP",
  player_tackles_assists: "Tack+Ast",
  player_sacks: "Sacks",
  player_solo_tackles: "Solo Tack",
  player_defensive_interceptions: "Int (Def)",
};
const marketLabel = (k: string) => PROP_LABELS[k] ?? k.replace(/^player_/, "").replace(/_/g, " ");

export interface Category { key: string; label: string; markets: string[] }
export const CATEGORIES: Category[] = [
  { key: "td", label: "Touchdowns", markets: ["player_anytime_td", "player_1st_td", "player_last_td"] },
  { key: "passing", label: "Passing", markets: ["player_pass_yds", "player_pass_tds", "player_pass_completions", "player_pass_attempts", "player_pass_interceptions", "player_pass_longest_completion"] },
  { key: "rushing", label: "Rushing", markets: ["player_rush_yds", "player_rush_attempts", "player_rush_longest"] },
  { key: "receiving", label: "Receiving", markets: ["player_reception_yds", "player_receptions", "player_reception_longest"] },
];
export const categoryByKey = (k: string): Category => CATEGORIES.find((c) => c.key === k) ?? CATEGORIES[0];

interface PropRow {
  snapshot_at: string;
  event_id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  book: string;
  market: string;
  player_name: string;
  side: string; // Over / Under / Yes / No
  line: number | null;
  price_american: number;
}

export interface Quote {
  player: string;
  market: string;
  side: string;
  line: number | null;
  price: number; // best across books
  books: string[]; // books at that price
  byBook: Record<string, number>; // every book's price — needed for single-book parlays
  eventId: string;
  slot?: string; // position + depth rank, e.g. "RB1" — attached by the page for display
  team?: string; // player's team, e.g. "NE" — also attached by the page (the feed has teams per game,
                 // not per player), so a row can read "Drake Maye (QB1, NE)" like the Model chart
  fairProb?: number | null; // Pick Auditor: de-vigged fair probability of THIS side (null if one-sided)
}
export interface MarketBlock {
  market: string;
  label: string;
  quotes: Quote[]; // sorted by best price (bettor-favorable) desc
}
export interface PropGame {
  eventId: string;
  matchup: string;
  home: string;
  away: string;
  commence: string;
  snapshot: string;
  markets: MarketBlock[];
}

async function pgAll(query: string): Promise<PropRow[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const base = `${url.replace(/\/$/, "")}/rest/v1/prop_snapshots${query}`;
  const out: PropRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(base, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + PAGE - 1}`,
        "Range-Unit": "items",
      },
      next: { revalidate: 120 },
    });
    if (!res.ok && res.status !== 206) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const page = (await res.json()) as PropRow[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

// Is quote `a` a better bet for the member than `b`? (Same player + side.) For Over, the
// lower line is easier; for Under, the higher line; ties (or no line, e.g. ATTD) break on
// the better price. Mirrors the game-board "best number, then best price" logic.
function isBetter(a: Quote, b: Quote): boolean {
  if (a.line !== null && b.line !== null && a.line !== b.line) {
    if (a.side === "Over") return a.line < b.line;
    if (a.side === "Under") return a.line > b.line;
  }
  return a.price > b.price;
}
// Collapse every book/line for a player+side down to the single best selection.
function collapseBest(quotes: Quote[]): Quote[] {
  const best = new Map<string, Quote>();
  for (const q of quotes) {
    const k = `${q.player}|${q.side}`;
    const prev = best.get(k);
    if (!prev || isBetter(q, prev)) best.set(k, q);
  }
  return [...best.values()].sort((a, b) => a.player.localeCompare(b.player) || a.side.localeCompare(b.side));
}

export async function weekProps(week: number, season = 2026): Promise<PropGame[]> {
  const rows = await pgAll(
    `?season=eq.${season}&week=eq.${week}&event_id=neq.test` + // exclude the dev test row
      `&select=snapshot_at,event_id,commence_time,home_team,away_team,book,market,` +
      `player_name,side,line,price_american&order=snapshot_at.desc`
  );
  if (!rows.length) return [];

  // Keep the latest snapshot per (event,market,player,side,line,book).
  const latest = new Map<string, PropRow>();
  for (const r of rows) {
    const k = `${r.event_id}|${r.market}|${r.player_name}|${r.side}|${r.line}|${r.book}`;
    const prev = latest.get(k);
    if (!prev || r.snapshot_at > prev.snapshot_at) latest.set(k, r);
  }

  // Collect every book's price per (event,market,player,side,line).
  const agg = new Map<string, { r: PropRow; byBook: Record<string, number> }>();
  for (const r of latest.values()) {
    const k = `${r.event_id}|${r.market}|${r.player_name}|${r.side}|${r.line}`;
    let a = agg.get(k);
    if (!a) {
      a = { r, byBook: {} };
      agg.set(k, a);
    }
    a.byBook[r.book] = r.price_american;
  }

  // Pick Auditor: de-vig each two-sided market (same line, per book) into a fair probability.
  // Key: event|market|player|side|line -> fair probability of that side.
  const OPP: Record<string, string> = { Over: "Under", Under: "Over", Yes: "No", No: "Yes" };
  const byLine = new Map<string, Record<string, Record<string, number>>>(); // event|market|player|line -> side -> byBook
  for (const [k, a] of agg) {
    const parts = k.split("|"); // event|market|player|side|line
    const side = parts[3], line = parts[4];
    const lk = `${parts[0]}|${parts[1]}|${parts[2]}|${line}`;
    (byLine.get(lk) ?? byLine.set(lk, {}).get(lk)!)[side] = a.byBook;
  }
  const fairProb = new Map<string, number>();
  for (const [lk, sides] of byLine) {
    const [ev, mk, pl, line] = lk.split("|");
    for (const side of Object.keys(sides)) {
      const opp = OPP[side];
      if (!opp || !sides[opp]) continue;
      const mine = sides[side], theirs = sides[opp];
      const ps: number[] = [];
      for (const book of Object.keys(mine)) if (theirs[book] != null) ps.push(deVig(mine[book], theirs[book]));
      if (ps.length) fairProb.set(`${ev}|${mk}|${pl}|${side}|${line}`, ps.reduce((x, y) => x + y, 0) / ps.length);
    }
  }

  // Group into games -> markets -> quotes (best price derived from byBook).
  const games = new Map<string, PropGame>();
  const marketMap = new Map<string, Map<string, Quote[]>>(); // eventId -> market -> quotes
  for (const a of agg.values()) {
    const r = a.r;
    const entries = Object.entries(a.byBook);
    const best = Math.max(...entries.map(([, p]) => p));
    const books = entries.filter(([, p]) => p === best).map(([b]) => b).sort();
    if (!games.has(r.event_id)) {
      games.set(r.event_id, {
        eventId: r.event_id, matchup: `${r.away_team} @ ${r.home_team}`,
        home: r.home_team, away: r.away_team, commence: r.commence_time,
        snapshot: r.snapshot_at, markets: [],
      });
      marketMap.set(r.event_id, new Map());
    }
    const mm = marketMap.get(r.event_id)!;
    if (!mm.has(r.market)) mm.set(r.market, []);
    mm.get(r.market)!.push({
      player: r.player_name, market: r.market, side: r.side, line: r.line,
      price: best, books, byBook: a.byBook, eventId: r.event_id,
      fairProb: fairProb.get(`${r.event_id}|${r.market}|${r.player_name}|${r.side}|${r.line}`) ?? null,
    });
  }

  const out: PropGame[] = [];
  for (const g of games.values()) {
    const mm = marketMap.get(g.eventId)!;
    g.markets = [...mm.entries()]
      .map(([market, quotes]) => ({
        market, label: marketLabel(market),
        // one row per player+side — the single best line/book across all books
        quotes: collapseBest(quotes),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    out.push(g);
  }
  out.sort((a, b) => a.commence.localeCompare(b.commence));
  return out;
}
