// Shared NCAAF card-table pieces so every board (homepage rows, /ncaaf/model, /ncaaf/lines)
// renders the SAME header + Game cell — identical columns, ranks, abbreviations, kickoff, and (when
// passed) a live/final score badge. Pure components (no hooks), usable from server and client tables.
import { abbrevTeam } from "@/lib/ncaafAbbrev";
import type { CfbScore } from "@/lib/cfbScores";
import type { NcaafCardGame } from "./model-data";

// Compact kickoff, e.g. "8/29 @3pm ET" / "8/29 @3:30pm ET" — no weekday, numeric date, and
// minutes only when non-zero, so it fits the Game cell on a phone.
const kparts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
});
export const kickET = (iso?: string | null): string => {
  if (!iso) return "";
  const p = Object.fromEntries(kparts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const ap = (p.dayPeriod || "").toLowerCase();
  const time = p.minute === "00" ? `${p.hour}${ap}` : `${p.hour}:${p.minute}${ap}`;
  return `${p.month}/${p.day} @${time} ET`;
};

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
export function NcaafGameCell({ g, score }: { g: NcaafCardGame; score?: CfbScore | null }) {
  return (
    <td className="hb-l">
      <span className="hb-game">
        {g.apAway ? <span className="ncf-rk">#{g.apAway}</span> : null}{abbrevTeam(g.away)}
        <span className="hb-at">at</span>
        {g.apHome ? <span className="ncf-rk">#{g.apHome}</span> : null}{abbrevTeam(g.home)}
      </span>
      {g.neutral ? <span className="ncf-site"> · N</span> : null}
      {g.off ? <span className="hb-dia hb-dia--end" aria-label="off consensus">◆</span> : null}
      {score ? (
        <span className={score.live ? "lsc lsc--live" : "lsc lsc--final"} title={score.detail}>
          {score.live ? <span className="lsc__dot" aria-hidden="true" /> : null}
          <span className="lsc__score">{score.awayScore}–{score.homeScore}</span>
          <span className="lsc__st">{score.live ? (score.detail || "Live") : "Final"}</span>
        </span>
      ) : null}
      {g.commence ? <span className="hb-gkick">{kickET(g.commence)}</span> : null}
    </td>
  );
}
