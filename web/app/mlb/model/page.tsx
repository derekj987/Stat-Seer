import { Brand, FlowSteps, ModelSubnav } from "../../Nav";
import PinButton from "../../PinButton";
import { DayHeader } from "../../DayHeader";
import { etToday, groupByGameDay } from "@/lib/gameDays";
import { MLB_AVAIL, type MlbAvail } from "@/lib/mlbAvailability";
import { MLB_K } from "@/lib/mlbStrikeouts";
import { strikeoutLines, norm } from "@/lib/mlbProps";

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
// Held out over 925 starts; see mlb_strikeouts.py for the full ablation.
const MAE = { model: 1.7644, base: 1.8213 };
// Tonight's starters first; the rest of the two-day window folds away.
const K_CAP = 12;

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** One player row. Reuses the player-model cell classes so the MLB board's columns line up with
 *  the football boards' rather than inventing a second table language. */
function Row({ r, cont, more }: { r: MlbAvail; cont: boolean; more?: boolean }) {
  // Once a lineup is posted this is a FACT, not a projection. Publishing "83%" beside a known
  // answer would be the same failure as an arrow that contradicts the number next to it.
  const known = r.lineupPosted;
  return (
    <div className={`pmrow pmrow--data${more ? " hb-row--more" : ""}`} role="row">
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

export default async function Page() {
  // Consensus book line per pitcher, read server-side. The board shows OUR number beside
  // THEIRS the way the football boards do — the projection is line-blind, the comparison is not.
  const lines = await strikeoutLines();
  const { today: todayEt, tomorrow: tomorrowEt } = etToday();

  // One row per player per game; group by game, then by day — the same shape as the football
  // player board so a reader moving between sports does not have to relearn anything.
  const games: string[] = [];
  const byGame: Record<string, MlbAvail[]> = {};
  const kick: Record<string, string> = {};
  // gameKey = date + matchup. Baseball plays series; a matchup-only key merged consecutive
  // nights into one card.
  const label: Record<string, string> = {};
  for (const r of MLB_AVAIL) {
    if (!byGame[r.gameKey]) { byGame[r.gameKey] = []; games.push(r.gameKey); label[r.gameKey] = r.game; }
    byGame[r.gameKey].push(r);
    if (!kick[r.gameKey] || r.commence < kick[r.gameKey]) kick[r.gameKey] = r.commence;
  }
  games.sort((a, b) => (kick[a] ?? "9999").localeCompare(kick[b] ?? "9999"));

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">MLB</span> · The Model</>} />
      </header>
      <FlowSteps active="analyze" base="mlb" />
      {/* Both views exist now, so the switcher is back — same as NFL and NCAAF. */}
      <div className="subnavrow"><ModelSubnav active="game" base="mlb" /></div>

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
                  const rows = byGame[g].slice(0, 18);
                  // A lineup IS nine. Show that many and fold the rest of the candidate pool
                  // behind the standard control — an 18-row wall per game buried every card
                  // below it, and the probe now flags exactly this.
                  const CAP = 9;
                  const moreId = `mlb-lu-${g.replace(/[^a-z0-9]/gi, "")}`;
                  return (
                    <details className="pmgame" key={g} open>
                      <summary className="pmgame__h">{label[g]}<span className="pmgame__chev" aria-hidden="true">▾</span></summary>
                      <div className="pmgame__body hb-moretbl">
                        <input type="checkbox" id={moreId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
                        <div className="pmscroll">
                          <div className="pmtable pmtable--mlb" role="table">
                            <div className="pmrow pmrow--head" role="row">
                              <span>player</span><span>status</span><span>starts?</span>
                              <span>batting slot</span><span>recent</span>
                            </div>
                            {rows.map((r, i) => (
                              <Row key={`${r.player}-${r.team}`} r={r} more={i >= CAP}
                                cont={i > 0 && rows[i - 1].player === r.player} />
                            ))}
                          </div>
                        </div>
                        {rows.length > CAP && (
                          <label htmlFor={moreId} className="hb-moretbl__sum">
                            <span className="hb-more__chev" aria-hidden="true">▸</span>
                            <span className="hb-moretbl__more">Show {rows.length - CAP} more candidate{rows.length - CAP === 1 ? "" : "s"}</span>
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

      <details className="hb-panel hb-panel--card" data-embedchart="mlb-strikeouts" open>
        <summary className="hb-bar">
          <span className="hb-bar__title hb-bar__title--gold">Projected strikeouts</span>
          <span className="hb-bar__count">{MLB_K.length} starters</span>
          <PinButton size="sm" pin={{ id: "/mlb/model#k", kind: "model", label: "MLB · Strikeouts", detail: "starting pitchers", href: "/mlb/model" }} />
          <span className="hb-bar__chev" aria-hidden="true">▾</span>
        </summary>
        <div className="hb-body">
          <p className="ctxsec__d">
            Our line-blind read on tonight&apos;s starters: <b>batters faced</b> multiplied by the
            pitcher&apos;s <b>strikeout rate</b>, adjusted for how often the opposing lineup strikes
            out. Volume then rate — the same shape as the football boards, because strikeout rate is
            the most persistent skill in baseball and hits are mostly not.
          </p>
          <p className="ctxsec__d">
            Held out over <b>925 starts</b>, this lands <b>{(MAE.base - MAE.model).toFixed(3)}</b>{" "}
            strikeouts closer than the pitcher&apos;s own season average
            ({((MAE.base - MAE.model) / MAE.base * 100).toFixed(1)}% better).{" "}
            <b>That is measured against what actually happened, not against the market.</b> Whether
            it beats a closing line is untested — we only began recording MLB prop prices on
            7 September, and that test needs history. The book number is shown beside ours so you
            can see the gap, not because we are claiming it.
          </p>
          {MLB_K.length === 0 ? (
            <p className="foot">No probable starters posted yet for the coming slate.</p>
          ) : (
            <div className="hb-moretbl">
            <input type="checkbox" id="mlb-k-more" className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
            <div className="pmscroll">
              <div className="pmtable pmtable--mlbk" role="table">
                <div className="pmrow pmrow--head" role="row">
                  <span>pitcher</span><span>opponent</span><span>book line</span>
                  <span>our proj</span><span>K rate</span><span>starts</span>
                </div>
                {MLB_K.map((r, i) => {
                  const bk = lines.get(norm(r.pitcher));
                  return (
                    <div className={`pmrow pmrow--data${i >= K_CAP ? " hb-row--more" : ""}`}
                      role="row" key={`${r.pitcher}-${r.game}`}>
                      <span className="pmcell pmcell--player">
                        {r.pitcher}<span className="pmslot"> ({r.team})</span>
                      </span>
                      <span className="pmcell pmcell--team">{r.opp}</span>
                      <span className="pmcell">{bk ? bk.line.toFixed(1) : "—"}</span>
                      <span className="pmcell"><b className="pmproj">{r.proj.toFixed(1)}</b></span>
                      <span className="pmcell">{(r.kRate * 100).toFixed(1)}%</span>
                      <span className="pmcell pmcell--hist">{r.starts} gm</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {MLB_K.length > K_CAP && (
              <label htmlFor="mlb-k-more" className="hb-moretbl__sum">
                <span className="hb-more__chev" aria-hidden="true">▸</span>
                <span className="hb-moretbl__more">Show {MLB_K.length - K_CAP} more starter{MLB_K.length - K_CAP === 1 ? "" : "s"}</span>
                <span className="hb-moretbl__less">Show fewer</span>
              </label>
            )}
            </div>
          )}
        </div>
      </details>

      {/* Say plainly what is not here. A sport's board looking identical to a finished one while
          quietly missing its model is the failure mode this section exists to avoid. */}
      <section className="calib">
        <h2 className="calib__h">What isn&apos;t built yet</h2>
        <p className="foot">
          There is <b>no MLB game model</b> — no run line, no total. Odds are being captured now so
          one can be built and graded against a real market, the same way the football boards were.
          Until a number clears that bar it does not go on this page.
        </p>
        <p className="foot">
          On props, only <b>strikeouts</b> is modelled so far. Hits, total bases and
          hits+runs+RBIs are captured but not projected — those outcomes are driven largely by where
          a batted ball happens to land, which does not carry from game to game the way a strikeout
          rate does. We would rather publish one number we can defend than five we cannot.
        </p>
      </section>
    </main>
  );
}
