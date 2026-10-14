import type { PropGame } from "@/lib/props";
import { projFor, pOver, type NhlMarket } from "@/lib/nhlProjMatch";

// The line-blind player read: our own number for tonight's skaters and goalies, printed beside the
// book's line. Shared by the Model section (/nhl/model, one category per tab) and the Value Finder
// props tab (/nhl/props, a teaser).
//
// 🚨 IT INFORMS, IT DOES NOT VOTE. Panels inform and do not combine into a pick, and this one is
// the clearest case: nothing here has been scored against the closing line, because NHL shots props
// have only been captured since 2026-10-09 and saves since 2026-10-13. It prints the numbers side
// by side and leaves the reader to read them — no ranking by disagreement, no flagged side.
//
// Our number is blue everywhere on this site; the book's is plain. The colours say which number
// came from whom, and that is the whole visual grammar.

/** The categories, in the order the project's own findings rank them: shots first because volume
 *  is what persists (r = 0.949), goals last because a goal is a shot times a shooting percentage
 *  and that second term barely repeats (r = 0.563). */
export interface NhlCat { key: NhlMarket; label: string; unit: string; dp: number }
export const NHL_MODEL_CATS: NhlCat[] = [
  { key: "shots",   label: "Shots on goal", unit: "Expected shots per game.", dp: 2 },
  { key: "points",  label: "Points",        unit: "Expected points per game.", dp: 2 },
  { key: "assists", label: "Assists",       unit: "Expected assists per game.", dp: 2 },
  { key: "goals",   label: "Goals",         unit: "Expected goals per game; the percentage is the chance of scoring at all.", dp: 2 },
  { key: "saves",   label: "Goalie saves",  unit: "Expected saves per start.", dp: 1 },
];
export const nhlCatByKey = (k: string): NhlCat =>
  NHL_MODEL_CATS.find((c) => c.key === k) ?? NHL_MODEL_CATS[0];

// Which prop market on the board feeds each category. Goals is the anytime-scorer market, which
// carries no line at all — it is already a probability, so its "line" is the implicit 0.5.
const FEED: Record<NhlMarket, string> = {
  shots: "player_shots_on_goal",
  points: "player_points",
  assists: "player_assists",
  goals: "player_goal_scorer_anytime",
  saves: "player_total_saves",
};
const GOALS_LINE = 0.5;

const fmt = (n: number, d: number) => n.toFixed(d);

interface Row {
  player: string; team: string | null; matchup: string;
  line: number; proj: number; games: number; pOver: number | null;
}

/** Every category's rows, so a page can show one tab or all of them. */
export function nhlModelRows(games: PropGame[], cat: NhlMarket): Row[] {
  const feed = FEED[cat];
  const rows: Row[] = [];
  for (const g of games) {
    for (const mb of g.markets) {
      if (mb.market !== feed) continue;
      const seen = new Set<string>();
      for (const q of mb.quotes) {
        if (seen.has(q.player)) continue;
        // Anytime goal has no line; every other market must carry one.
        const line = cat === "goals" ? GOALS_LINE : q.line;
        if (line === null) continue;
        const p = projFor(q.player, g.home, g.away, cat);
        if (!p) continue;
        seen.add(q.player);
        rows.push({ player: q.player, team: p.team, matchup: g.matchup,
                    line, proj: p.proj, games: p.games,
                    pOver: pOver(cat, p.proj, line) });
      }
    }
  }
  // Ordered by our own projection, descending. Deliberately NOT by the gap to the book's number:
  // ordering by disagreement is how a panel starts reading as a pick list.
  rows.sort((a, b) => b.proj - a.proj);
  return rows;
}

export default function NhlModelPanel({ games, cat = "shots", limit = 12, heading = true }: {
  games: PropGame[];
  cat?: NhlMarket;
  /** Rows shown. The props tab shows a teaser; the Model section shows the board. */
  limit?: number;
  /** The Model section supplies its own masthead, so it suppresses this one. */
  heading?: boolean;
}) {
  const c = nhlCatByKey(cat);
  const rows = nhlModelRows(games, c.key);
  if (!rows.length) return null;

  return (
    <section className="ncf-sec nhlmodel">
      {heading && (
        <div className="lpf__head lpf__head--snap">
          <div className="lp-snaplabel">THE MODEL &mdash; LINE-BLIND</div>
        </div>
      )}
      <div className="hb-formwrap">
        <table className="hb-form hb-form--nhlmodel">
          <thead>
            <tr>
              <th className="hb-l">{c.label}</th>
              <th>{c.key === "goals" ? "Market" : "Book line"}</th>
              <th>Our projection</th>
              <th>{c.key === "goals" ? "Chance to score" : "Chance to go over"}</th>
              <th>Games</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={`${c.key}-${r.player}`}>
                <td className="hb-l">
                  {r.player}
                  {r.team && <span className="propq__slot"> ({r.team})</span>}
                </td>
                <td className="hb-num">{c.key === "goals" ? "Anytime" : fmt(r.line, 1)}</td>
                <td className="hb-num">{fmt(r.proj, c.dp)}</td>
                <td className="hb-num">
                  {r.pOver === null ? <span className="bg__none">&mdash;</span>
                    : <b className="hb-model">{(r.pOver * 100).toFixed(0)}%</b>}
                </td>
                <td className="hb-num">{r.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="lp-cardfoot">{c.unit}</p>
      </div>
    </section>
  );
}
