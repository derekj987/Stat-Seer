import type { PropGame } from "@/lib/props";
import { projFor, pOver } from "@/lib/nhlProjMatch";

// The Model panel on /nhl/props: our own number for tonight's skaters and goalies, set from each
// player's own volume without reference to the book's line, printed beside it.
//
// 🚨 IT INFORMS, IT DOES NOT VOTE. The architecture rule for this project is that panels inform and
// do not combine into a pick, and this one is the clearest case: nothing here has been measured
// against the closing line, because NHL shots props have only been captured since 2026-10-09 and
// saves since 2026-10-13. So the panel prints two numbers side by side and leaves the reader to
// read them. It does not rank, flag, colour a side, or say which one it likes.
//
// Our number is blue everywhere on this site; the book's is green. That is the whole visual
// grammar and it is doing real work here — the colours say which number came from whom.
const fmt = (n: number, d = 1) => n.toFixed(d);

interface Row {
  player: string; team: string | null; matchup: string;
  line: number; proj: number; games: number; market: "shots" | "saves"; pOver: number | null;
}

export default function NhlModelPanel({ games }: { games: PropGame[] }) {
  const rows: Row[] = [];
  for (const g of games) {
    for (const mb of g.markets) {
      const market: "shots" | "saves" | null =
        mb.market === "player_shots_on_goal" ? "shots"
        : mb.market === "player_total_saves" ? "saves" : null;
      if (!market) continue;
      const seen = new Set<string>();
      for (const q of mb.quotes) {
        if (q.line === null || seen.has(q.player)) continue;
        const p = projFor(q.player, g.home, g.away, market);
        if (!p) continue;
        seen.add(q.player);
        rows.push({ player: q.player, team: p.team, matchup: g.matchup,
                    line: q.line, proj: p.proj, games: p.games, market,
                    pOver: market === "shots" ? pOver(p.proj, q.line) : null });
      }
    }
  }
  if (!rows.length) return null;

  // Ordered by our own projection, descending — the busiest players first. Deliberately NOT by the
  // gap to the book's number: ordering by disagreement is how a panel starts reading as a pick
  // list, which is the one thing this one must not become.
  rows.sort((a, b) => b.proj - a.proj);
  const shots = rows.filter((r) => r.market === "shots");
  const saves = rows.filter((r) => r.market === "saves");

  const table = (list: Row[], label: string, unit: string) => (
    <div className="hb-formwrap">
      <table className="hb-form hb-form--nhlmodel">
        <thead>
          <tr>
            <th className="hb-l">{label}</th>
            <th>Book line</th>
            <th>Our projection</th>
            <th>Chance to go over</th>
            <th>Games</th>
          </tr>
        </thead>
        <tbody>
          {list.slice(0, 12).map((r) => (
            <tr key={`${r.market}-${r.player}`}>
              <td className="hb-l">
                {r.player}
                {r.team && <span className="propq__slot"> ({r.team})</span>}
              </td>
              <td className="hb-num">{fmt(r.line, 1)}</td>
              <td className="hb-num">{fmt(r.proj, r.market === "saves" ? 1 : 2)}</td>
              <td className="hb-num">
                {r.pOver === null ? <span className="bg__none">&mdash;</span>
                  : <b className="hb-model">{(r.pOver * 100).toFixed(0)}%</b>}
              </td>
              <td className="hb-num">{r.games}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="lp-cardfoot">{unit}</p>
    </div>
  );

  return (
    <section className="ncf-sec nhlmodel">
      <div className="lpf__head lpf__head--snap">
        <div className="lp-snaplabel">THE MODEL &mdash; LINE-BLIND</div>
      </div>
      <p className="lpf__sub">
        Our own read on tonight&apos;s players, built from each player&apos;s own volume and set{" "}
        <b>without looking at the book&apos;s line</b>. The headline number is the{" "}
        <b>chance of going over</b> the posted line, which is the figure that compares directly to a
        price. Published before puck drop and graded against what actually happens, so the record is
        there to read either way.
      </p>
      {shots.length > 0 && table(shots, "Shots on goal", "Projection is expected shots per game; the percentage is how often a player at that level clears the posted line.")}
      {saves.length > 0 && table(saves, "Goalie saves", "Expected saves per start.")}
    </section>
  );
}
