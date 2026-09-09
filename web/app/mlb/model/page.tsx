import { Brand, FlowSteps, ModelSubnav } from "../../Nav";
import PinButton from "../../PinButton";
import { DayHeader } from "../../DayHeader";
import Tip from "../../Tip";
import { etToday, etDayKey, groupByGameDay } from "@/lib/gameDays";
import { MLB_GAMES, MLB_GAME_SCORES } from "@/lib/mlbGameModel";
import { MLB_AVAIL, type MlbAvail } from "@/lib/mlbAvailability";
import { mlbBoard, marketMargin } from "@/lib/mlbBoard";

// MLB · Game Model — the spreads/totals half of the section, beside Player Props.
//
// A CHART rather than the football boards' cards, and that is a data decision, not a style one:
// baseball plays fifteen games a night against football's sixteen a WEEK, so a card layout that
// reads well on Sunday becomes four screens of scrolling on a Tuesday. Everything else is kept
// identical to NFL/NCAAF on purpose — same masthead, FlowSteps, ModelSubnav, day grouping, hb-panel
// shells and pm* table classes. Every sport reading the same way is the product.
//
// NO SIDE PICK. Both spreads are expected MARGINS in runs, never a bet. The posted run line is
// deliberately absent: it is a fixed +/-1.5 on every game, so a run-line column printed -1.5 down
// almost every row and read as "we make everyone a favourite" while carrying no information at all.
// The market's side is read from the moneyline instead (marketMargin in lib/mlbBoard.ts).
//
// COPY LIVES IN THE SCROLL. One legend line on the board; the caveats, the measured gain and the
// calibration go in the Tip. Paragraphs of hedging stacked above a chart are a wall nobody reads,
// which is worse for honesty than one line plus a click.

export const metadata = {
  title: "StatSeer — MLB Game Model",
  description:
    "Line-blind MLB run projections published beside the market's total, grouped by day and graded after.",
};
export const revalidate = 300;

const S = MLB_GAME_SCORES;
// Measured on 2026: 30 teams, 4,464 completed team-games, 21,304 held-out candidate rows.
const BRIER = { model: 0.16102, persistence: 0.22894, gain: 29.7 };
// A lineup IS nine. The rest of the candidate pool folds away behind the standard control.
const LU_CAP = 9;
// Games shown per day before the dropdown. A full MLB day is 15, which runs the card well past a
// screen.
const GAME_CAP = 4;

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** First pitch, Eastern, compact — the day is already the group header, so the date would repeat. */
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
});
const kickTime = (iso: string) => timeFmt.format(new Date(iso)).replace(/\s?([AP])M/, (_m, x) => x.toLowerCase());
/** A margin as a bettor reads it: how many runs, and WHO is getting them.
 *
 *  A bare "-1.3" was unreadable twice over. MLB posts no such number (the run line is a fixed
 *  ±1.5; this is a margin derived from the moneyline), and nothing on the row said which club it
 *  belonged to — so the reader could not tell a home favourite from an away one. The sign carried
 *  the answer and the sign was invisible.
 *
 *  Our convention is home MINUS away, so POSITIVE = home favoured. The legend used to claim the
 *  opposite ("-0.6 means the home club is favoured"), which contradicted every row on the board.
 *  Naming the club removes the need to know the convention at all. */
const spread = (x: number, homeAbbr: string, awayAbbr: string) => {
  if (Math.abs(x) < 0.05) return "pick";
  return `−${Math.abs(x).toFixed(1)} (${x > 0 ? homeAbbr : awayAbbr})`;
};

