// NHL player props — the same board math as the NFL, NCAAF and MLB prop boards, pointed at
// nhl_prop_snapshots. Value Finder is arithmetic: best price per side across books, plus the Pick
// Auditor's de-vigged fair price. No model, which is why this works on a sport whose prop history
// began on 2026-10-09.
//
// 🚨 ONE MARKET CANNOT BE AUDITED, AND THE PAGE MUST NOT PRETEND OTHERWISE. Measured on the first
// live sweep (2,819 rows):
//
//     market                       sides          lines          both sides quoted?
//     player_shots_on_goal         Over / Under   1.5 2.5 3.5     334 / 334
//     player_points                Over / Under   0.5 1.5         229 / 229
//     player_assists               Over / Under   0.5             145 / 145
//     player_goal_scorer_anytime   Yes ONLY       (none)          0 / 1324
//
// Anytime goal scorer is quoted one-sided — 1,393 rows, every one of them "Yes", no "No" anywhere.
// De-vigging needs two sides of the same question, so there is NO fair price for it and no ✓ tag.
// Shopping it still works perfectly (best Yes price across books), and that is all the page claims.
// Inventing a fair number from a one-sided market — by assuming the field sums to some expected
// count, say — would be the "appearance of rigor" this project exists against.
import { deVig } from "@/lib/fairValue";
import type { PropGame, Quote, MarketBlock } from "./props";
import { usBooks } from "@/lib/bookLabel";

interface Row {
  snapshot_at: string; event_id: string; commence_time: string;
  home_team: string; away_team: string; book: string; market: string;
  player: string | null; side: string | null; line: number | null; price_american: number | null;
}

/** PostgREST read, PAGED — `limit=` does not raise the 1000-row ceiling, and one NHL sweep is
 *  ~2,800 rows, so an unpaged read would silently return a third of the board. */
async function pgAll(query: string): Promise<Row[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return [];
  const base = `${url.replace(/\/$/, "")}/rest/v1/nhl_prop_snapshots${query}`;
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

// (A name normaliser used to live here, copied from the baseball board. It is gone: name matching
// for the team tag belongs in lib/nhlTeamTag.ts, which has to agree character-for-character with
// player_norm() in nhl_rosters.py. Two normalisers that only mostly agree is the worse outcome.)

export const NHL_PROP_LABELS: Record<string, string> = {
  player_goal_scorer_anytime: "Anytime Goal",
  player_shots_on_goal: "Shots on Goal",
  player_points: "Points",
  player_assists: "Assists",
};
const nhlLabel = (k: string) => NHL_PROP_LABELS[k] ?? k.replace(/^player_/, "").replace(/_/g, " ");

/** Markets with no second side — shopping only, never a fair-price tag. */
export const ONE_SIDED = new Set(["player_goal_scorer_anytime"]);

export interface NhlCategory { key: string; label: string; markets: string[] }
export const NHL_CATEGORIES: NhlCategory[] = [
  // Shots first on purpose. It is the VOLUME market, and the project's standing finding is that
  // volume persists while efficiency does not — so of these four it is the one most likely to
  // reward attention. Goals and assists are efficiency, once and twice removed.
  { key: "shots", label: "Shots", markets: ["player_shots_on_goal"] },
  { key: "points", label: "Points", markets: ["player_points"] },
  { key: "assists", label: "Assists", markets: ["player_assists"] },
  { key: "goals", label: "Goals", markets: ["player_goal_scorer_anytime"] },
];
export const nhlCategoryByKey = (k: string): NhlCategory =>
  NHL_CATEGORIES.find((c) => c.key === k) ?? NHL_CATEGORIES[0];

interface BoardRow extends Row {
  event_id: string; commence_time: string; home_team: string; away_team: string;
}

/** The MAIN line for a player's market: the line the most books post BOTH sides of, FanDuel
 *  breaking ties. Same rule and the same reason as the baseball board — taking the friendliest
 *  line per side independently pairs "O 1.5" with "U 2.5", which is two different questions
 *  dressed as one row. A one-sided market has no line at all and returns null. */
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

export async function nhlPropBoard(): Promise<PropGame[]> {
  const probe = await pgAll("?select=snapshot_at&order=snapshot_at.desc&limit=1");
  if (!probe.length) return [];
  const snap = encodeURIComponent(probe[0].snapshot_at);
  // The NHL table names two columns differently from the football/baseball ones (`commence` and
  // `price`). Aliasing them in the SELECT lets every line of board logic below stay identical to
  // the baseball version rather than forking it over two column names.
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
  // line and averaged. A one-sided market never finds its opposite, so `fair` stays empty for it
  // and every quote carries fairProb null — which is the honest outcome, not a gap to paper over.
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
      // "show more" control, so whatever this sort puts first IS the card — and the first version
      // sorted alphabetically, which made the four visible rows on a 36-skater anytime-goal card an
      // arbitrary four names while Ovechkin sat behind the dropdown. Baseball gets away with a name
      // sort only because its page re-sorts into lineup order afterwards; hockey has no lineup feed,
      // so the order shipped from here is the order a reader sees.
      //
      // Line DESCENDING, then the Over/Yes price ASCENDING:
      //   · shots on goal — 3.5 before 2.5 before 1.5, so the volume leaders lead the card, which is
      //     the one ordering the project's own findings support (volume persists, efficiency does not)
      //   · anytime goal — no line on any row, so it falls straight through to price, putting the
      //     shortest prices first instead of a fourth-liner at +2500
      // Sorting the flat quote list could not do this: a player's Over and Under must stay adjacent
      // for the grid to pair them, so the groups are sorted and then flattened.
      const groups: Quote[][] = [];
      for (const pq of byPlayer.values()) {
        const line = mainLine(pq);
        const keep = pq.filter((q) => q.line === line);
        keep.sort((x, y) => (x.side === "Over" || x.side === "Yes" ? -1 : 1) - (y.side === "Over" || y.side === "Yes" ? -1 : 1));
        if (keep.length) groups.push(keep);
      }
      const lead = (grp: Quote[]) => grp.find((q) => q.side === "Over" || q.side === "Yes") ?? grp[0];
      groups.sort((a, b) => {
        const la = lead(a), lb = lead(b);
        return (lb.line ?? 0) - (la.line ?? 0)
          || la.price - lb.price
          || la.player.localeCompare(lb.player);
      });
      const qs: Quote[] = groups.flat();
      return { market, label: nhlLabel(market), quotes: qs } as MarketBlock;
    });
    const rank = new Map(NHL_CATEGORIES.flatMap((c) => c.markets).map((m, i) => [m, i]));
    g.markets.sort((x, y) => (rank.get(x.market) ?? 99) - (rank.get(y.market) ?? 99));
    out.push(g);
  }
  out.sort((x, y) => x.commence.localeCompare(y.commence));
  return out;
}
