import { Fragment } from "react";
import { REF_STATS } from "@/lib/refStats";
import { TEAM_RATINGS, RATINGS_SEASON, RATINGS_IS_PRIOR } from "@/lib/teamRatings";
import type { GameWeather } from "@/lib/weatherData";
import type { InjuryNote } from "@/lib/nflInactives";
import type { UpsetRead } from "@/lib/upsetMeter";
import { UpsetMeter } from "./UpsetMeter";

// Special Considerations, on the MODEL board under each game's Bottom Line.
//
// It used to be its own Context page — one card per game carrying site, weather, referee, team
// ratings, coaching tendencies, stakes and incentives. Derek: "move the context data (special
// considerations) into our model data... referee data, weather, current injured players, and each
// team's current defensive and offensive ratings... add a Special Considerations section under the
// Bottom Line. I want to remove the Special Considerations section completely from the Context
// section." So four factors travel and the rest is retired: a reader deciding on a game now has
// the situational facts on the same row as the number, instead of a second page to cross-check.
//
// LAYOUT: three columns — the game's own facts on the left, then one injury column per team.
// The first cut stacked everything in a single label-and-value list, which left the right half of
// a 1100px row empty and capped the injuries at six with a "+4 more" that a reader cannot expand
// (Derek: "fill in the open space and break the injuries down by teams... list them all out").
// Splitting by team is also how the list is actually read — you want one side's availability, not
// an alphabetical merge of both.
//
// Still CONTEXT, not a pick. None of this is in the projection, and the block never states a lean.

export interface SpecialCtx {
  away: string;
  home: string;
  crew?: { referee: string; tendency: string; pen: number };
  wx?: GameWeather;
  /** Players on either team carrying a designation, already filtered to this game. */
  injuries: { player: string; team: string; note: InjuryNote }[];
  /** Does the WEEK have any designations at all? An empty list means two different things —
   *  "we looked and nobody is hurt" and "the report is not in yet" — and printing the first when
   *  the second is true is the same failure as a hardcoded is-online class. Wednesday's practice
   *  report routinely lists 40+ players with no designation, so early in the week the honest
   *  answer really is the second. */
  feedHasAny: boolean;
  /** The game's Upset Meter — the Chaos Board, folded in beside the model and the context
   *  factors. Null when there is no market line to read a disagreement against. */
  upset?: UpsetRead | null;
}

const refByName = new Map(REF_STATS.map((s) => [s.name, s]));
const ord = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** The ONE crew tendency that persists year to year is the penalty rate; the rest is history. */
function refereeText(crew: { referee: string; tendency: string; pen: number }): string {
  const s = refByName.get(crew.referee);
  const read = crew.tendency === "flag-happy" ? "flag-heavy"
    : crew.tendency === "flag-light" ? "lets them play" : "average flags";
  let t = `${crew.referee} — ${read}, ~${crew.pen} pen/g`;
  if (s) t += ` · his games average ${s.total} pts`;
  return t;
}

function weatherText(w: GameWeather): string {
  if (w.indoor) return "Indoor — weather is a non-factor";
  if (w.status === "ok") {
    const bits = [
      `${w.windMph} mph wind${w.gustMph ? ` (${w.gustMph} gust)` : ""}`,
      `${w.tempF}°`,
      w.conditions,
    ].filter(Boolean);
    return bits.join(" · ") + (w.precipPct != null && w.precipPct >= 40 ? ` · ${w.precipPct}% precip` : "");
  }
  return "Forecast arrives ~2 weeks out";
}

// Out / IR / suspended first, then the game-time decisions — a bettor reads the definite ones.
const RANK: Record<string, number> = { OUT: 0, IR: 1, SUSPENDED: 2, DOUBTFUL: 3, QUESTIONABLE: 4 };
// The pill sits in a fixed track so every player's name starts at the same x. "Questionable" is
// 78px of ink and the track is 58, so it ran straight over the name beside it — Derek: "there is
// also overlapping text on top of each other". Short forms fit; the full word is on the title.
const SHORT: Record<string, string> = {
  OUT: "OUT", IR: "IR", SUSPENDED: "SUSP", DOUBTFUL: "DOUBT", QUESTIONABLE: "QUES",
};

