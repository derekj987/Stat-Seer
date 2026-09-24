import { Fragment } from "react";
import { REF_STATS } from "@/lib/refStats";
import { TEAM_RATINGS, RATINGS_SEASON, RATINGS_IS_PRIOR } from "@/lib/teamRatings";
import type { GameWeather } from "@/lib/weatherData";
import type { InjuryNote } from "@/lib/nflInactives";

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
// Still CONTEXT, not a pick. None of this is in the projection, and the block never states a lean —
// it is the same discipline the Context page carried, moved to where the decision is made.

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
const INJ_CAP = 6;

export function SpecialConsiderations({ ctx }: { ctx: SpecialCtx }) {
  const { away, home, crew, wx, injuries, feedHasAny } = ctx;
  const ra = TEAM_RATINGS[away], rh = TEAM_RATINGS[home];
  const inj = [...injuries].sort(
    (a, b) => (RANK[a.note.status] ?? 9) - (RANK[b.note.status] ?? 9) || a.player.localeCompare(b.player));
  const shown = inj.slice(0, INJ_CAP);
  return (
    <div className="impspec">
      <span className="impspec__k">Special considerations</span>
      <dl className="impspec__rows">
        {ra && rh && (
          <div className="impspec__row">
            <dt>Scoring</dt>
            <dd>
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
              <span className="impspec__note">pts/gm{RATINGS_IS_PRIOR ? ` · ${RATINGS_SEASON}` : ""}</span>
            </dd>
          </div>
        )}
        <div className="impspec__row">
          <dt>Injuries</dt>
          <dd>
            {shown.length === 0
              ? <span className="impspec__none">{feedHasAny
                  ? "Nobody carrying a designation"
                  : "Designations post Wednesday through Friday"}</span>
              : (
                <>
                  {shown.map((i) => (
                    <span className="impspec__inj" key={`${i.team}-${i.player}`}>
                      <b>{i.player}</b> <span className="impspec__tm">{i.team}</span>{" "}
                      <span className={`impspec__st impspec__st--${i.note.status.toLowerCase()}`}>{i.note.label}</span>
                      {i.note.detail && <span className="impspec__det"> · {i.note.detail.toLowerCase()}</span>}
                    </span>
                  ))}
                  {inj.length > shown.length && (
                    <span className="impspec__more">+{inj.length - shown.length} more</span>
                  )}
                </>
              )}
          </dd>
        </div>
        {wx && (
          <div className={`impspec__row${wx.windFlag ? " impspec__row--wind" : ""}`}>
            <dt>Weather</dt>
            <dd>{wx.windFlag && <b className="wxflag">⚑&nbsp;WIND</b>} {weatherText(wx)}</dd>
          </div>
        )}
        {/* Printed on every game: "assigned closer to kickoff" is a true statement with a date on
            it, and it comes true within the week. */}
        <div className="impspec__row">
          <dt>Referee</dt>
          <dd>{crew ? refereeText(crew) : <span className="impspec__none">Crew assigned closer to kickoff</span>}</dd>
        </div>
      </dl>
    </div>
  );
}
