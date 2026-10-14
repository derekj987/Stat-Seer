import { Fragment } from "react";
import { NHL_RATINGS, type NhlTeamRating } from "@/lib/nhlGameModel";
import type { NhlGameProj } from "@/lib/nhlGame";
import { etDayKey } from "@/lib/gameDays";

// One game card on /nhl/model, built to read as closely to the NFL model's cards as hockey allows
// (Derek: "setup the NHL model as close to the cards on the NFL model as possible"). It reuses the
// NFL's own classes rather than copying them — the same `impgame` shell, the same six-column
// `improw` breakdown with its own header, and a `impspec` considerations block underneath in the
// same three-column shape: the game's own facts on the left, then one column per team.
//
// 🚨 WHAT HOCKEY DOES NOT HAVE, AND IS NOT INVENTED TO FILL THE CARD. The NFL block carries
// scoring, weather, referee and per-team injuries. Hockey is indoors, this project captures no NHL
// referee assignments, and there is no NHL injury feed here. Those rows are absent rather than
// stubbed: padding the card with something shaped like them is the appearance-of-rigor machine the
// project exists against.
//
// What hockey HAS that the NFL card does not is rest and goaltending. A back-to-back is knowable
// from the schedule alone and is the single fact that most often decides who starts in net. And
// because the NHL publishes no projected starter (the API only shows who actually played), the
// goaltending column states who HAS been starting, which is a different claim — so the column says
// so instead of implying a lineup.

const RATING = new Map(NHL_RATINGS.map((r) => [r.team, r]));
const ord = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** Clear days between a team's last game and this one; 0 is a back-to-back. Null when we have no
 *  last game for them (season opener, or a club with no results yet).
 *
 *  Both sides are compared as calendar DAY KEYS, never as timestamps: `lastGame` is the NHL's own
 *  game date and the puck drop is an instant, so subtracting them raw makes a 7pm game "0.9 days"
 *  after a 10pm one. The kickoff is reduced to its Eastern day the same way every board on this
 *  site groups games. */
