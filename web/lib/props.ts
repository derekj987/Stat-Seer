// Player-props line shopping — reads prop_snapshots, best price per player across books.
// Server-side only (Supabase service key).

export const PROP_LABELS: Record<string, string> = {
  player_anytime_td: "Anytime TD",
  player_pass_yds: "Passing Yards",
  player_pass_tds: "Passing TDs",
  player_rush_yds: "Rushing Yards",
  player_reception_yds: "Receiving Yards",
  player_receptions: "Receptions",
  player_rush_reception_yds: "Rush + Rec Yards",
};
const marketLabel = (k: string) => PROP_LABELS[k] ?? k.replace(/^player_/, "").replace(/_/g, " ");

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
  side: string;
  line: number | null;
  price: number; // best across books
  books: string[]; // books at that price
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

export async function weekProps(week: number, season = 2026): Promise<PropGame[]> {
  const rows = await pgAll(
    `?season=eq.${season}&week=eq.${week}` +
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

  // Best price per (event,market,player,side,line) across books.
  type Agg = { r: PropRow; price: number; books: Set<string> };
  const best = new Map<string, Agg>();
  for (const r of latest.values()) {
    const k = `${r.event_id}|${r.market}|${r.player_name}|${r.side}|${r.line}`;
    const a = best.get(k);
    if (!a) best.set(k, { r, price: r.price_american, books: new Set([r.book]) });
    else if (r.price_american > a.price) best.set(k, { r, price: r.price_american, books: new Set([r.book]) });
    else if (r.price_american === a.price) a.books.add(r.book);
  }

  // Group into games -> markets -> quotes.
  const games = new Map<string, PropGame>();
  const marketMap = new Map<string, Map<string, Quote[]>>(); // eventId -> market -> quotes
  for (const a of best.values()) {
    const r = a.r;
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
      player: r.player_name, side: r.side, line: r.line,
      price: a.price, books: [...a.books].sort(),
    });
  }

  const out: PropGame[] = [];
  for (const g of games.values()) {
    const mm = marketMap.get(g.eventId)!;
    g.markets = [...mm.entries()]
      .map(([market, quotes]) => ({
        market, label: marketLabel(market),
        // chalk first: lowest (most negative) best-price = most likely
        quotes: quotes.sort((a, b) => a.price - b.price || a.player.localeCompare(b.player)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    out.push(g);
  }
  out.sort((a, b) => a.commence.localeCompare(b.commence));
  return out;
}
