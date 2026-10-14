import { ScrollHint } from "../Nav";
import { DayHeader } from "../DayHeader";
import { etToday, groupByGameDay } from "@/lib/gameDays";
import { nhlModelRows, nhlCatByKey, type NhlModelRow } from "./NhlModelPanel";
import type { PropGame } from "@/lib/props";
import type { NhlMarket } from "@/lib/nhlProjMatch";

// The NHL player model, laid out the way the football ones are: a card per GAME, each carrying the
// two clubs' charts, inside the category tab you are on.
//
// Derek, looking at the old board: "break it down by game and set them up within the charts. Do not
// have one clump of names like this." He is right, and the reason is not only tidiness. A single
// league-wide list ordered by projection is a RANKING — the eye reads the top of it as the best
// plays of the night, which is exactly the reading this panel is not allowed to invite. Ordered
// inside a game, against the other players in that game, the same numbers answer the question a
// reader actually has: who on this ice is likely to do what tonight.
//
// The structure is deliberately identical to app/PlayerModelView.tsx — same `pmgame` cards, same
// `pmtable` rows, same day grouping, same show-more control. Every sport reading the same way is
// the product, and hockey had been the odd one out.
//
// 🚨 STILL NOT A PICK LIST. Rows are ordered by OUR OWN projection within a team, never by the gap
// to the book's number: ordering by disagreement is how a panel starts reading as a pick list.
// Nothing here has been scored against the closing line (NHL props have only been captured since
// 2026-10-09), and the page says so.

/** Players shown per team before the "see more" control. Two clubs to a card, so this is half of
 *  what a football card shows and lands in the same place. */
const LEAD = 5;

const fmt = (n: number, d: number) => n.toFixed(d);

export default function NhlPlayerBoard({ games, cat }: { games: PropGame[]; cat: NhlMarket }) {
  const c = nhlCatByKey(cat);
  const rows = nhlModelRows(games, c.key);
  if (!rows.length) {
    return (
      <div className="pmempty pmempty--solo" role="note">
        <span className="pmempty__tag">Nothing priced yet</span>
        <p>
          Our line-blind <b>{c.label.toLowerCase()}</b> read fills in as books post this
          market for the next slate.
        </p>
      </div>
    );
  }

  // One card per game, soonest first. `nhlModelRows` already sorted by projection, so pushing in
  // order keeps each team's list ranked without a second sort.
  const order: string[] = [];
  const byGame = new Map<string, NhlModelRow[]>();
  for (const r of rows) {
    let list = byGame.get(r.eventId);
    if (!list) { list = []; byGame.set(r.eventId, list); order.push(r.eventId); }
    list.push(r);
  }
  const kick = new Map(order.map((id) => [id, byGame.get(id)![0].commence]));
  order.sort((a, b) => (kick.get(a) ?? "9999").localeCompare(kick.get(b) ?? "9999"));
  const { today, tomorrow } = etToday();

  /** A game's rows split by club, away side first — the order the matchup is written in.
   *  A row whose club we could not resolve still appears, in one unlabelled section, because a
   *  missing tag is a reason to show the player without a label and never a reason to drop him. */
  const sections = (id: string): { label: string | null; rows: NhlModelRow[] }[] => {
    const list = byGame.get(id)!;
    const teams: string[] = [];
    const byTeam = new Map<string, NhlModelRow[]>();
    for (const r of list) {
      const k = r.team ?? "";
      let t = byTeam.get(k);
      if (!t) { t = []; byTeam.set(k, t); teams.push(k); }
      t.push(r);
    }
    // Untagged last; otherwise leave the order the rows arrived in, which is the away club first
    // whenever both are present.
    teams.sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0));
    return teams.map((t) => ({ label: t || null, rows: byTeam.get(t)! }));
  };

  const isGoals = c.key === "goals";
  return (
    <>
      {groupByGameDay(order, (id) => kick.get(id) ?? null, today, tomorrow).map((grp, gi) => (
        <div key={grp.key}>
          <DayHeader label={grp.label} tone={grp.tone} count={grp.total ?? grp.items.length} />
          {grp.items.map((id, i) => {
            const first = byGame.get(id)![0];
            return (
              // The first card opens and the rest start closed. Every card shut means nothing on
              // the board reads without a click; every card open is a different wall. Same rule as
              // the football boards and /audit.
              <details className="pmgame" key={id} open={gi === 0 && i === 0}>
                <summary className="pmgame__h">
                  {first.away}<span className="at">@</span>{first.home}
                  <span className="pmgame__chev" aria-hidden="true">▾</span>
                </summary>
                <div className="pmgame__body">
                  <ScrollHint />
                  {sections(id).map((sec, si) => {
                    const moreId = `nhlpm-${c.key}-${id}-${si}`;
                    const extra = Math.max(0, sec.rows.length - LEAD);
                    return (
                      <div className="hb-moretbl" key={sec.label ?? "untagged"}>
                        <input type="checkbox" id={moreId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
                        <div className="pmscroll">
                          {sec.label && <div className="pmsec__h">{sec.label}</div>}
                          <div className="pmtable pmtable--data pmtable--nhlp" role="table"
                            aria-label={`${first.away} at ${first.home}, ${sec.label ?? "players"}, ${c.label}`}>
                            <div className="pmrow pmrow--head pmrow--data" role="row">
                              <span className="pmcell pmcell--player">Player</span>
                              <span className="pmcell pmcell--num">{isGoals ? "Market" : "Book line"}</span>
                              <span className="pmcell pmcell--num">Our proj</span>
                              <span className="pmcell pmcell--num"
                                title={isGoals
                                  ? "Our chance he scores at all tonight — a probability, which is what compares to a price."
                                  : "Our chance he clears the posted line — a probability, which is what compares to a price. It is not the projection beside it: a mean and a half-point line are different statistics."}>
                                {isGoals ? "Chance to score" : "Chance over"}
                              </span>
                              <span className="pmcell pmcell--num"
                                title="Games of his own history the projection is built on. A small number is a thin read — it is shown rather than hidden.">
                                Games
                              </span>
                            </div>
                            {sec.rows.map((r, ri) => (
                              <div className={`pmrow pmrow--data${ri >= LEAD ? " hb-row--more" : ""}`}
                                role="row" key={r.player}>
                                <span className="pmcell pmcell--player">{r.player}</span>
                                <span className="pmcell pmcell--num">{isGoals ? "Anytime" : fmt(r.line, 1)}</span>
                                <span className="pmcell pmcell--num pmcell--proj">{fmt(r.proj, c.dp)}</span>
                                <span className="pmcell pmcell--num">
                                  {r.pOver === null ? <span className="bg__none">&mdash;</span>
                                    : <b className="hb-model">{(r.pOver * 100).toFixed(0)}%</b>}
                                </span>
                                <span className="pmcell pmcell--num">{r.games}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {extra > 0 && (
                          <label htmlFor={moreId} className="hb-moretbl__sum">
                            <span className="hb-more__chev" aria-hidden="true">▸</span>
                            <span className="hb-moretbl__more">See more ({extra} more player{extra === 1 ? "" : "s"})</span>
                            <span className="hb-moretbl__less">See less</span>
                          </label>
                        )}
                      </div>
                    );
                  })}
                  <p className="lp-cardfoot">{c.unit}</p>
                </div>
              </details>
            );
          })}
        </div>
      ))}
    </>
  );
}