function restDays(lastGame: string | null | undefined, commence: string): number | null {
  if (!lastGame) return null;
  const a = Date.parse(`${lastGame}T00:00:00Z`);
  const b = Date.parse(`${etDayKey(commence)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = Math.round((b - a) / 86_400_000) - 1;
  return d < 0 ? null : d;
}

const restWord = (d: number | null) =>
  d === null ? "—" : d === 0 ? "back-to-back" : d === 1 ? "1 day" : `${d} days`;

/** Who has actually been starting in goal, with the save percentage they have managed. */
function GoalieColumn({ team, rating }: { team: string; rating: NhlTeamRating | undefined }) {
  const list = rating?.goalies ?? [];
  const starts = list.reduce((n, g) => n + g.starts, 0);
  return (
    <div className="impspec__col">
      <div className="impspec__colh">
        <span className="impspec__colt">{team} goaltending</span>
        <span className="impspec__coln">{starts ? `${starts} start${starts === 1 ? "" : "s"}` : ""}</span>
      </div>
      {list.length === 0 ? (
        <span className="impspec__none">No starts recorded this season yet</span>
      ) : (
        <ul className="impspec__backl">
          {list.map((g) => (
            <li key={g.name}>
              <b>{g.name}</b>
              <span className="impspec__rank"> {g.starts} {g.starts === 1 ? "start" : "starts"}</span>
              {g.savePct !== null && (
                <span className="impspec__det"> · {(g.savePct * 100).toFixed(1)}% saves</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NhlGameCard({ g, p, mkt }: {
  g: { eventId: string; home: string; away: string; commence: string; total: number | null };
  p: NhlGameProj;
  mkt: number | null;
}) {
  const rh = RATING.get(p.homeAbbr), ra = RATING.get(p.awayAbbr);
  // Favourite-and-number, the way every other board on this site writes a spread.
  const spread = (m: number) => `${m > 0 ? p.homeAbbr : p.awayAbbr} -${Math.abs(m).toFixed(1)}`;
  const restH = restDays(rh?.lastGame, g.commence);
  const restA = restDays(ra?.lastGame, g.commence);
  const b2b = restA === 0 || restH === 0;

  return (
    <div className="impgame">
      {/* Each game carries its own column header, same as the NFL card: the considerations block
          below is tall enough that a single header per day is off screen by the second game. */}
      <h4 className="impsec impsec--first">Market vs model breakdown</h4>
      <div className="improw improw--head" role="row">
        <span>game</span><span>spread</span><span>total</span>
        <span className="improw__modh improw__modstart">model spread</span>
        <span className="improw__modh">model total</span>
        <span className="improw__blh">bottom line</span>
      </div>
      <div className="improw" role="row">
        <span className="improw__g">{g.away}<span className="at">@</span>{g.home}</span>
        {/* 🚨 THE MARKET SPREAD IS THE MONEYLINE IN GOALS, NOT THE PUCK LINE. The puck line is
            ±1.5 on every game in the league, so a column of it would print one number down the
            page — the same thing the MLB board found with the run line. */}
        <span className="improw__sp">{mkt === null ? "—" : spread(mkt)}</span>
        <span className="improw__tot">{g.total === null ? "—" : g.total.toFixed(1)}</span>
        <span className="improw__mod improw__modstart">
          {spread(p.margin)}
          {mkt !== null && Math.sign(mkt) !== Math.sign(p.margin) && (
            <span className="offcmark" title="Off consensus — our number favours the other side">⚑</span>
          )}
        </span>
        <span className="improw__mod">{p.total.toFixed(1)}</span>
        {/* 🚨 THE BOTTOM LINE IS A WIN CHANCE, AND NOTHING ELSE. The NFL card names a side against
            the spread and a side on the total. Neither is available here and both were tried:
            hockey has no spread to name a side against (±1.5 on every game), and our total is
            measured at +0.07% over "always say the league average" with an MAE of 1.86 goals — so
            a card reading "and the over" because our 6.2 sits 0.7 above a 5.5 would be calling a
            side off a gap three times smaller than the number's own error. Both totals are printed
            in their own columns; the reader can see the difference without being told it means
            something. */}
        <span className="improw__bl">
          <b>{(p.homeWinPct * 100).toFixed(0)}%</b> {p.homeAbbr} to win
        </span>
      </div>

      <section className="impspec" aria-label={`Special considerations, ${g.away} at ${g.home}`}>
        <h4 className="impsec">Special considerations</h4>
        <div className="impspec__cols">
          {/* Column 1 — the game's own facts. */}
          <div className="impspec__col impspec__col--game">
            {ra && rh && (
              <div className="impspec__blk">
                <span className="impspec__bh">Scoring<span className="impspec__note">goals/gm · this season</span></span>
                <span className="impspec__grid">
                  <span className="impspec__h" />
                  <span className="impspec__h">scored</span>
                  <span className="impspec__h">allowed</span>
                  {([[p.awayAbbr, ra], [p.homeAbbr, rh]] as const).map(([tm, r]) => (
                    <Fragment key={tm}>
                      <span className="impspec__tm">{tm}</span>
                      <span><b>{r.attack.toFixed(2)}</b> <span className="impspec__rank">({ord(r.gfRank)})</span></span>
                      <span><b>{r.defence.toFixed(2)}</b> <span className="impspec__rank">({ord(r.gaRank)})</span></span>
                    </Fragment>
                  ))}
                </span>
              </div>
            )}
            <div className="impspec__blk">
              <span className="impspec__bh">Rest<span className="impspec__note">days off before this game</span></span>
              <span className="impspec__v">
                <b>{p.awayAbbr}</b> {restWord(restA)} · <b>{p.homeAbbr}</b> {restWord(restH)}
              </span>
              {/* §14c: there is NO measurable back-to-back scoring penalty in the raw data, and the
                  model carries no rest term. The flag is here because of what it predicts about the
                  LINEUP, and the wording keeps that distinction. */}
              {b2b && (
                <span className="impspec__note">
                  a second night usually means the backup starts — the model carries no rest penalty
                </span>
              )}
            </div>
          </div>

          {/* Columns 2 and 3 — goaltending, one per team, in the slot the NFL card gives injuries. */}
          <GoalieColumn team={p.awayAbbr} rating={ra} />
          <GoalieColumn team={p.homeAbbr} rating={rh} />
        </div>
        {/* Stated once under both columns rather than twice inside them — the caveat is about the
            feed, not about either club. */}
        <span className="impspec__note">
          Goaltending is who <i>has</i> started, not who is announced — the NHL publishes no
          projected starter, so no board can show one before warm-ups.
        </span>
      </section>
    </div>
  );
}