export default async function Page() {
  const { today: todayEt, tomorrow: tomorrowEt } = etToday();
  // Drop games that have already started. The data file is rebuilt once a day, so by the evening it
  // still carried this afternoon's games — and they are worse than clutter: the odds board drops a
  // game at first pitch, so every one of them showed "—" in BOTH market columns, and a pre-game
  // line-blind projection is not something anyone can act on once the game is under way.
  // revalidate=300 means a game leaves the board within five minutes of starting.
  const nowIso = new Date().toISOString();
  const upcoming = MLB_GAMES.filter((g) => g.commence > nowIso);

  // Market numbers. A failure here must not take the model board down with it — the projections
  // are static and the odds are a network read, so the board degrades to "—" in the market column
  // rather than to an error page.
  const { board } = await mlbBoard().catch(() => ({ board: [] as Awaited<ReturnType<typeof mlbBoard>>["board"] }));
  // Joined on the EASTERN day plus the matchup. Not the UTC day: a 9:40pm Pacific first pitch is
  // already tomorrow in UTC, which is precisely the collision that made the model's own game keys
  // wrong. Both sides derive the ET day from the same real timestamp, so this holds.
  const mkt = new Map(board.map((g) => [`${etDayKey(g.commence)}|${g.matchup}`, g]));

  const keys = upcoming.map((g) => g.gameKey);
  const byKey = new Map(upcoming.map((g) => [g.gameKey, g]));
  const kick = new Map(upcoming.map((g) => [g.gameKey, g.commence]));

  // Lineups, grouped by game underneath the chart.
  const luGames: string[] = [];
  const luByGame: Record<string, MlbAvail[]> = {};
  const luLabel: Record<string, string> = {};
  const luKick: Record<string, string> = {};
  for (const r of MLB_AVAIL) {
    if (r.commence <= nowIso) continue;                  // started — same rule as the chart above
    if (!luByGame[r.gameKey]) { luByGame[r.gameKey] = []; luGames.push(r.gameKey); luLabel[r.gameKey] = r.game; }
    luByGame[r.gameKey].push(r);
    if (!luKick[r.gameKey] || r.commence < luKick[r.gameKey]) luKick[r.gameKey] = r.commence;
  }
  luGames.sort((a, b) => (luKick[a] ?? "9999").localeCompare(luKick[b] ?? "9999"));

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">MLB</span> · The Model</>} />
      </header>
      <FlowSteps active="analyze" base="mlb" />
      <div className="subnavrow"><ModelSubnav active="game" base="mlb" /></div>

      <details className="hb-panel hb-panel--card" data-embedchart="mlb-game-model" open>
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">Runs crunched</span>
          <span className="hb-bar__count">{upcoming.length} game{upcoming.length === 1 ? "" : "s"}</span>
          <PinButton size="sm" pin={{ id: "/mlb/model", kind: "model", label: "MLB · Game Model", detail: "runs + totals", href: "/mlb/model" }} />
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          {/* One line on the board, everything else behind the scroll. Five paragraphs of caveat
              above a chart is not honesty, it is a wall nobody reads — the numbers still have to
              be one click away, which is what the Tip is for. */}
          <p className="ctxsec__legend">
            <span className="lgnd lgnd--mkt">Market</span> spread and total, then{" "}
            <span className="lgnd lgnd--model">ours</span>. A spread reads{" "}
            <b>−1.3 (TOR)</b> — Toronto favoured by 1.3 runs.
            <Tip label="About the MLB game model" text={<>
              <b>How it works.</b> Each side&apos;s offence against the other&apos;s defence,
              adjusted for the starting pitcher. Line-blind — it never sees the market columns.<br /><br />
              <b>Why runs, not a run line?</b> Baseball&apos;s run line is a fixed ±1.5 on every
              game, so it says nothing about who is favoured by how much. In baseball that lives in
              the moneyline, so we strip the vig off the two prices and convert the fair win
              probability into runs. <b>These are not posted lines</b> — you will not find −1.3 at a
              sportsbook; it is the market&apos;s own price expressed in runs so it can sit beside
              ours.<br /><br />
              <b>What it is worth.</b> Over {S.n} held-out games, <b>{S.gain}%</b> closer than
              assuming {S.meanTotal} runs every time. That is small because of the sport: one game
              averages {S.meanTotal} runs with an SD of <b>{S.sd}</b>. Team quality alone measured{" "}
              <b>0.0%</b> — only the starting pitcher moved the number.<br /><br />
              <b>The gaps you can see.</b> Our totals sit above the market&apos;s on most games,
              and our spreads below it. Neither is us running hot: against real results our total
              averages <b>{S.resid >= 0 ? "+" : ""}{S.resid.toFixed(2)}</b> runs of error and has
              been <i>too low</i> in four of six months, while the market prices this stretch about
              0.8 runs under what the season has produced. Our margins average{" "}
              <b>{S.marMean.toFixed(1)}</b> runs against real margins of <b>{S.marActual.toFixed(1)}</b>{" "}
              — the model is timid, not bold, and beats a coin flip on the side by{" "}
              <b>{S.marGain}%</b>.<br /><br />
              <b>No pick.</b> Whether we or the market are right is a closing-line question, and we
              only began recording MLB odds on <b>7 September</b>. A gap here is a difference to
              notice, not an edge to act on.
            </>} />
          </p>

          {upcoming.length === 0 ? (
            <p className="foot">No upcoming games projected yet. The board fills as probable starters post.</p>
          ) : (
            groupByGameDay(keys, (k) => kick.get(k) ?? null, todayEt, tomorrowEt).map((grp) => {
              // Cap INSIDE the one table, never by slicing it into two — a second table would
              // scroll sideways independently of the first and its continuation would have no
              // header. The hidden rows get hb-row--more and the checkbox reveals them in place.
              const moreId = `mlb-gm-${grp.key.replace(/[^a-z0-9]/gi, "")}`;
              const hidden = Math.max(0, grp.items.length - GAME_CAP);
              return (
              <div key={grp.key}>
                <DayHeader label={grp.label} tone={grp.tone} count={grp.total ?? grp.items.length} />
                <div className="hb-moretbl">
                  <input type="checkbox" id={moreId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
                  <div className="pmscroll">
                    <div className="pmtable pmtable--mlbg" role="table">
                      {/* pmrow--data is what carries display:grid — a header with only
                          pmrow--head stays display:flex and its labels pack left, out of line
                          with the numbers underneath. Match PlayerModelView.tsx.
                          Column ORDER is the football boards' order: the two MARKET numbers
                          together, then the two OURS together, so each pair reads as a pair. */}
                      <div className="pmrow pmrow--head pmrow--data" role="row">
                        <span>game</span><span>starting pitchers</span>
                        <span>market spread</span><span>market total</span>
                        <span>our spread</span><span>our total</span>
                      </div>
                      {grp.items.map((k, i) => {
                        const g = byKey.get(k)!;
                        const m = mkt.get(`${etDayKey(g.commence)}|${g.game}`);
                        const mt = m?.total?.consensus ?? null;
                        const ms = m ? marketMargin(m) : null;
                        // Home minus away, the same sign convention as the market column, so a
                        // reader compares two numbers that mean the same thing.
                        const os = g.homeRuns - g.awayRuns;
                        const sp = [
                          g.awaySpName && `${g.awaySpName} (${g.awayAbbr})`,
                          g.homeSpName && `${g.homeSpName} (${g.homeAbbr})`,
                        ].filter(Boolean).join(" / ");
                        return (
                          <div className={`pmrow pmrow--data${i >= GAME_CAP ? " hb-row--more" : ""}`}
                            role="row" key={k}>
                            <span className="pmcell pmcell--player">
                              {g.game}<span className="pmslot"> ({kickTime(g.commence)})</span>
                            </span>
                            <span className="pmcell pmcell--team">{sp || "not posted"}</span>
                            <span className="pmcell pmcell--mkt">
                              {ms !== null ? spread(ms, g.homeAbbr, g.awayAbbr) : "—"}
                            </span>
                            <span className="pmcell pmcell--mkt">{mt !== null ? mt.toFixed(1) : "—"}</span>
                            <span className="pmcell pmcell--proj">{spread(os, g.homeAbbr, g.awayAbbr)}</span>
                            <span className="pmcell pmcell--proj">{g.total.toFixed(1)}</span>
                          </div>
                        );
                      })}
                    </div>
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
            })
          )}
        </div>
      </details>

      <details className="hb-panel hb-panel--card" data-embedchart="mlb-availability">
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">Who&apos;s playing tonight</span>
          <span className="hb-bar__count">{luGames.length} game{luGames.length === 1 ? "" : "s"}</span>
          <PinButton size="sm" pin={{ id: "/mlb/model#lineups", kind: "model", label: "MLB · Lineups", detail: "who starts tonight", href: "/mlb/model" }} />
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          {/* Derek read this board twice and asked both times what it was for, so the answer has to
              be ON the page — but as one line plus a scroll, not the three paragraphs it was. */}
          <p className="ctxsec__legend">
            Our estimate of who starts tonight, until the real lineup posts.{" "}
            <b>Start %</b> = chance he plays. <b>Slot</b> = where he bats.
            <Tip label="About tonight's lineups" text={<>
              <b>Why this exists.</b> A football team&apos;s starting eleven is the same most weeks.
              A baseball manager rests people constantly — about two of the nine slots turn over
              every night — and the lineup card only posts about three hours before first pitch. So
              at lunchtime nobody knows who is playing.<br /><br />
              <b>Start %</b> is the chance he is in tonight&apos;s lineup. Most books void a prop if
              he never plays, so it is about whether your bet <i>happens</i>, not whether it
              wins.<br /><br />
              <b>Batting slot</b> decides how many times he comes to the plate — leading off is
              about 4.5 chances, batting ninth about 3.4. Both numbers feed every projection on the{" "}
              <a href="/mlb/model/players">Player Props</a> board.<br /><br />
              <b>What it is worth.</b> Over 21,304 held-out player-games it scores a Brier of{" "}
              <b>{BRIER.model.toFixed(3)}</b> against <b>{BRIER.persistence.toFixed(3)}</b> for
              simply repeating last night&apos;s lineup — <b>{BRIER.gain}% better</b>, and
              comfortably the strongest model on this page. Once a lineup posts, the row shows the
              lineup instead of our estimate.
            </>} />
          </p>
          {luGames.length === 0 ? (
            <p className="foot">No games in the window. This board fills as tonight&apos;s slate approaches.</p>
          ) : (
            groupByGameDay(luGames, (g) => luKick[g] ?? null, todayEt, tomorrowEt).map((grp) => (
              <div key={grp.key}>
                <DayHeader label={grp.label} tone={grp.tone} count={grp.total ?? grp.items.length} />
                {grp.items.map((g) => {
                  const rows = luByGame[g].slice(0, 18);
                  const moreId = `mlb-lu-${g.replace(/[^a-z0-9]/gi, "")}`;
                  return (
                    <details className="pmgame" key={g}>
                      <summary className="pmgame__h">{luLabel[g]}<span className="pmgame__chev" aria-hidden="true">▾</span></summary>
                      <div className="pmgame__body hb-moretbl">
                        <input type="checkbox" id={moreId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
                        <div className="pmscroll">
                          <div className="pmtable pmtable--mlb" role="table">
                            <div className="pmrow pmrow--head pmrow--data" role="row">
                              <span>player</span><span>status</span><span>start %</span>
                              <span>batting slot</span><span>recent</span>
                            </div>
                            {rows.map((r, i) => {
                              // Once a lineup is posted this is a FACT. Publishing "83%" beside a
                              // known answer is the same failure as an arrow that contradicts the
                              // number next to it.
                              const known = r.lineupPosted;
                              const cont = i > 0 && rows[i - 1].player === r.player;
                              return (
                                <div className={`pmrow pmrow--data${i >= LU_CAP ? " hb-row--more" : ""}`}
                                  role="row" key={`${r.player}-${r.team}`}>
                                  <span className="pmcell pmcell--player">
                                    {cont ? "" : <>{r.player}<span className="pmslot"> ({r.pos ?? "—"}, {r.team})</span></>}
                                  </span>
                                  <span className="pmcell pmcell--team">{known ? "in the lineup" : "projected"}</span>
                                  <span className="pmcell">
                                    {known
                                      ? <b className={r.posted ? "mlbin" : "mlbout"}>{r.posted ? "Starting" : "Not starting"}</b>
                                      : <b className="pmproj">{pct(r.pStart)}</b>}
                                  </span>
                                  <span className="pmcell">{r.slot.toFixed(1)}</span>
                                  <span className="pmcell pmcell--hist">{r.starts}/{r.of} gm</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {rows.length > LU_CAP && (
                          <label htmlFor={moreId} className="hb-moretbl__sum">
                            <span className="hb-more__chev" aria-hidden="true">▸</span>
                            <span className="hb-moretbl__more">Show {rows.length - LU_CAP} more candidate{rows.length - LU_CAP === 1 ? "" : "s"}</span>
                            <span className="hb-moretbl__less">Show fewer</span>
                          </label>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </details>

      {/* Say plainly what is not here. A board that looks finished while quietly missing its model
          is the failure mode this section exists to avoid. */}
      <section className="calib">
        <h2 className="calib__h">
          What we don&apos;t publish
          <Tip label="What we don't publish, and why" text={<>
            <b>No side pick.</b> Our total is worth {S.gain}% and our margins average{" "}
            {S.marMean.toFixed(1)} runs against real margins of {S.marActual.toFixed(1)}. Turning
            either into a pick would be inventing precision the model does not have.<br /><br />
            <b>No run line.</b> It is a fixed ±1.5 on every game, so a column of it says nothing
            about who is favoured by how much.<br /><br />
            <b>No home-field adjustment.</b> Measured across 2,165 games at <b>+0.06 runs</b> —
            indistinguishable from zero, and far smaller than football&apos;s.<br /><br />
            <b>No closing-line claim.</b> Everything here is measured against what actually
            happened. MLB price capture began 7 September; beating the market needs history we do
            not have yet.
          </>} />
        </h2>
      </section>
    </main>
  );
}
