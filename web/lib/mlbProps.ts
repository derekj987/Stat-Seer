import { deVig, impliedProb as implied } from "@/lib/fairValue";
import type { PropGame, Quote, MarketBlock } from "./props";
import { usBooks } from "@/lib/bookLabel";
// MLB captured props — the consensus book line per pitcher, for the strikeouts board.
// Server-side only (Supabase service key). Mirrors lib/props.ts, including its paging.

interface Row {
  snapshot_at: string;
  player: string | null;
  side: string | null;
  line: number | string | null;
  price_american: number | null;
  book: string;
  market: string;
}

// PostgREST caps every response at 1000 rows and does NOT say so — `limit=` does not raise it, and
// a response sitting exactly at the cap is indistinguishable from a complete one. This has bitten
// this repo repeatedly (7 of 35 games, 145 of 716 players), so every read here pages until a SHORT
// page comes back. Never replace this with a limit.
async function pgAll(query: string): Promise<Row[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return [];
  const base = `${url.replace(/\/$/, "")}/rest/v1/mlb_prop_snapshots${query}`;
  const out: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(base, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + PAGE - 1}`,
        "Range-Unit": "items",
      },
      next: { revalidate: 300 },
    });
    if (!res.ok && res.status !== 206) return out;   // a board without book lines still renders
    const page = (await res.json()) as Row[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  // The snapshot probes select only snapshot_at; a row without a book is not a quote to filter.
  return out.length && out[0].book === undefined ? out : usBooks(out);
}

/** The newest sweep's `snapshot_at` for one market — a one-row probe.
 *
 *  `mlb_prop_snapshots` is append-only: every 6h sweep writes a fresh row per (player, book, side,
 *  line), so a market's history grows without bound and both readers below used to pull ALL of
 *  it — `?market=eq.X&order=snapshot_at.desc` with no time bound — then keep only the newest row
 *  per key and discard the rest. That is the read pattern that exhausted the project's Disk IO
 *  budget on the NFL side; this table is smaller but the same shape, and it only gets bigger.
 *
 *  MLB `snapshot_at` is ONE clock time per sweep by design (see ingest/mlb_snapshots.sql) and is
 *  indexed, so `snapshot_at=eq.<latest>` is both exact and cheap. Same pattern as mlbBoard.ts
 *  and cfbProps.ts. Returns null when the probe fails so the caller can fall back. */
async function latestSnapshot(market: string): Promise<string | null> {
  const rows = await pgAll(`?market=eq.${market}&select=snapshot_at&order=snapshot_at.desc&limit=1`);
  return rows.length ? rows[0].snapshot_at : null;
}

/** Rows for a market at its newest sweep, falling back to the unbounded read only if the probe
 *  returned nothing — so a stale board still renders rather than an empty one. */
async function marketRows(market: string): Promise<Row[]> {
  const snap = await latestSnapshot(market);
  const sel = "&select=player,side,line,price_american,book,snapshot_at&order=snapshot_at.desc";
  if (snap) {
    const rows = await pgAll(`?market=eq.${market}&snapshot_at=eq.${encodeURIComponent(snap)}${sel}`);
    if (rows.length) return rows;
  }
  return pgAll(`?market=eq.${market}${sel}`);
}

/** {normalised pitcher name -> consensus strikeout line}. The MEDIAN across books, not any single
 *  one — the same choice the NFL game board makes, and the reason the football copy says "the
 *  median across the sportsbooks we track, not any single book". */
export async function propLines(market: string): Promise<Map<string, { line: number; books: number }>> {
  const rows = await marketRows(market);
  // Latest snapshot per (player, book), then the median of those.
  const latest = new Map<string, number>();
  for (const r of rows) {
    if (!r.player || r.line === null) continue;
    const k = `${norm(r.player)}|${r.book}`;
    if (!latest.has(k)) latest.set(k, Number(r.line));   // rows arrive newest-first
  }
  const byPlayer = new Map<string, number[]>();
  for (const [k, v] of latest) {
    const p = k.split("|")[0];
    (byPlayer.get(p) ?? byPlayer.set(p, []).get(p)!).push(v);
  }
  const out = new Map<string, { line: number; books: number }>();
  for (const [p, xs] of byPlayer) {
    xs.sort((a, b) => a - b);
    const mid = Math.floor(xs.length / 2);
    out.set(p, {
      line: xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2,
      books: xs.length,
    });
  }
  return out;
}

/** Books post "Jesús Luzardo"; StatsAPI says "Jesús Luzardo" too, but accents and punctuation
 *  drift between feeds. Strip both so a name mismatch never silently drops a line — the football
 *  boards learned that the hard way when a stale-roster join deleted every transfer. */
export const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Kept as a named wrapper because the strikeouts panel reads better for it. */
export const strikeoutLines = () => propLines("pitcher_strikeouts");

/** {normalised player -> de-vigged book probability of the OVER}.
 *
 *  For the 0.5 line ("will he record a hit") the information lives in the PRICE, not the number,
 *  so the board compares our percentage against theirs rather than against "0.5". Same shape as
 *  the football props board.
 *
 *  This comment used to claim the line "is 0.5 on every row". It is not — the same market carries
 *  a 1.5 line too, and believing that sentence is what put P(2+ hits) in a column labelled as the
 *  chance of a hit. Filter on the line explicitly; never assume a market has only one.
 *
 *  De-vigged against the Under so the two sides sum to 1 — that is the Pick Auditor's arithmetic,
 *  and it is arithmetic, never an edge claim. */
export async function propBookProb(market: string): Promise<Map<string, number>> {
  const rows = await marketRows(market);
  // 🚨 THE LINE IS PART OF THE QUESTION. `batter_hits` carries BOTH the 0.5 line ("will he record
  // a hit") and the 1.5 line ("will he get two"), 399 of 5,845 rows at 1.5. Keying only on
  // (player, book, side) let whichever line a book happened to post most recently win — so Yandy
  // Diaz showed 36% against our 70%, because 36% was his de-vigged P(2+ hits) being compared with
  // our P(1+ hit). Derek caught it by eye: his team-mates read 64-65% and he read 36%.
  //
  // Two failures in one: the wrong QUESTION was displayed, and an Over 1.5 could be paired with an
  // Under 0.5 from the same book (Chandler Simpson had all four) and "de-vigged" into nonsense.
  // Key on the line, and keep only the line this board is actually about.
  const WANT_LINE = 0.5;
  const latest = new Map<string, number>();
  for (const r of rows) {
    if (!r.player || r.price_american === null || !r.side) continue;
    if (Number(r.line) !== WANT_LINE) continue;
    const k = `${norm(r.player)}|${r.book}|${Number(r.line)}|${r.side.toLowerCase()}`;
    if (!latest.has(k)) latest.set(k, Number(r.price_american));
  }
  // 🚨 NEVER mix a de-vigged price with a raw one in the same median. The hold on these props is
  // large — measured 6.77% on batter_hits — so a raw Over implies ~60.5% where the de-vigged fair
  // is ~56.7%. Taking a median across books where SOME entries were de-vigged and some were the
  // raw fallback (270 of 1,122 quotes were one-sided) mixes two different quantities and pulls the
  // number up by up to 4 points for exactly the players with thin two-way coverage.
  //
  // So: use the two-sided quotes when a player has any, and fall back to raw only when he has
  // none — flagged, so the caller can tell the two apart rather than silently averaging them.
  const twoSided = new Map<string, number[]>();
  const oneSided = new Map<string, number[]>();
  for (const [k, over] of latest) {
    const [p, book, line, side] = k.split("|");
    if (side !== "over" && side !== "yes") continue;
    // Same player, same book, SAME LINE — never across lines.
    const under = latest.get(`${p}|${book}|${line}|under`) ?? latest.get(`${p}|${book}|${line}|no`);
    if (under === undefined) (oneSided.get(p) ?? oneSided.set(p, []).get(p)!).push(implied(over));
    else (twoSided.get(p) ?? twoSided.set(p, []).get(p)!).push(deVig(over, under));
  }
  // The typical two-way hold, measured from this very snapshot rather than assumed, so a one-sided
  // price can be brought onto the same footing instead of being dropped or trusted raw.
  const holds: number[] = [];
  for (const [k, over] of latest) {
    const [p, book, line, side] = k.split("|");
    if (side !== "over" && side !== "yes") continue;
    const under = latest.get(`${p}|${book}|${line}|under`) ?? latest.get(`${p}|${book}|${line}|no`);
    if (under !== undefined) holds.push(implied(over) + implied(under) - 1);
  }
  holds.sort((a, b) => a - b);
  const medHold = holds.length ? holds[Math.floor(holds.length / 2)] : 0;
  const byPlayer = new Map<string, number[]>();
  for (const [p, xs] of twoSided) byPlayer.set(p, xs);
  for (const [p, xs] of oneSided) {
    if (byPlayer.has(p)) continue;                       // two-sided wins outright
    byPlayer.set(p, xs.map((x) => Math.max(0, Math.min(1, x - medHold / 2))));
  }
  const out = new Map<string, number>();
  for (const [p, xs] of byPlayer) {
    xs.sort((a, b) => a - b);
    const mid = Math.floor(xs.length / 2);
    out.set(p, xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The Value Finder prop board: every posted MLB prop, every book, the single best price per
// player-side, in the same PropGame shape the NFL and NCAAF boards render (PropsView). Reads the
// newest sweep only — one probe for its snapshot_at, then `snapshot_at=eq.` (the IO rule above).


/** Sportsbook market slugs → what a reader calls them. Anything not listed falls back to the slug
 *  with its prefix stripped, so a new market the capture picks up still renders. */
export const MLB_PROP_LABELS: Record<string, string> = {
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_hits_runs_rbis: "H + R + RBI",
  batter_singles: "Singles",
  batter_doubles: "Doubles",
  batter_triples: "Triples",
  batter_runs_scored: "Runs",
  batter_rbis: "RBIs",
  batter_walks: "Walks",
  batter_stolen_bases: "Stolen Bases",
  batter_home_runs: "Home Runs",
  batter_first_home_run: "First HR",
  pitcher_strikeouts: "Strikeouts",
  pitcher_outs: "Outs Recorded",
  pitcher_record_a_win: "To Win",
  pitcher_earned_runs: "Earned Runs",
  pitcher_hits_allowed: "Hits Allowed",
  pitcher_walks: "Walks Allowed",
};
const mlbLabel = (k: string) => MLB_PROP_LABELS[k] ?? k.replace(/^(batter|pitcher)_/, "").replace(/_/g, " ");

/** Tabs, the way a sportsbook splits its baseball board and the way The Model splits its own. */
export interface MlbCategory { key: string; label: string; markets: string[] }
export const MLB_CATEGORIES: MlbCategory[] = [
  { key: "hitting", label: "Hitting", markets: ["batter_hits", "batter_total_bases", "batter_hits_runs_rbis", "batter_singles", "batter_doubles", "batter_triples"] },
  { key: "hr", label: "Home Runs", markets: ["batter_home_runs", "batter_first_home_run"] },
  { key: "scoring", label: "Runs & Bases", markets: ["batter_runs_scored", "batter_rbis", "batter_walks", "batter_stolen_bases"] },
  { key: "pitching", label: "Pitching", markets: ["pitcher_strikeouts", "pitcher_outs", "pitcher_record_a_win", "pitcher_earned_runs", "pitcher_hits_allowed", "pitcher_walks"] },
];
export const mlbCategoryByKey = (k: string): MlbCategory => MLB_CATEGORIES.find((c) => c.key === k) ?? MLB_CATEGORIES[0];

interface BoardRow extends Row {
  event_id: string; commence_time: string; home_team: string; away_team: string;
}

/** The MAIN line for a player's market: the line the most books post BOTH sides of, FanDuel
 *  breaking ties. The football boards took the bettor-friendliest line per side (lowest Over,
 *  highest Under), and on a baseball board that paired "O 0.5" with "U 1.5" on one row — two
 *  different questions (1+ hit; fewer than 2) dressed as one market. A reader wants the question
 *  the book leads with, both sides of it, and the best price for each. */
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

export async function mlbPropBoard(): Promise<PropGame[]> {
  const probe = await pgAll("?select=snapshot_at&order=snapshot_at.desc&limit=1");
  if (!probe.length) return [];
  const snap = encodeURIComponent(probe[0].snapshot_at);
  const rows = (await pgAll(
    `?snapshot_at=eq.${snap}&select=snapshot_at,event_id,commence_time,home_team,away_team,book,market,player,side,line,price_american`,
  )) as BoardRow[];
  if (!rows.length) return [];
  // Games already under way are not shoppable — the same rule as the game board.
  const now = new Date().toISOString();

  // Every book's price per (event, market, player, side, line).
  const agg = new Map<string, { r: BoardRow; byBook: Record<string, number> }>();
  for (const r of rows) {
    if (!r.player || !r.side || r.price_american == null || !r.commence_time || r.commence_time <= now) continue;
    // "No Home Run" is a row in the first-HR market, not a player.
    if (/^no /i.test(r.player)) continue;
    const line = r.line == null ? null : Number(r.line);
    const k = `${r.event_id}|${r.market}|${r.player}|${r.side}|${line}`;
    let a = agg.get(k);
    if (!a) { a = { r: { ...r, line }, byBook: {} }; agg.set(k, a); }
    if (a.byBook[r.book] === undefined || r.price_american > a.byBook[r.book]) a.byBook[r.book] = r.price_american;
  }

  // Pick Auditor: the fair probability of each side, de-vigged per book against the other side at
  // the same line and averaged — the same arithmetic as the NFL board.
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
      // One row per player + side, at the player's MAIN line for this market.
      const byPlayer = new Map<string, Quote[]>();
      for (const q of quotes) (byPlayer.get(q.player) ?? byPlayer.set(q.player, []).get(q.player)!).push(q);
      const qs: Quote[] = [];
      for (const pq of byPlayer.values()) {
        const line = mainLine(pq);
        const keep = pq.filter((q) => q.line === line);
        // Over before Under; a yes/no market has one side.
        keep.sort((x, y) => (x.side === "Over" || x.side === "Yes" ? -1 : 1) - (y.side === "Over" || y.side === "Yes" ? -1 : 1));
        qs.push(...keep);
      }
      return { market, label: mlbLabel(market), quotes: qs } as MarketBlock;
    });
    // Market order is the CATEGORY's order (Hits before Doubles), not the alphabet's.
    const rank = new Map(MLB_CATEGORIES.flatMap((c) => c.markets).map((m, i) => [m, i]));
    g.markets.sort((x, y) => (rank.get(x.market) ?? 99) - (rank.get(y.market) ?? 99));
    out.push(g);
  }
  out.sort((x, y) => x.commence.localeCompare(y.commence));
  return out;
}
