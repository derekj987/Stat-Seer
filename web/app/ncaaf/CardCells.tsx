// Shared NCAAF card-table pieces so every board (homepage rows, /ncaaf/model, /ncaaf/lines)
// renders the SAME header + Game cell — identical columns, ranks, abbreviations, and kickoff.
// Pure components (no hooks), usable from both server and client tables.
import { abbrevTeam } from "@/lib/ncaafAbbrev";
import type { NcaafCardGame } from "./model-data";

const kfmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
export const kickET = (iso?: string | null): string => (iso ? kfmt.format(new Date(iso)) + " ET" : "");

// The five-column header used by every NCAAF model/market table.
export function NcaafCardHead() {
  return (
    <thead>
      <tr>
        <th className="hb-l">Game</th>
        <th>Market Spread</th>
        <th>Market O/U</th>
        <th>Model Spread</th>
        <th>Model O/U</th>
      </tr>
    </thead>
  );
}

// The Game cell: AP rank badge (per side) + abbreviated names + neutral flag + off-consensus
// diamond + kickoff. `as` lets a caller render it without the <td> wrapper if needed.
export function NcaafGameCell({ g }: { g: NcaafCardGame }) {
  return (
    <td className="hb-l">
      <span className="hb-game">
        {g.apAway ? <span className="ncf-rk">#{g.apAway}</span> : null}{abbrevTeam(g.away)}
        <span className="hb-at">at</span>
        {g.apHome ? <span className="ncf-rk">#{g.apHome}</span> : null}{abbrevTeam(g.home)}
      </span>
      {g.neutral ? <span className="ncf-site"> · N</span> : null}
      {g.off ? <span className="hb-dia hb-dia--end" aria-label="off consensus">◆</span> : null}
      {g.commence ? <span className="hb-gkick">{kickET(g.commence)}</span> : null}
    </td>
  );
}
