// The Player Prop Model — our line-blind player-level projections (volume × regressed
// efficiency from the snap-share model). Its own section under The Model, separate from
// Value Finder's price-shopping props. The Python pipeline is built + validated; the
// weekly projection OUTPUT wires in here as the season's usage data flows, so each
// category currently scaffolds an honest "arriving" state rather than inventing numbers.
import { Brand, FlowSteps, ModelSubnav } from "./Nav";
import { PLAYER_PROJECTIONS, PROJ_WEEK, PROJ_PRIOR, type PlayerProj } from "@/lib/playerProjections";

export interface PlayerCat {
  key: string;
  label: string;
  blurb: string;
  cols: string[];   // the columns this category's projection table will publish
  note: string;     // category-specific line on how this prop is projected + validated
}

export const PLAYER_CATS: PlayerCat[] = [
  { key: "td", label: "Touchdowns", cols: ["Player", "Team", "Anytime TD %", "Proj. TDs"],
    blurb: "Anytime-touchdown probability from projected goal-line and red-zone touches — volume first, never a raw efficiency guess.",
    note: "Touchdown odds ride on projected goal-line and red-zone touches from the snap-share model — we model who gets the ball near the end zone, not a raw scoring-rate guess." },
  { key: "passing", label: "Passing", cols: ["Player", "Team", "Pass Yds", "Pass TDs", "Attempts"],
    blurb: "Projected passing volume (attempts, completions) multiplied by a regressed yards-per-attempt baseline.",
    note: "Passing yards come from projected attempts and completions times a regressed yards-per-attempt baseline — volume is the stable part, efficiency is pulled toward the mean." },
  { key: "rushing", label: "Rushing", cols: ["Player", "Team", "Carries", "Rush Yds"],
    blurb: "Projected carries from the snap-share model × a regressed yards-per-carry baseline — carries persist (r ≈ 0.68), efficiency doesn't.",
    note: "Rushing yards are our strongest prop — projected carries (+4.7% over baseline) times a regressed yards-per-carry, landing rushing yards +4.3% over a persistence baseline, because carries persist and yards-per-carry mostly doesn't." },
  { key: "receiving", label: "Receiving", cols: ["Player", "Team", "Targets", "Rec", "Rec Yds"],
    blurb: "Projected target share converted to receptions and yards — the middle of the depth chart (35–60% snaps) is where this is most reliable.",
    note: "Receiving yards come from projected target share (targets +3.3% over baseline) times a regressed yards-per-target — receiving is efficiency-heavy, so the honest edge here is smaller (rec yds +1.8%)." },
  { key: "receptions", label: "Receptions", cols: ["Player", "Team", "Targets", "Receptions"],
    blurb: "Projected catch volume from target share — the most persistent receiving signal we measured.",
    note: "Receptions come straight from projected target share — the most persistent receiving signal we measured (receptions +2.2% over a persistence baseline)." },
];

export const playerCatByKey = (k: string): PlayerCat =>
  PLAYER_CATS.find((c) => c.key === k) ?? PLAYER_CATS[0];

