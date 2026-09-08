import { Brand, FlowSteps, ModelSubnav } from "../../Nav";
import PinButton from "../../PinButton";
import { DayHeader } from "../../DayHeader";
import { etToday, etDayKey, groupByGameDay } from "@/lib/gameDays";
import { MLB_GAMES, MLB_GAME_SCORES } from "@/lib/mlbGameModel";
import { MLB_AVAIL, type MlbAvail } from "@/lib/mlbAvailability";
import { mlbBoard } from "@/lib/mlbBoard";

// MLB · Game Model — the spreads/totals half of the section, beside Player Props.
//
// A CHART rather than the football boards' cards, and that is a data decision, not a style one:
// baseball plays fifteen games a night against football's sixteen a WEEK, so a card layout that
// reads well on Sunday becomes four screens of scrolling on a Tuesday. Everything else is kept
// identical to NFL/NCAAF on purpose — same masthead, FlowSteps, ModelSubnav, day grouping, hb-panel
// shells and pm* table classes. Every sport reading the same way is the product.
//
// NO SIDE PICK AND NO RUN LINE. The run line is a fixed +/-1.5 and the total model is worth 0.8%;
// turning that into a pick on a side would be inventing precision this model does not have. The
// market's run line appears as context and stops there.

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
// screen; 8 keeps the day readable and the rest is one click away.
const GAME_CAP = 8;

const pct = (p: number) => `${Math.round(p * 100)}%`;

