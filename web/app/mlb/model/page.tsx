import { Brand, FlowSteps } from "../../Nav";
import PinButton from "../../PinButton";
import { DayHeader } from "../../DayHeader";
import { etToday, groupByGameDay } from "@/lib/gameDays";
import { MLB_AVAIL, type MlbAvail } from "@/lib/mlbAvailability";

// MLB · The Model.
//
// Deliberately NOT a game-line board yet. NFL and NCAAF publish a spread and total here because
// those models exist and are graded; MLB has neither, and shipping an empty spread column that
// implies otherwise is exactly the "appearance of rigor" this project is built against. What MLB
// has today is Stage A — who is in tonight's lineup and where they bat — and that IS a measured,
// published model, so it gets the board and says what it scores.
//
// Layout is the NFL/NCAAF layout on purpose: same masthead, same FlowSteps, same ModelSubnav, same
// day grouping and hb-panel shells. Every sport reading identically is the product, not a
// convenience.

export const metadata = {
  title: "StatSeer — MLB Model",
  description:
    "Line-blind MLB analysis: who starts tonight and where they bat, published as a probability and graded against a real baseline.",
};
export const revalidate = 300;

// Measured on 2026: 30 teams, 4,464 completed team-games, 21,304 held-out candidate rows.
const BRIER = { model: 0.16102, persistence: 0.22894, gain: 29.7 };

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** One player row. Reuses the player-model cell classes so the MLB board's columns line up with
 *  the football boards' rather than inventing a second table language. */
function Row({ r, cont }: { r: MlbAvail; cont: boolean }) {
  // Once a lineup is posted this is a FACT, not a projection. Publishing "83%" beside a known
  // answer would be the same failure as an arrow that contradicts the number next to it.
  const known = r.lineupPosted;
  return (
    <div className="pmrow pmrow--data" role="row">
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
}

export default function Page() {
  const { today: todayEt, tomorrow: tomorrowEt } = etToday();

  // One row per player per game; group by game, then by day — the same shape as the football
  // player board so a reader moving between sports does not have to relearn anything.
  const games: string[] = [];
  const byGame: Record<string, MlbAvail[]> = {};
  const kick: Record<string, string> = {};
  for (const r of MLB_AVAIL) {
    if (!byGame[r.game]) { byGame[r.game] = []; games.push(r.game); }
    byGame[r.game].push(r);
    if (!kick[r.game] || r.commence < kick[r.game]) kick[r.game] = r.commence;
  }
  games.sort((a, b) => (kick[a] ?? "9999").localeCompare(kick[b] ?? "9999"));

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">MLB</span> · The Model</>} />
      </header>
      <FlowSteps active="analyze" base="mlb" />
      {/* NO ModelSubnav here. Football splits The Model into Game and Player views because both
          exist; MLB has one board, and a two-tab switcher whose second tab 404s is worse than no
          switcher. It comes back the moment there is a second view to switch to. */}

      <details className="hb-panel hb-panel--card" data-embedchart="mlb-availability" open>
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">Tonight&apos;s lineups</span>
          <span className="hb-bar__count">{games.length} game{games.length === 1 ? "" : "s"}</span>
          <PinButton size="sm" pin={{ id: "/mlb/model", kind: "model", label: "MLB · Lineups", detail: "Stage A", href: "/mlb/model" }} />
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          <p className="ctxsec__d">
            Whether a hitter is in tonight&apos;s lineup, and where he bats. Every prop is
            conditioned on him playing, and in baseball that changes daily —{" "}
            <b>about two of nine slots turn over every night</b>. Batting slot matters on its own:
            leadoff sees roughly <b>4.6</b> plate appearances a night and the nine-hole about{" "}
            <b>3.9</b>, which is most of the gap between two otherwise similar hitters.
          </p>
          <p className="ctxsec__d">
            Published as a probability and graded against a real baseline. On{" "}
            <b>21,304 held-out player-games</b> this scores a Brier of <b>{BRIER.model.toFixed(3)}</b>{" "}
            against <b>{BRIER.persistence.toFixed(3)}</b> for simply repeating last night&apos;s
            lineup — <b>{BRIER.gain}% better</b>. Once a lineup actually posts, the row shows the
            lineup rather than our estimate.
          </p>

          {games.length === 0 ? (
            <p className="foot">
              No games in the window. Lineups post about three hours before first pitch; this board
              fills as tonight&apos;s slate approaches.
            </p>
          ) : (
            groupByGameDay(games, (g) => kick[g] ?? null, todayEt, tomorrowEt).map((grp) => (
              <div key={grp.key}>
                <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} />
                {grp.items.map((g) => {
                  const rows = byGame[g].slice(0, 14);
                  return (
                    <details className="pmgame" key={g} open>
                      <summary className="pmgame__h">{g}<span className="pmgame__chev" aria-hidden="true">▾</span></summary>
                      <div className="pmgame__body">
                        <div className="pmscroll">
                          <div className="pmtable pmtable--mlb" role="table">
                            <div className="pmrow pmrow--head" role="row">
                              <span>player</span><span>status</span><span>starts?</span>
                              <span>batting slot</span><span>recent</span>
                            </div>
                            {rows.map((r, i) => (
                              <Row key={`${r.player}-${r.team}`} r={r}
                                cont={i > 0 && rows[i - 1].player === r.player} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </details>

      {/* Say plainly what is not here. A sport's board looking identical to a finished one while
          quietly missing its model is the failure mode this section exists to avoid. */}
      <section className="calib">
        <h2 className="calib__h">What isn&apos;t built yet</h2>
        <p className="foot">
          There is <b>no MLB game model</b> — no run line, no total — and no prop projections. Odds
          and props are being captured now so those can be built and graded against a real market,
          the same way the football boards were. Until a number clears that bar it does not go on
          this page.
        </p>
        <p className="foot">
          The one to expect first is <b>pitcher strikeouts</b>: strikeout rate is the most
          persistent skill in baseball, and batters faced is a volume question — the same shape as
          the football work.
        </p>
      </section>
    </main>
  );
}
