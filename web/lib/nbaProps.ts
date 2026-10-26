// NBA player props — the same board math as the NFL, NCAAF, MLB and NHL prop boards, pointed at
// nba_prop_snapshots. Value Finder is arithmetic: best price per side across books, plus the Pick
// Auditor's de-vigged fair price. No model, which is why this works on a sport whose prop history
// began on 2026-10-26.
//
// 🚨 EVERY MARKET ON THIS BOARD IS TWO-SIDED, AND THAT WAS MEASURED BEFORE THE FILE WAS WRITTEN —
// which is the one thing the NHL board could not say. Over two events, across 9 US books:
//
//     market                           sides                 lines
//     player_points                    Over 350 / Under 347  4.5 – 33.5 (30 distinct)
//     player_rebounds                  Over 216 / Under 216  1.5 – 13.5
//     player_assists                   Over 144 / Under 144  1.5 – 11.5
//     player_threes                    Over 142 / Under 142  0.5 – 3.5
//     player_blocks                    Over  12 / Under  12  0.5 – 1.5
//     player_steals                    Over   9 / Under   9  1.5 only
//     player_points_rebounds_assists   Over 188 / Under 188  11.5 – 38.5
//
// So de-vigging works everywhere here and the ✓ fair-price tag is valid on every tab. NHL needed an
// ONE_SIDED escape hatch because anytime goal scorer is quoted as a lone "Yes" (1,393 rows, not one
// "No"); basketball needs none, and no such machinery is added on the chance that it might.
//
// 🚨 DOUBLE-DOUBLE AND FIRST BASKET ARE CAPTURED BUT DELIBERATELY NOT SHOWN. Measured on the same
// probe: double-double came back Yes 100 / No 4, and first basket Yes 100 / No 0. The de-vig needs
// both sides at the SAME book, so a double-double ✓ would appear on a handful of rows — whichever
// ones a single book happened to post a "No" for — and a tag that fires on 4% of a card reads as
// "these are the good ones" when it actually means "these are the only ones we could price". That
// is misleading by omission, so these two stay in the capture (history cannot be backfilled) and
// off the board until either the market thickens or a one-sided shopping tab is designed for them
// the way /nhl/props did it explicitly.
//
// 🚨 STEALS AND BLOCKS ARE THIN BY NATURE, NOT BROKEN. Nine quotes and twelve across two games,
// against points' 350 — a book prices one or two players a night, and steals has exactly one line
// (1.5) league-wide. Derek named steals explicitly so it is on the board, but the copy says the tab
// is sparse rather than letting a near-empty card read as a data gap. This is the same shape as the
// NFL board's Kicking/Defense tabs, where an empty category was a capture gap; here it is the
// market itself.
import { deVig } from "@/lib/fairValue";
import type { PropGame, Quote, MarketBlock } from "./props";
import { usBooks } from "@/lib/bookLabel";

interface Row {
  snapshot_at: string; event_id: string; commence_time: string;
  home_team: string; away_team: string; book: string; market: string;
  player: string | null; side: string | null; line: number | null; price_american: number | null;
}

/** PostgREST read, PAGED — `limit=` does not raise the 1000-row ceiling, and one NBA sweep is
 *  ~9,300 rows (measured over a 9-game slate), so an unpaged read would return a ninth of the
 *  board and look complete doing it. */
async function pgAll(query: string): Promise<Row[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return [];
  const base = `${url.replace(/\/$/, "")}/rest/v1/nba_prop_snapshots${query}`;
  const out: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(base, {
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        "Range-Unit": "items", Range: `${offset}-${offset + PAGE - 1}`,
      },
      next: { revalidate: 120 },
    });
    if (!res.ok) return out;
    const rows = (await res.json()) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export const NBA_PROP_LABELS: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "Threes Made",
  player_steals: "Steals",
  player_blocks: "Blocks",
  player_points_rebounds_assists: "Pts + Reb + Ast",
};
const nbaLabel = (k: string) => NBA_PROP_LABELS[k] ?? k.replace(/^player_/, "").replace(/_/g, " ");

export interface NbaCategory { key: string; label: string; markets: string[] }

