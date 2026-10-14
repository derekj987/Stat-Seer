import { DayHeader } from "../DayHeader";
import { groupByGameDay } from "@/lib/gameDays";
import { UpsetMeter } from "../UpsetMeter";
import { mlbUpsetMeter } from "@/lib/mlbUpset";
import { MLB_TEAMS, type MlbGame } from "@/lib/mlbGameModel";
import type { Game } from "@/lib/board";
import { marketMargin } from "@/lib/mlbBoard";

// The Upset Meter on the MLB board (Derek: "add the Upset Meter to the MLB cards too").
//
// 🚨 A PANEL, NOT A COLUMN, AND NOT A CARD BOARD — and both halves of that are deliberate.
//
// Baseball has no per-game cards and should not get them for this. The model board is a CHART on
// purpose: fifteen games a night against football's sixteen a week, so the card layout that reads
// well on a Sunday becomes four screens of scrolling on a Tuesday. Converting it would undo a
// decision that was made for a measured reason.
//
// Nor can the meter be a column in that chart. The drivers ARE the meter — a reader who disagrees
// needs to see which factor carried the reading — and a 24px cell can hold a number but not four
// labelled bars. The chart's column budget is also full; it is the one table on the site whose
// cells are forbidden to wrap, because a wrapping cell makes ragged rows.
//
// So it sits where the lineups sit: its own panel underneath, one block per game, in the order the
// games start. Same component, same 0-100 scale and same three tiers as every other board.
//
// Capped like the chart above it, with the same show-more control, because a fifteen-game Tuesday
// would otherwise bury the rest of the page.

const CAP = 4;
const BY_ABBR = new Map(MLB_TEAMS.map((t) => [t.team, t]));

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
});
const kickTime = (iso: string) =>
  timeFmt.format(new Date(iso)).replace(/\s?([AP])M/, (_m, x) => x.toLowerCase());

