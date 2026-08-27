// Slip-assistant data + math (server-only — reads odds via the service key). Builds a
// "menu" of real, priced candidate bets (game spreads/totals + player props) that both the
// deterministic menu builder and the Claude text builder pick from. Nothing is fabricated:
// every leg is a real market with real best-price odds; the model's TD% is attached to
// anytime-TD legs for "highest-% scorer" requests.
import { fetchWeek, buildBoard } from "./board";
import { weekProps } from "./props";
import { PLAYER_PROJECTIONS } from "./playerProjections";
import { toDecimal, decToAmerican } from "./slipPricing";

export type CandGroup = "spread" | "total" | "td" | "passing" | "rushing" | "receiving";

export interface Candidate {
  id: string;
  kind: "line" | "prop";
  group: CandGroup;
  title: string;                 // "BUF -2.5", "Over 48.5", "Josh Allen Anytime TD"
  detail: string;                // matchup / context
  price: number;                 // best american price across books
  books: string[];
  byBook: Record<string, number>;
  model?: number;                // model signal for ranking (TD legs: model TD %)
}

const fmtPt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const normName = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);

// model TD % by player, from the line-blind projections.
function tdModelMap(): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of PLAYER_PROJECTIONS) {
    if (r.market === "anytime_td") m.set(normName(r.player), r.proj);
  }
  return m;
}

const PROP_CAT: Record<string, CandGroup> = {
  player_anytime_td: "td",
  player_pass_yds: "passing", player_pass_tds: "passing",
  player_rush_yds: "rushing", player_rush_attempts: "rushing",
  player_reception_yds: "receiving", player_receptions: "receiving",
};
const PROP_LABEL: Record<string, string> = {
  player_pass_yds: "Pass Yds", player_pass_tds: "Pass TDs",
  player_rush_yds: "Rush Yds", player_rush_attempts: "Rush Att",
  player_reception_yds: "Rec Yds", player_receptions: "Receptions",
};

export async function buildCandidates(week: number, season = 2026): Promise<Candidate[]> {
  const out: Candidate[] = [];

  // ---- Game lines: both spread sides + total over/under, best price each ----
  try {
    const board = buildBoard(await fetchWeek(week, season));
    for (const g of board) {
      const mk = `${g.away} @ ${g.home}`;
      const push = (id: string, group: CandGroup, title: string, l: { point: number | null; price: number; books: string[]; byBook: Record<string, number> } | null) => {
        if (l && l.point !== null && Number.isFinite(l.price)) {
          out.push({ id, kind: "line", group, title: title.replace("{pt}", fmtPt(l.point)), detail: mk, price: l.price, books: l.books, byBook: l.byBook });
        }
      };
      push(`sp-${g.eventId}-h`, "spread", `${g.home} {pt}`, g.spread.home);
      push(`sp-${g.eventId}-a`, "spread", `${g.away} {pt}`, g.spread.away);
      push(`tot-${g.eventId}-o`, "total", `${mk}: Over {pt}`, g.total.over ? { ...g.total.over, point: g.total.over.point } : null);
      push(`tot-${g.eventId}-u`, "total", `${mk}: Under {pt}`, g.total.under ? { ...g.total.under, point: g.total.under.point } : null);
    }
  } catch { /* odds not up */ }

  // ---- Player props: anytime-TD (with model %) + core yardage/reception overs ----
  try {
    const games = await weekProps(week, season);
    const td = tdModelMap();
    for (const pg of games) {
      const mk = `${pg.away} @ ${pg.home}`;
      for (const mb of pg.markets) {
        const group = PROP_CAT[mb.market];
        if (!group) continue;
        const isTd = mb.market === "player_anytime_td";
        // Cap each market to keep the candidate list bounded; TD keeps more (ranking pool).
        for (const q of mb.quotes.slice(0, isTd ? 24 : 8)) {
          if (!Number.isFinite(q.price)) continue;
          if (!isTd && q.side !== "Over") continue; // only the over side for yardage/receptions
          const title = isTd
            ? `${q.player} Anytime TD`
            : `${q.player} o${q.line} ${PROP_LABEL[mb.market] ?? mb.market}`;
          out.push({
            id: `pr-${slug(q.player)}-${mb.market}-${q.side}`,
            kind: "prop", group, title, detail: mk,
            price: q.price, books: q.books, byBook: q.byBook,
            ...(isTd && td.has(normName(q.player)) ? { model: td.get(normName(q.player)) } : {}),
          });
        }
      }
    }
  } catch { /* props not up */ }

  return out;
}

// ---- odds math over a set of chosen candidates ----
export function combinedDecimal(legs: Candidate[]): number {
  return legs.reduce((acc, l) => acc * toDecimal(l.price), 1);
}
export function combinedAmerican(legs: Candidate[]): string {
  return legs.length ? decToAmerican(combinedDecimal(legs)) : "—";
}

// ---- deterministic MENU builder ----
export interface MenuOpts {
  groups: CandGroup[];      // which bet types to draw from
  legs: number;             // how many legs
  targetOdds?: number | null; // american target for the whole parlay (e.g. 1500), or null
  rankByModel?: boolean;    // TD: prefer highest model %
}

export function buildMenuSlip(cands: Candidate[], opts: MenuOpts): Candidate[] {
  const pool = cands.filter((c) => opts.groups.includes(c.group));
  const n = Math.max(1, Math.min(opts.legs, 8));
  // one leg per game/player so we don't stack correlated legs from the same matchup
  const seen = new Set<string>();
  const key = (c: Candidate) => (c.kind === "line" ? c.detail : c.title.split(" ").slice(0, 2).join(" "));

  let ranked: Candidate[];
  if (opts.rankByModel) {
    ranked = pool.filter((c) => c.model !== undefined).sort((a, b) => (b.model ?? 0) - (a.model ?? 0));
  } else if (opts.targetOdds && opts.targetOdds > 0) {
    // aim for a combined ≈ target: each leg should be ~ target^(1/n) in decimal
    const perLeg = Math.pow(toDecimal(opts.targetOdds), 1 / n);
    ranked = pool.slice().sort((a, b) => Math.abs(toDecimal(a.price) - perLeg) - Math.abs(toDecimal(b.price) - perLeg));
  } else {
    // no target: the shortest (most likely) prices first
    ranked = pool.slice().sort((a, b) => toDecimal(a.price) - toDecimal(b.price));
  }

  const picked: Candidate[] = [];
  for (const c of ranked) {
    const k = key(c);
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(c);
    if (picked.length >= n) break;
  }
  return picked;
}