// 🚨 TAB ORDER FOLLOWS MARKET DEPTH HERE, NOT PERSISTENCE — AND THAT IS A DELIBERATE DEPARTURE
// FROM THE NHL BOARD, WHICH LEADS WITH SHOTS BECAUSE SHOTS ARE THE VOLUME MARKET.
//
// That ordering exists to put the reader in front of the market where a MODEL is most likely to
// find signal (volume persists, efficiency does not). This board has no model. It is pure shopping,
// so the question is not "where might an edge be" but "where are there prices to shop", and points
// is the deepest market on the slate by a factor of two. When an NBA model does arrive, revisit
// this — the ordering argument changes the moment a projection sits beside the price.
export const NBA_CATEGORIES: NbaCategory[] = [
  { key: "points", label: "Points", markets: ["player_points"] },
  { key: "rebounds", label: "Rebounds", markets: ["player_rebounds"] },
  { key: "assists", label: "Assists", markets: ["player_assists"] },
  { key: "threes", label: "Threes", markets: ["player_threes"] },
  { key: "combo", label: "Pts+Reb+Ast", markets: ["player_points_rebounds_assists"] },
  { key: "defense", label: "Steals & Blocks", markets: ["player_steals", "player_blocks"] },
];
export const nbaCategoryByKey = (k: string): NbaCategory =>
  NBA_CATEGORIES.find((c) => c.key === k) ?? NBA_CATEGORIES[0];

/** Tabs the feed prices too thinly to fill a card — the copy says so rather than letting a
 *  three-row board read as a bug. Measured, not assumed; see the header. */
export const THIN = new Set(["defense"]);

interface BoardRow extends Row {
  event_id: string; commence_time: string; home_team: string; away_team: string;
}

/** The MAIN line for a player's market: the line the most books post BOTH sides of, FanDuel
 *  breaking ties. Same rule and the same reason as the baseball and hockey boards — taking the
 *  friendliest line per side independently pairs "O 24.5" with "U 26.5", which is two different
 *  questions dressed as one row. It matters more in basketball than anywhere else here: points
 *  carries 30 distinct lines on a single slate, against 3 for shots on goal, so there is far more
 *  room to accidentally straddle two of them. */
function mainLine(quotes: Quote[]): number | null {
  const lines = new Map<number, { over: Set<string>; under: Set<string> }>();
  for (const q of quotes) {
    if (q.line === null) return null;
    const e = lines.get(q.line) ?? lines.set(q.line, { over: new Set(), under: new Set() }).get(q.line)!;
    for (const b of Object.keys(q.byBook)) (q.side === "Over" ? e.over : e.under).add(b);
  }
  let best: number | null = null, score = -1;
  for (const [line, e] of lines) {
    const both = [...e.over].filter((b) => e.under.has(b)).length;
    const s = both * 10 + (e.over.has("fanduel") ? 1 : 0) + Math.min(e.over.size, 9) / 10;
    if (s > score) { score = s; best = line; }
  }
  return best;
}