export default async function Page() {
  const { today: todayEt, tomorrow: tomorrowEt } = etToday();

  // Market numbers. A failure here must not take the model board down with it — the projections
  // are static and the odds are a network read, so the board degrades to "—" in the market column
  // rather than to an error page.
  const { board } = await mlbBoard().catch(() => ({ board: [] as Awaited<ReturnType<typeof mlbBoard>>["board"] }));
  // Joined on the EASTERN day plus the matchup. Not the UTC day: a 9:40pm Pacific first pitch is
  // already tomorrow in UTC, which is precisely the collision that made the model's own game keys
  // wrong. Both sides derive the ET day from the same real timestamp, so this holds.
  const mkt = new Map(board.map((g) => [`${etDayKey(g.commence)}|${g.matchup}`, g]));

  const keys = MLB_GAMES.map((g) => g.gameKey);
  const byKey = new Map(MLB_GAMES.map((g) => [g.gameKey, g]));
  const kick = new Map(MLB_GAMES.map((g) => [g.gameKey, g.commence]));

  // Lineups, grouped by game underneath the chart.
  const luGames: string[] = [];
  const luByGame: Record<string, MlbAvail[]> = {};
  const luLabel: Record<string, string> = {};
  const luKick: Record<string, string> = {};
  for (const r of MLB_AVAIL) {
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
          <span className="hb-bar__count">{MLB_GAMES.length} game{MLB_GAMES.length === 1 ? "" : "s"}</span>
          <PinButton size="sm" pin={{ id: "/mlb/model", kind: "model", label: "MLB · Game Model", detail: "runs + totals", href: "/mlb/model" }} />
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          <p className="ctxsec__d">
            The market&apos;s <b>total</b> for each game — the consensus across the books we track —
            with our <b>line-blind</b> projection beside it. Ours is each side&apos;s offence against
            the other&apos;s defence, then adjusted for the <b>starting pitcher</b>, who is the one
            input that moved the number.
          </p>
          <p className="ctxsec__d">
            <b>Read this one with your eyes open.</b> Over <b>{S.n} held-out games</b> it lands{" "}
            <b>{S.gain}%</b> closer than assuming the league average of <b>{S.meanTotal}</b> runs
            every time. That is small, and it is the sport rather than the model: a single baseball
            game averages {S.meanTotal} runs with a standard deviation of <b>{S.sd}</b>, so the
            variance swamps the difference between two clubs. Team quality on its own measured{" "}
            <b>0.0%</b> — worth nothing at all. It is published because it is line-blind and graded,
            not because we think we have found something.
          </p>
          {/* State the lean rather than letting a reader find it. A board where almost every row
              points the same way is normally OUR bug, so the burden is on us to show it isn't. */}
          <p className="ctxsec__d">
            <b>Our totals currently sit above the market&apos;s on most games</b>, and you should
            know why before reading anything into it. Against <i>what actually happened</i> our
            projections are unbiased — mean error <b>{S.resid >= 0 ? "+" : ""}{S.resid.toFixed(2)}</b>{" "}
            runs across those {S.n} games. The gap is that the market is pricing this stretch of the
            season below what the season has so far produced. Which of the two is right is a
            question about beating a closing line, and that needs price history we do not have yet:
            we only began recording MLB odds on <b>7 September</b>. Until then this is a difference
            to notice, <b>not an edge to act on</b>.
          </p>

          {MLB_GAMES.length === 0 ? (
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
                          with the numbers underneath. Match PlayerModelView.tsx. */}
                      <div className="pmrow pmrow--head pmrow--data" role="row">
                        <span>game</span><span>starting pitchers</span><span>market total</span>
                        <span>our total</span><span>our runs</span><span>run line</span>
                      </div>
                      {grp.items.map((k, i) => {
                        const g = byKey.get(k)!;
                        const m = mkt.get(`${etDayKey(g.commence)}|${g.game}`);
                        const mt = m?.total?.consensus ?? null;
                        const rl = m?.spread?.consensus ?? null;
                        const sp = [g.awaySpName, g.homeSpName].filter(Boolean).join(" / ");
                        return (
                          <div className={`pmrow pmrow--data${i >= GAME_CAP ? " hb-row--more" : ""}`}
                            role="row" key={k}>
                            <span className="pmcell pmcell--player">{g.game}</span>
                            <span className="pmcell pmcell--team">{sp || "not posted"}</span>
                            <span className="pmcell">{mt !== null ? mt.toFixed(1) : "—"}</span>
                            <span className="pmcell"><b className="pmproj">{g.total.toFixed(1)}</b></span>
                            <span className="pmcell pmcell--hist">
                              {g.awayRuns.toFixed(1)} @ {g.homeRuns.toFixed(1)}
                            </span>
                            <span className="pmcell pmcell--hist">
                              {rl !== null ? (rl > 0 ? `+${rl}` : `${rl}`) : "—"}
                            </span>
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
          {/* Derek read this board twice and asked both times what it was for. The answer was
              never on the page, so it is now: what the number means, and why baseball needs it
              when football does not. */}
          <p className="ctxsec__d">
            <b>Baseball lineups are not fixed, and they post late.</b> A football team&apos;s
            starting eleven is the same most weeks. A baseball manager rests people constantly —{" "}
            <b>about two of the nine slots turn over every night</b> — and the lineup card is only
            published <b>three hours or so before first pitch</b>. So at lunchtime nobody yet knows
            who is actually playing tonight. This board is our estimate in the meantime.
          </p>
          <p className="ctxsec__d">
            <b>Start %</b> is the chance a player is in tonight&apos;s lineup. It matters because
            most books void a prop if he never plays — it is about whether your bet <i>happens</i>,
            not whether it wins. <b>Batting slot</b> is where he is likely to hit, which decides how
            many times he comes to the plate: leading off is about <b>4.5</b> chances, batting ninth
            about <b>3.4</b>. Those same two numbers feed every projection on the{" "}
            <a href="/mlb/model/players">Player Props</a> board.
          </p>
          <p className="ctxsec__d">
            Published as a probability and graded against a real baseline. Over{" "}
            <b>21,304 held-out player-games</b> it scores a Brier of <b>{BRIER.model.toFixed(3)}</b>{" "}
            against <b>{BRIER.persistence.toFixed(3)}</b> for simply repeating last night&apos;s
            lineup — <b>{BRIER.gain}% better</b>, and comfortably the strongest model on this page.
            Once a lineup actually posts, the row shows the lineup instead of our estimate.
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
        <h2 className="calib__h">What we don&apos;t publish</h2>
        <p className="foot">
          <b>No side pick and no run-line call.</b> Baseball&apos;s run line is a fixed ±1.5 and our
          total is worth {S.gain}% — turning that into a pick on a side would be inventing precision
          the model does not have. The market&apos;s run line is shown as context, nothing more.
        </p>
        <p className="foot">
          <b>No home-field adjustment.</b> Measured across 2,165 games it came to <b>+0.06 runs</b>{" "}
          — indistinguishable from zero, and far smaller than football&apos;s. A number that small
          does not belong in a model.
        </p>
        <p className="foot">
          <b>Not yet tested against a closing line.</b> Everything above is measured against what
          actually happened. We only began recording MLB prices on 7 September, and beating the
          market is a separate question that needs history we do not have yet.
        </p>
      </section>
    </main>
  );
}
