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

/** {normalised pitcher name -> consensus strikeout line}. The MEDIAN across books, not any single
 *  one — the same choice the NFL game board makes, and the reason the football copy says "the
 *  median across the sportsbooks we track, not any single book". */
export async function propLines(market: string): Promise<Map<string, { line: number; books: number }>> {
  const rows = await pgAll(
    `?market=eq.${market}&select=player,side,line,price_american,book,snapshot_at&order=snapshot_at.desc`,
  );
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
 *  For a 0.5-line market ("will he record a hit") the LINE carries no information — it is 0.5 on
 *  every row. What the book is actually saying lives in the PRICE, so the board must compare our
 *  percentage against theirs, not against "0.5". Same shape as the football props board.
 *
 *  De-vigged against the Under so the two sides sum to 1 — that is the Pick Auditor's arithmetic,
 *  and it is arithmetic, never an edge claim. */
export async function propBookProb(market: string): Promise<Map<string, number>> {
  const rows = await pgAll(
    `?market=eq.${market}&select=player,side,line,price_american,book,snapshot_at&order=snapshot_at.desc`,
  );
  // newest price per (player, book, side)
  const latest = new Map<string, number>();
  for (const r of rows) {
    if (!r.player || r.price_american === null || !r.side) continue;
    const k = `${norm(r.player)}|${r.book}|${r.side.toLowerCase()}`;
    if (!latest.has(k)) latest.set(k, Number(r.price_american));
  }
  const byPlayer = new Map<string, number[]>();
  for (const [k, over] of latest) {
    const [p, book, side] = k.split("|");
    if (side !== "over" && side !== "yes") continue;
    const under = latest.get(`${p}|${book}|under`) ?? latest.get(`${p}|${book}|no`);
    const fair = under === undefined ? implied(over) : deVig(over, under);
    (byPlayer.get(p) ?? byPlayer.set(p, []).get(p)!).push(fair);
  }
  const out = new Map<string, number>();
  for (const [p, xs] of byPlayer) {
    xs.sort((a, b) => a - b);
    const mid = Math.floor(xs.length / 2);
    out.set(p, xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2);
  }
  return out;
}
