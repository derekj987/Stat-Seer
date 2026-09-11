import { deVig, impliedProb as implied } from "@/lib/fairValue";
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
  return out;
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
