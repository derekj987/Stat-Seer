// The Player Prop Model — our line-blind player-level projections (volume × regressed
// efficiency from the snap-share model). Its own section under The Model, separate from
// Value Finder's price-shopping props. The Python pipeline is built + validated; the
// weekly projection OUTPUT wires in here as the season's usage data flows, so each
// category currently scaffolds an honest "arriving" state rather than inventing numbers.
import { Brand, FlowSteps, ModelSubnav } from "./Nav";

export interface PlayerCat {
  key: string;
  label: string;
  blurb: string;
  cols: string[];   // the columns this category's projection table will publish
}

export const PLAYER_CATS: PlayerCat[] = [
  { key: "td", label: "Touchdowns", cols: ["Player", "Team", "Anytime TD %", "Proj. TDs"],
    blurb: "Anytime-touchdown probability from projected goal-line and red-zone touches — volume first, never a raw efficiency guess." },
  { key: "passing", label: "Passing", cols: ["Player", "Team", "Pass Yds", "Pass TDs", "Attempts"],
    blurb: "Projected passing volume (attempts, completions) multiplied by a regressed yards-per-attempt baseline." },
  { key: "rushing", label: "Rushing", cols: ["Player", "Team", "Carries", "Rush Yds"],
    blurb: "Projected carries from the snap-share model × a regressed yards-per-carry baseline — carries persist (r ≈ 0.68), efficiency doesn't." },
  { key: "receiving", label: "Receiving", cols: ["Player", "Team", "Targets", "Rec", "Rec Yds"],
    blurb: "Projected target share converted to receptions and yards — the middle of the depth chart (35–60% snaps) is where this is most reliable." },
  { key: "receptions", label: "Receptions", cols: ["Player", "Team", "Targets", "Receptions"],
    blurb: "Projected catch volume from target share — the most persistent receiving signal we measured." },
];

export const playerCatByKey = (k: string): PlayerCat =>
  PLAYER_CATS.find((c) => c.key === k) ?? PLAYER_CATS[0];

export default function PlayerModelView({ base, cat }: { base: "nfl" | "ncaaf"; cat: string }) {
  const active = playerCatByKey(cat);
  const home = base === "ncaaf" ? "/ncaaf/model/players" : "/model/players";
  const sportLabel = base === "ncaaf" ? "College Football" : "NFL";

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

        <div className="pmtable" role="table" aria-label={`${active.label} projections`}>
          <div className="pmrow pmrow--head" role="row">
            {active.cols.map((col, i) => (
              <span key={col} className={i === 0 ? "pmcell pmcell--player" : "pmcell"}>{col}</span>
            ))}
          </div>
          <div className="pmempty" role="note">
            <span className="pmempty__tag">Projections arriving</span>
            <p>
              The projection model is <b>built and validated</b> (availability AUC ≈ 0.86; rushing yards
              <b> +4.3%</b> over a persistence baseline on change weeks). The weekly <b>{active.label.toLowerCase()}</b>{" "}
              numbers publish here as each week&apos;s live usage is captured — snap-share can&apos;t be
              backfilled, so it fills in with the season, not before.
            </p>
          </div>
        </div>
      </section>

      <footer className="foot">
        <p>
          <b>Line-blind and graded in public.</b> These are our own projections, not book lines — for the best
          price on a prop you&apos;ve chosen, that&apos;s Value Finder&apos;s{" "}
          <a href={base === "ncaaf" ? "/ncaaf/props" : "/props"}>Player Props</a>.
        </p>
      </footer>
    </main>
  );
}
