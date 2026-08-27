// The Player Prop Model — our line-blind player-level projections (volume × regressed
// efficiency from the snap-share model). Its own section under The Model, separate from
// Value Finder's price-shopping props. The Python pipeline is built + validated; the
// weekly projection OUTPUT wires in here as the season's usage data flows, so each
// category currently scaffolds an honest "arriving" state rather than inventing numbers.
import { Brand, FlowSteps, ModelSubnav, ScrollHint } from "./Nav";
import { WeekNav } from "./WeekNav";
import { PLAYER_PROJECTIONS, PROJ_WEEK, PROJ_PRIOR, type PlayerProj } from "@/lib/playerProjections";
import { isRealistic } from "@/lib/depthChart";

export interface PlayerCat {
  key: string;
  label: string;
}

// Method/blurb text intentionally omitted — how each number is calculated is not published
// on the public pages (see the pending "How we make our calculations" decision).
export const PLAYER_CATS: PlayerCat[] = [
  { key: "td", label: "Touchdowns" },
  { key: "passing", label: "Passing" },
  { key: "rushing", label: "Rushing" },
  { key: "receiving", label: "Receiving" },
  { key: "receptions", label: "Receptions" },
];

export const playerCatByKey = (k: string): PlayerCat =>
  PLAYER_CATS.find((c) => c.key === k) ?? PLAYER_CATS[0];