export default function PlayerModelView({ base, cat }: { base: "nfl" | "ncaaf"; cat: string }) {
  const active = playerCatByKey(cat);
  const home = base === "ncaaf" ? "/ncaaf/model/players" : "/model/players";
  const sportLabel = base === "ncaaf" ? "College Football" : "NFL";

  // Real projections exist for NFL only (prior-season baseline export). Group the active
  // category's rows by game.
  const rows: PlayerProj[] = base === "nfl" ? PLAYER_PROJECTIONS.filter((p) => p.cat === active.key) : [];
  const games: string[] = [];
  const byGame: Record<string, PlayerProj[]> = {};
  for (const r of rows) {
    if (!byGame[r.game]) { byGame[r.game] = []; games.push(r.game); }
    byGame[r.game].push(r);
  }
  const unit = active.key === "receptions" ? "" : " yds";

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Model · Player Prop Model · ${sportLabel}`} />
      </header>

      <FlowSteps active="analyze" base={base} />
      <ModelSubnav active="player" base={base} />

      <section className="explainer explainer--wide">
        <p>
          Our <b>line-blind player projections</b> — the layer that turns the snap-share model into
          per-player prop numbers. The rule we never break: <b>project volume, then multiply by a regressed
          efficiency baseline</b> (carries and targets persist; yards-per-touch is mostly noise). Like the
          game model, these are <b>published and graded in public</b> — not sold as locks.
        </p>
      </section>

      <nav className="catnav" aria-label="Player prop category">
        {PLAYER_CATS.map((c) => (
          <a key={c.key} href={`${home}?cat=${c.key}`}
            className={c.key === active.key ? "catnav__c active" : "catnav__c"}
            aria-current={c.key === active.key ? "page" : undefined}>{c.label}</a>
        ))}
      </nav>

      <section className="pmcat">
        <h2 className="pmcat__h">{active.label}</h2>
        <p className="pmcat__blurb">{active.blurb}</p>

        {rows.length === 0 ? (
          <div className="pmtable" role="table" aria-label={`${active.label} projections`}>
            <div className="pmrow pmrow--head" role="row">
              {active.cols.map((col, i) => (
                <span key={col} className={i === 0 ? "pmcell pmcell--player" : "pmcell"}>{col}</span>
              ))}
            </div>
            <div className="pmempty" role="note">
              <span className="pmempty__tag">Projections arriving</span>
              <p>{active.note}</p>
              <p>
                The pipeline is <b>built and validated</b> (availability AUC ≈ 0.86). The weekly{" "}
                <b>{active.label.toLowerCase()}</b> numbers publish here as each week&apos;s live usage is
                captured — snap-share can&apos;t be backfilled, so it fills in with the season, not before.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="pmdisc" role="note">
              <span className="pmempty__tag">How to read this</span>
              <p>
                <b>Our proj</b> is a prior-season ({PROJ_PRIOR}) baseline (projected volume × position
                efficiency) — an honest starting point, but it runs biased for some roles (QBs especially), so
                don&apos;t take it as a validated edge.
              </p>
              <p>
                <b>Career % over</b> = across <b>every game of the player&apos;s career</b> in our data
                (2016–{PROJ_PRIOR}), how often they cleared <b>this exact line</b>. <b>Prior szn % over</b> = the
                same thing for <b>{PROJ_PRIOR} only</b> — the recency check, since a career number is diluted by a
                bygone peak (Cooper Kupp clears 27 rec yds 84% of his career but only 68% in {PROJ_PRIOR}). Green ≥
                50%, red below.
              </p>
            </div>
            {games.map((g) => (
              <div className="pmgame" key={g}>
                <div className="pmgame__h">{g}</div>
                <div className="pmscroll">
                  <div className="pmtable pmtable--data" role="table" aria-label={`${g} ${active.label} projections`}>
                    <div className="pmrow pmrow--head pmrow--data" role="row">
                      <span className="pmcell pmcell--player">Player</span>
                      <span className="pmcell">Team</span>
                      <span className="pmcell pmcell--num">Book line</span>
                      <span className="pmcell pmcell--num">Our proj</span>
                      <span className="pmcell pmcell--career">Career % over</span>
                      <span className="pmcell pmcell--career">Prior szn % over</span>
                    </div>
                    {byGame[g].map((r) => {
                      const cpct = r.cG ? Math.round((100 * r.cOver) / r.cG) : null;
                      const ppct = r.pG ? Math.round((100 * r.pOver) / r.pG) : null;
                      const cls = (v: number | null) => v === null ? "" : v >= 50 ? "pmread--over" : "pmread--under";
                      return (
                        <div className="pmrow pmrow--data" role="row" key={`${r.player}-${r.market}`}>
                          <span className="pmcell pmcell--player">{r.player}</span>
                          <span className="pmcell pmcell--team">{r.team}</span>
                          <span className="pmcell pmcell--num">{r.book}{unit}</span>
                          <span className="pmcell pmcell--num pmcell--proj">{r.proj}{unit}</span>
                          <span className={`pmcell pmcell--career ${cls(cpct)}`}>
                            {cpct === null ? "—" : <>{cpct}% <small className="pmcell__sub">{r.cOver}/{r.cG} gm</small></>}
                          </span>
                          <span className={`pmcell pmcell--career ${cls(ppct)}`}>
                            {ppct === null ? <span className="pmcell__sub">no {PROJ_PRIOR}</span> : <>{ppct}% <small className="pmcell__sub">{r.pOver}/{r.pG} gm</small></>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
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
