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
//
// `bl` adds the Bottom Line column (Derek: "we also need our bottom line row in the NCAAF section
// as well"). It is OPT-IN rather than always-on because LandingHub renders this same header over
// rows that carry five cells — adding a sixth <th> unconditionally would leave that table one
// header wider than its body, which is the column-misalignment bug in its purest form.
export function NcaafCardHead({ bl }: { bl?: boolean } = {}) {
  return (
    <thead>
      <tr>
        <th className="hb-l">Game</th>
        <th>Market Spread</th>
        <th>Market O/U</th>
        <th>Model Spread</th>
        <th>Model O/U</th>
        {bl && <th>Bottom Line</th>}
      </tr>
    </thead>
  );
}

/** The Bottom Line cell: which side of the MARKET spread our projection covers, plus the O/U lean.
 *
 *  Both numbers already exist in the export — `pick` and `totalLean` in cfb_export.py — so this
 *  renders them rather than recomputing anything. It deliberately mirrors the NFL board's wording
 *  (`bottomLine()` in app/model/page.tsx) so the two sports read the same.
 *
 *  Note the two boards use different O/U thresholds: the NFL leans at a 1-point gap, college at 2
 *  (cfb_export). That is college's existing choice and not something to quietly harmonise here —
 *  college totals are both higher and noisier, so the wider band is doing real work. */
export function NcaafBottomCell({ g }: { g: NcaafCardGame }) {
  // No market number, or a side we cannot rate, means there is no read to state.
  if (g.rated === false || !g.pick) {
    return <td className="hb-num hb-bl" data-l="Bottom line"><span className="hb-bl__none">—</span></td>;
  }
  const num = g.pick.num > 0 ? `+${g.pick.num}` : `${g.pick.num}`;
  return (
    <td className="hb-num hb-bl" data-l="Bottom line">
      <b>{abbrevTeam(g.pick.side)} {num}</b>
      {g.totalLean && <span className="hb-bl__t"> and <b>the {g.totalLean.dir.toLowerCase()}</b></span>}
    </td>
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
