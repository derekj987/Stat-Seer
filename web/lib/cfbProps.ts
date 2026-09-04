// NCAAF player-props board — reads the CFB prop capture (cfb_prop_snapshots), best price
// per player across books, shaped as PropGame[] so it can reuse the NFL PropsView UI
// (tap-to-add chips + single best book). Server-side only (Supabase service key).
import type { PropGame, Quote, MarketBlock } from "./props";
import { PROP_LABELS } from "./props";
import { etDayKey } from "./gameDays";
import { NCAAF_MODEL } from "@/app/ncaaf/model-data";

/** The ET day-keys a scheduled week covers, taken from the card's own kickoffs.
 *
 *  cfb_prop_snapshots carries no season/week column — only `commence` — so the week has to be
 *  derived from the kickoff. Returns null when the card knows nothing about that week, which the
 *  caller treats as "no props for this week" rather than "show everything". */
function weekDays(week: number): Set<string> | null {
  const card = NCAAF_MODEL.card;
  const wk = card.weeks?.find((w) => w.week === week) ?? (card.week === week ? card : null);
  if (!wk || !wk.games.length) return null;
  const days = new Set<string>();
  for (const g of wk.games) if (g.commence) days.add(etDayKey(g.commence));
  return days.size ? days : null;
}

const label = (k: string) => PROP_LABELS[k] ?? k.replace(/^player_/, "").replace(/_/g, " ");

interface Row {
  event_id: string; commence: string | null; home_team: string | null; away_team: string | null;
  book: string; market: string; player: string | null; side: string | null; line: number | null;
  price: number; snapshot_at: string;
}

async function fetchRows(): Promise<Row[]> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const base = `${url.replace(/\/$/, "")}/rest/v1/cfb_prop_snapshots`;
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  // Pin to the latest full snapshot so the board is whole and current.
  const latRes = await fetch(`${base}?select=snapshot_at&order=snapshot_at.desc&limit=1`, { headers: h, next: { revalidate: 120 } });
  if (!latRes.ok) throw new Error(`Supabase ${latRes.status}`);
  const lat = (await latRes.json()) as { snapshot_at: string }[];
  if (!lat.length) return [];
  const snap = encodeURIComponent(lat[0].snapshot_at);
  const res = await fetch(
    `${base}?snapshot_at=eq.${snap}&select=event_id,commence,home_team,away_team,book,market,player,side,line,price,snapshot_at&limit=8000`,
    { headers: h, next: { revalidate: 120 } }
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return (await res.json()) as Row[];
}

// Better bet for the member (same player+side): lower line for Over, higher for Under, then
// better price; no line (ATTD) breaks on price. Mirrors props.isBetter.
function isBetter(a: Quote, b: Quote): boolean {
  if (a.line !== null && b.line !== null && a.line !== b.line) {
    if (a.side === "Over") return a.line < b.line;
    if (a.side === "Under") return a.line > b.line;
  }
  return a.price > b.price;
}

/** The NCAAF prop board for one week.
 *
 *  `week` is optional only for callers that genuinely want "whatever is in the latest snapshot".
 *  Prefer passing it: without a week this returns the whole snapshot, so a week-scoped page would
 *  pair week 1's prices with any week you selected — the same class of bug as the player board
 *  rendering week 1's games on every week. */
export async function cfbWeekProps(week?: number): Promise<PropGame[]> {
  let rows: Row[];
  try { rows = await fetchRows(); } catch { return []; }
  if (!rows.length) return [];
  if (week !== undefined) {
    const days = weekDays(week);
    if (!days) return [];                                  // card has no games that week
    rows = rows.filter((r) => days.has(etDayKey(r.commence)));
    if (!rows.length) return [];
  }

  // Best price per book for each (event, market, player, side, line).
  const agg = new Map<string, { r: Row; byBook: Record<string, number> }>();
  for (const r of rows) {
    if (!r.player || !r.side || !Number.isFinite(r.price)) continue;
    const k = `${r.event_id}|${r.market}|${r.player}|${r.side}|${r.line}`;
    let a = agg.get(k);
    if (!a) { a = { r, byBook: {} }; agg.set(k, a); }
    if (a.byBook[r.book] === undefined || r.price > a.byBook[r.book]) a.byBook[r.book] = r.price;
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
        home: r.home_team ?? "", away: r.away_team ?? "", commence: r.commence ?? "",
        snapshot: r.snapshot_at, markets: [],
      });
      mmap.set(r.event_id, new Map());
    }
    const mm = mmap.get(r.event_id)!;
    if (!mm.has(r.market)) mm.set(r.market, []);
    mm.get(r.market)!.push({ player: r.player!, market: r.market, side: r.side!, line: r.line, price: best, books, byBook: a.byBook, eventId: r.event_id });
  }

  const out: PropGame[] = [];
  for (const g of games.values()) {
    const mm = mmap.get(g.eventId)!;
    g.markets = [...mm.entries()].map(([market, quotes]) => {
      const bestByKey = new Map<string, Quote>();
      for (const q of quotes) {
        const key = `${q.player}|${q.side}`;
        const prev = bestByKey.get(key);
        if (!prev || isBetter(q, prev)) bestByKey.set(key, q);
      }
      const qs = [...bestByKey.values()].sort((x, y) => x.player.localeCompare(y.player) || x.side.localeCompare(y.side));
      return { market, label: label(market), quotes: qs } as MarketBlock;
    }).sort((x, y) => x.label.localeCompare(y.label));
    out.push(g);
  }
  out.sort((x, y) => (x.commence || "").localeCompare(y.commence || ""));
  return out;
}