export default function PlayerModelView({ base, cat, week }: { base: "nfl" | "ncaaf"; cat: string; week: number }) {
  const active = playerCatByKey(cat);
  const home = base === "ncaaf" ? "/ncaaf/model/players" : "/model/players";
  const catHref = (c: string) => `${home}?cat=${c}&week=${week}`;

  // Real projections exist for NFL only, for the current projection week. Group the active
  // category's rows by game.
  const onProjWeek = base === "nfl" && week === PROJ_WEEK;
  const rows: PlayerProj[] = onProjWeek
    ? PLAYER_PROJECTIONS.filter((p) => p.cat === active.key && isRealistic(p.player))
    : [];
  const games: string[] = [];
  const byGame: Record<string, PlayerProj[]> = {};
  for (const r of rows) {
    if (!byGame[r.game]) { byGame[r.game] = []; games.push(r.game); }
    byGame[r.game].push(r);
  }
  const LEAD = 4;   // rows shown before "see more"
  // Per-row unit — the passing category mixes markets (yards + TDs); anytime-TD is a %.
  const unitFor = (market: string) =>
    market === "receptions" ? "" : market === "pass_tds" ? " TD" : market === "anytime_td" ? "%" : " yds";
  // The Touchdowns tab is a Yes/No prop: relabel the numeric + hit-rate headers.
  const isTd = active.key === "td";
  // Passing splits into a Yards table and a Passing-TDs table (all QBs, still per game).
  const sectionsFor = (g: string): { label: string | null; rows: PlayerProj[] }[] =>
    active.key === "passing"
      ? [
          { label: "Passing Yards", rows: byGame[g].filter((r) => r.market === "pass_yds") },
          { label: "Passing TDs", rows: byGame[g].filter((r) => r.market === "pass_tds") },
        ].filter((s) => s.rows.length > 0)
      : [{ label: null, rows: byGame[g] }];

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">{base === "ncaaf" ? "NCAAF" : "NFL"}</span> · Player Prop Model</>}
          art={{ src: "/player.png?v=1", alt: "Player Prop Model" }}
        />
      </header>

      <section className="explainer explainer--wide explainer--clamp">
        <input type="checkbox" id="xclamp-pm" className="xclamp-toggle" aria-hidden="true" tabIndex={-1} />
        <p className="xclamp-text">
          Our <b>line-blind player-prop projections</b> — our own number for each prop, set without looking
          at the book&apos;s line, shown beside it with an over/under lean. Like the game model, these are
          <b> published and graded in public</b> — not sold as locks.
        </p>
        <label htmlFor="xclamp-pm" className="xclamp-btn">
          <span className="xclamp-btn__more">See more ▾</span>
          <span className="xclamp-btn__less">See less ▴</span>
        </label>
      </section>

      <FlowSteps active="analyze" base={base} />
      <ModelSubnav active="player" base={base} />

      <nav className="catnav" aria-label="Player prop category">
        {PLAYER_CATS.map((c) => (
          <a key={c.key} href={catHref(c.key)}
            className={c.key === active.key ? "catnav__c active" : "catnav__c"}
            aria-current={c.key === active.key ? "page" : undefined}>{c.label}</a>
        ))}
      </nav>

      <WeekNav current={week} base={base === "ncaaf" ? "/ncaaf/model/players" : "/model/players"} params={`cat=${active.key}`} />

      <section className="pmcat">
        {rows.length === 0 ? (
          <div className="pmempty pmempty--solo" role="note">
            <span className="pmempty__tag">Projections arriving</span>
            <p>
              Our line-blind <b>{active.label.toLowerCase()}</b> projections publish here as each
              week&apos;s data comes in — they can&apos;t be filled in before the season runs.
            </p>
          </div>
        ) : (
          <>
            {games.map((g, gi) => (
              <details className="pmgame" key={g} open>
                <summary className="pmgame__h">{g}<span className="pmgame__chev" aria-hidden="true">▾</span></summary>
                <div className="pmgame__body">
                <ScrollHint />
                {sectionsFor(g).map((sec, si) => {
                  const moreId = `pm-${base}-${active.key}-${gi}-${si}`;
                  const extra = Math.max(0, sec.rows.length - LEAD);
                  return (
                  <div className="hb-moretbl" key={sec.label ?? "all"}>
                    <input type="checkbox" id={moreId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
                    <div className="pmscroll">
                    {sec.label && <div className="pmsec__h">{sec.label}</div>}
                    <div className={`pmtable pmtable--data${active.key === "passing" ? " pmtable--ha" : ""}`} role="table" aria-label={`${g} ${sec.label ?? active.label} projections`}>
                      <div className="pmrow pmrow--head pmrow--data" role="row">
                        <span className="pmcell pmcell--player">Player</span>
                        <span className="pmcell">Team</span>
                        <span className="pmcell pmcell--num">{isTd ? "Book %" : "Book line"}</span>
                        <span className="pmcell pmcell--num">{isTd ? "Our %" : "Our proj"}</span>
                        <span className="pmcell pmcell--career">{isTd ? "Career TD rate" : "Career % over"}</span>
                        <span className="pmcell pmcell--career">{isTd ? "Prior szn TD rate" : "Prior szn % over"}</span>
                        {active.key === "passing" && <>
                          <span className="pmcell pmcell--career">Home % over</span>
                          <span className="pmcell pmcell--career">Road % over</span>
                        </>}
                      </div>
                      {sec.rows.map((r, ri) => {
                        const cpct = r.cG ? Math.round((100 * r.cOver) / r.cG) : null;
                        const ppct = r.pG ? Math.round((100 * r.pOver) / r.pG) : null;
                        const hpct = r.hG ? Math.round((100 * r.hOver) / r.hG) : null;
                        const rpct = r.rG ? Math.round((100 * r.rOver) / r.rG) : null;
                        const cls = (v: number | null) => v === null ? "" : v >= 50 ? "pmread--over" : "pmread--under";
                        return (
                          <div className={`pmrow pmrow--data${ri >= LEAD ? " hb-row--more" : ""}`} role="row" key={`${r.player}-${r.market}`}>
                            <span className="pmcell pmcell--player">{r.player}</span>
                            <span className="pmcell pmcell--team">{r.team}</span>
                            <span className="pmcell pmcell--num">{r.book}{unitFor(r.market)}</span>
                            <span className={`pmcell pmcell--num pmcell--proj${r.proj >= r.book ? "" : " pmcell--projdown"}`}>
                              {r.proj}{unitFor(r.market)}{" "}
                              <span className={`pmarrow ${r.proj >= r.book ? "pmarrow--up" : "pmarrow--down"}`} aria-hidden="true">{r.proj >= r.book ? "▲" : "▼"}</span>
                            </span>
                            <span className={`pmcell pmcell--career ${cls(cpct)}`}>
                              {cpct === null ? "—" : <>{cpct}% <small className="pmcell__sub">{r.cOver}/{r.cG} gm</small></>}
                            </span>
                            <span className={`pmcell pmcell--career ${cls(ppct)}`}>
                              {ppct === null ? <span className="pmcell__sub">no {PROJ_PRIOR}</span> : <>{ppct}% <small className="pmcell__sub">{r.pOver}/{r.pG} gm</small></>}
                            </span>
                            {active.key === "passing" && <>
                              <span className={`pmcell pmcell--career ${cls(hpct)}`}>
                                {hpct === null ? "—" : <>{hpct}% <small className="pmcell__sub">{r.hOver}/{r.hG} gm</small></>}
                              </span>
                              <span className={`pmcell pmcell--career ${cls(rpct)}`}>
                                {rpct === null ? "—" : <>{rpct}% <small className="pmcell__sub">{r.rOver}/{r.rG} gm</small></>}
                              </span>
                            </>}
                          </div>
                        );
                      })}
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
                </div>
              </details>
            ))}
          </>
        )}
      </section>

      <footer className="foot foot--pm">
        <p>
          <b>Line-blind and graded in public.</b> These are our own projections, not book lines — for the best
          price on a prop you&apos;ve chosen, that&apos;s Value Finder&apos;s{" "}
          <a href={base === "ncaaf" ? "/ncaaf/props" : "/props"}>Player Props</a>.
        </p>
      </footer>
    </main>
  );
}