export async function nbaPropBoard(): Promise<PropGame[]> {
  const probe = await pgAll("?select=snapshot_at&order=snapshot_at.desc&limit=1");
  if (!probe.length) return [];
  const snap = encodeURIComponent(probe[0].snapshot_at);
  // nba_prop_snapshots names two columns the way the hockey table does (`commence` and `price`)
  // rather than the football/baseball way. Aliasing them in the SELECT lets every line of board
  // logic below stay identical to the other boards rather than forking it over two column names.
  const rows = usBooks(await pgAll(
    `?snapshot_at=eq.${snap}` +
    "&select=snapshot_at,event_id,commence_time:commence,home_team,away_team," +
    "book,market,player,side,line,price_american:price",
  )) as BoardRow[];
  if (!rows.length) return [];

  const now = new Date().toISOString();

  // Every book's price per (event, market, player, side, line).
  const agg = new Map<string, { r: BoardRow; byBook: Record<string, number> }>();
  for (const r of rows) {
    if (!r.player || !r.side || r.price_american == null || !r.commence_time || r.commence_time <= now) continue;
    const line = r.line == null ? null : Number(r.line);
    const k = `${r.event_id}|${r.market}|${r.player}|${r.side}|${line}`;
    let a = agg.get(k);
    if (!a) { a = { r: { ...r, line }, byBook: {} }; agg.set(k, a); }
    if (a.byBook[r.book] === undefined || r.price_american > a.byBook[r.book]) a.byBook[r.book] = r.price_american;
  }

  // Pick Auditor: fair probability per side, de-vigged per book against the other side at the same
  // line and averaged. De-vig arithmetic only — never a model-edge claim.
  const OPP: Record<string, string> = { Over: "Under", Under: "Over", Yes: "No", No: "Yes" };
  const byLine = new Map<string, Record<string, Record<string, number>>>();
  for (const [k, a] of agg) {
    const [ev, mk, pl, side, line] = k.split("|");
    const lk = `${ev}|${mk}|${pl}|${line}`;
    (byLine.get(lk) ?? byLine.set(lk, {}).get(lk)!)[side] = a.byBook;
  }
  const fair = new Map<string, number>();
  for (const [lk, sides] of byLine) {
    for (const side of Object.keys(sides)) {
      const opp = OPP[side];
      if (!opp || !sides[opp]) continue;
      const ps: number[] = [];
      for (const b of Object.keys(sides[side])) if (sides[opp][b] != null) ps.push(deVig(sides[side][b], sides[opp][b]));
      if (ps.length) fair.set(`${lk}|${side}`, ps.reduce((x, y) => x + y, 0) / ps.length);
    }
  }

  const games = new Map<string, PropGame>();
  const mmap = new Map<string, Map<string, Quote[]>>();
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
      mmap.set(r.event_id, new Map());
    }
    const mm = mmap.get(r.event_id)!;
    if (!mm.has(r.market)) mm.set(r.market, []);
    const line = r.line as number | null;
    mm.get(r.market)!.push({
      player: r.player!, market: r.market, side: r.side!, line, price: best, books, byBook: a.byBook,
      eventId: r.event_id,
      fairProb: fair.get(`${r.event_id}|${r.market}|${r.player}|${line}|${r.side}`) ?? null,
    });
  }

  const out: PropGame[] = [];
  for (const g of games.values()) {
    const mm = mmap.get(g.eventId)!;
    g.markets = [...mm.entries()].map(([market, quotes]) => {
      const byPlayer = new Map<string, Quote[]>();
      for (const q of quotes) (byPlayer.get(q.player) ?? byPlayer.set(q.player, []).get(q.player)!).push(q);
      // 🚨 ORDER THE PLAYERS, AND DO IT AS GROUPS. The grid caps a card at four rows before the
      // "show more" control, so whatever this sort puts first IS the card. The hockey board learned
      // this when an alphabetical sort left Ovechkin behind the dropdown on a 36-skater card; an
      // NBA points card runs to ~20 players, so the same trap is live here.
      //
      // Line DESCENDING, then the Over price ASCENDING: the highest-line players lead the card,
      // which in basketball means the starters and the high-minute rotation rather than a
      // garbage-time reserve priced at 4.5. A player's Over and Under must stay adjacent for the
      // grid to pair them, so the groups are sorted and then flattened — sorting the flat quote
      // list could not do this.
      const groups: Quote[][] = [];
      for (const pq of byPlayer.values()) {
        const line = mainLine(pq);
        const keep = pq.filter((q) => q.line === line);
        keep.sort((x, y) => (x.side === "Over" ? -1 : 1) - (y.side === "Over" ? -1 : 1));
        if (keep.length) groups.push(keep);
      }
      const lead = (grp: Quote[]) => grp.find((q) => q.side === "Over") ?? grp[0];
      groups.sort((a, b) => {
        const la = lead(a), lb = lead(b);
        return (lb.line ?? 0) - (la.line ?? 0)
          || la.price - lb.price
          || la.player.localeCompare(lb.player);
      });
      const qs: Quote[] = groups.flat();
      return { market, label: nbaLabel(market), quotes: qs } as MarketBlock;
    });
    const rank = new Map(NBA_CATEGORIES.flatMap((c) => c.markets).map((m, i) => [m, i]));
    g.markets.sort((x, y) => (rank.get(x.market) ?? 99) - (rank.get(y.market) ?? 99));
    out.push(g);
  }
  out.sort((x, y) => x.commence.localeCompare(y.commence));
  return out;
}