function TeamInjuries({ team, list, feedHasAny }: {
  team: string; list: { player: string; note: InjuryNote }[]; feedHasAny: boolean;
}) {
  const sorted = [...list].sort(
    (a, b) => (RANK[a.note.status] ?? 9) - (RANK[b.note.status] ?? 9) || a.player.localeCompare(b.player));
  const outs = sorted.filter((i) => RANK[i.note.status] <= 2).length;
  return (
    <div className="impspec__col">
      <div className="impspec__colh">
        <span className="impspec__colt">{team} injuries</span>
        <span className="impspec__coln">
          {sorted.length === 0 ? "" : `${sorted.length} listed${outs ? ` · ${outs} out` : ""}`}
        </span>
      </div>
      {sorted.length === 0 ? (
        <span className="impspec__none">{feedHasAny
          ? "Nobody carrying a designation"
          : "Designations post Wednesday through Friday"}</span>
      ) : (
        <ul className="impspec__inj">
          {sorted.map((i) => (
            <li key={i.player}>
              <span className={`impspec__st impspec__st--${i.note.status.toLowerCase()}`}
                title={i.note.label}>{SHORT[i.note.status] ?? i.note.label}</span>
              <span className="impspec__p" title={i.player}>{i.player}</span>
              <span className="impspec__det">{i.note.detail ? i.note.detail.toLowerCase() : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SpecialConsiderations({ ctx }: { ctx: SpecialCtx }) {
  const { away, home, crew, wx, injuries, feedHasAny, upset } = ctx;
  const ra = TEAM_RATINGS[away], rh = TEAM_RATINGS[home];
  const byTeam = (t: string) => injuries.filter((i) => i.team === t);
  return (
    <section className="impspec" aria-label={`Special considerations, ${away} at ${home}`}>
      <span className="impspec__k">Special considerations</span>
      {upset && <UpsetMeter read={upset} />}
      <div className="impspec__cols">
        {/* Column 1 — the game's own facts. */}
        <div className="impspec__col impspec__col--game">
          {ra && rh && (
            <div className="impspec__blk">
              <span className="impspec__bh">Scoring<span className="impspec__note">pts/gm{RATINGS_IS_PRIOR ? ` · ${RATINGS_SEASON}` : ""}</span></span>
              <span className="impspec__grid">
                <span className="impspec__h" />
                <span className="impspec__h">scored</span>
                <span className="impspec__h">allowed</span>
                {([[away, ra], [home, rh]] as const).map(([tm, r]) => (
                  <Fragment key={tm}>
                    <span className="impspec__tm">{tm}</span>
                    <span><b>{r.off}</b> <span className="impspec__rank">({ord(r.offRank)})</span></span>
                    <span><b>{r.def}</b> <span className="impspec__rank">({ord(r.defRank)})</span></span>
                  </Fragment>
                ))}
              </span>
            </div>
          )}
          {wx && (
            <div className={`impspec__blk${wx.windFlag ? " impspec__blk--wind" : ""}`}>
              <span className="impspec__bh">Weather</span>
              <span className="impspec__v">{wx.windFlag && <b className="wxflag">⚑&nbsp;WIND</b>} {weatherText(wx)}</span>
            </div>
          )}
          {/* Printed on every game: "assigned closer to kickoff" is a true statement with a date
              on it, and it comes true within the week. */}
          <div className="impspec__blk">
            <span className="impspec__bh">Referee</span>
            <span className="impspec__v">{crew ? refereeText(crew) : <span className="impspec__none">Crew assigned closer to kickoff</span>}</span>
          </div>
        </div>

        {/* Columns 2 and 3 — availability, one per team, complete. */}
        <TeamInjuries team={away} list={byTeam(away)} feedHasAny={feedHasAny} />
        <TeamInjuries team={home} list={byTeam(home)} feedHasAny={feedHasAny} />
      </div>
    </section>
  );
}