export default function MlbUpsetPanel({ games, mktFor, leagueRuns, today, tomorrow }: {
  games: MlbGame[];
  mktFor: Map<string, Game>;
  /** League runs per club per game — the rate each club's own is read against. */
  leagueRuns: number;
  today: string; tomorrow: string;
}) {
  if (!games.length) {
    return <p className="foot">No upcoming games to read yet. This fills with the board above.</p>;
  }
  return (
    <>
      {groupByGameDay(games, (g) => g.commence, today, tomorrow).map((grp) => {
        const moreId = `mlb-up-${grp.key.replace(/[^a-z0-9]/gi, "")}`;
        const hidden = Math.max(0, grp.items.length - CAP);
        return (
          <div key={grp.key}>
            <DayHeader label={grp.label} tone={grp.tone} count={grp.total ?? grp.items.length} />
            <div className="hb-moretbl">
              <input type="checkbox" id={moreId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
              <div>
                {grp.items.map((g, i) => {
                  const m = mktFor.get(g.gameKey);
                  const mkt = m ? marketMargin(m) : null;
                  const homeIsDog = mkt === null ? null : mkt < 0;
                  const dog = homeIsDog === null ? null : homeIsDog ? g.homeAbbr : g.awayAbbr;
                  const fav = homeIsDog === null ? null : homeIsDog ? g.awayAbbr : g.homeAbbr;
                  const read = mlbUpsetMeter({
                    marketMarginHome: mkt,
                    modelMarginHome: g.homeRuns - g.awayRuns,
                    home: BY_ABBR.get(g.homeAbbr), away: BY_ABBR.get(g.awayAbbr),
                    // The model defaults an unknown arm to exactly 1.0, so the NAME is what says
                    // whether a starter is actually known. Passing the default through would draw
                    // a confident bar on a game with no probable posted.
                    homeSpFactor: g.homeSpName ? g.homeSpFactor : null,
                    awaySpFactor: g.awaySpName ? g.awaySpFactor : null,
                    leagueRuns,
                  }, dog, fav);
                  return (
                    <div className={`impgame${i >= CAP ? " hb-row--more" : ""}`} key={g.gameKey}>
                      <h4 className="impsec impsec--first">
                        {g.awayAbbr} @ {g.homeAbbr}
                        <span className="pmslot"> ({kickTime(g.commence)})</span>
                        {dog && <span className="pmslot"> · {dog} are the underdog</span>}
                      </h4>
                      {mkt === null ? (
                        // No market, no underdog, nothing to be upset. Said rather than drawn as a
                        // 50 — the meter measures a disagreement with a price, and there is no price.
                        <p className="impbottom impbottom__none">
                          No moneyline posted yet — the meter reads a disagreement with a price, and
                          it takes a price to say which side is the underdog.
                        </p>
                      ) : (
                        <UpsetMeter read={read} tip={<MlbUpsetTip leagueRuns={leagueRuns} />} />
                      )}
                    </div>
                  );
                })}
              </div>
              {hidden > 0 && (
                <label htmlFor={moreId} className="hb-moretbl__sum">
                  <span className="hb-more__chev" aria-hidden="true">▸</span>
                  <span className="hb-moretbl__more">Show {hidden} more game{hidden === 1 ? "" : "s"}</span>
                  <span className="hb-moretbl__less">Show fewer</span>
                </label>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** The scroll, baseball's version. Football's describes weather and referee drivers this panel does
 *  not have and omits the one baseball actually turns on. */
function MlbUpsetTip({ leagueRuns }: { leagueRuns: number }) {
  return (
    <>
      <span className="tip__lead">How upset-prone this game looks, 0-100 — and every number behind
        it. It is context, not a pick, and nothing here feeds The Model or the Value
        Finder.</span><br /><br />
      <b>The headline number</b> is a weighted blend of the drivers below. Above <b>62</b> reads as
      a live upset spot, <b>48-61</b> worth a look, under 48 means the favourite should hold. A
      driver a game does not have yet drops out and the rest re-weight, so the scale always runs
      0-100.<br /><br />
      <b>Each driver is 0-100 too, where 50 is a neutral game.</b> Higher means that factor argues
      MORE for an upset.<br /><br />
      <b>Our model (weight 40)</b> — our line-blind projected margin against the market&apos;s
      number. 40 means we agree with the market; it climbs as our number leans toward the underdog
      and tops out when we project the dog to win outright. This is the only driver with a graded,
      published track record, which is why it carries the most. A run is a big number in baseball,
      so the dial is scaled to runs: a full run of disagreement sits where a touchdown sits on the
      football board.<br /><br />
      <b>Scoring (18)</b> — the underdog&apos;s runs scored and the favourite&apos;s runs allowed,
      each against the league rate of {leagueRuns.toFixed(2)} a game, and with the ballpark divided
      out so they describe the club rather than the club plus its stadium.<br /><br />
      <b>Pitching (14)</b> — tonight&apos;s two starters, measured against the league&apos;s run
      rate. This is the factor baseball actually turns on: when the model was tested, team quality
      on its own was worth nothing and the starting pitcher and the ballpark were what moved it. It
      is already inside our number above, so the two drivers are not independent — it is drawn
      separately because it is the thing a reader wants to see. It only appears once both probables
      are posted; an unknown arm is not an average one.<br /><br />
      <b>Chaos (16)</b> — how streaky the favourite has been and how big the underdog&apos;s best
      night has been this season. Deliberately <b>non-predictive</b> — it is flavour. Read its ends
      gently: across the 30 clubs this runs from about 3.9 to 5.3 runs of game-to-game swing, which
      is a narrower band than a 0-100 bar makes it look.<br /><br />
      <b>What is deliberately not in it.</b> No weather — we capture forecasts for NFL stadiums,
      not ballparks, and wind at Wrigley is a real baseball factor we simply do not have. No umpire
      — the plate zone is baseball&apos;s referee and we track no assignments. And no bullpen,
      recent form, lineup strength or home field: each was tested against the model itself and none
      of them improved it, so none of them earns a bar here either.
    </>
  );
}
