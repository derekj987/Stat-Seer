// The Player Prop Model — our line-blind player-level projections (volume × regressed
// efficiency from the snap-share model). Its own section under The Model, separate from
// Value Finder's price-shopping props. The Python pipeline is built + validated; the
// weekly projection OUTPUT wires in here as the season's usage data flows, so each
// category currently scaffolds an honest "arriving" state rather than inventing numbers.
import { Brand, FlowSteps, ModelSubnav, ScrollHint } from "./Nav";
import { PLAYER_PROJECTIONS, PROJ_WEEK, PROJ_PRIOR, type PlayerProj } from "@/lib/playerProjections";
import { isRealistic } from "@/lib/depthChart";

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

function WeekNav({ base, cat, current }: { base: "nfl" | "ncaaf"; cat: string; current: number }) {
  const home = base === "ncaaf" ? "/ncaaf/model/players" : "/model/players";
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  return (
    <nav className="weeknav" aria-label="Select week">
      <span className="weeknav__label">Week</span>
      <div className="weeknav__list">
        {weeks.map((w) => (
          <a key={w} href={`${home}?cat=${cat}&week=${w}`}
            className={w === current ? "weeknav__w active" : "weeknav__w"}
            aria-current={w === current ? "page" : undefined}>{w}</a>
        ))}
      </div>
    </nav>
  );
}

export default function PlayerModelView({ base, cat, week }: { base: "nfl" | "ncaaf"; cat: string; week: number }) {
  const active = playerCatByKey(cat);
  const home = base === "ncaaf" ? "/ncaaf/model/players" : "/model/players";
  const sportLabel = base === "ncaaf" ? "College Football" : "NFL";
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
  const unit = active.key === "receptions" ? "" : " yds";

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Model · Player Prop Model · ${sportLabel}`} />
      </header>

      <section className="explainer explainer--wide">
        <p>
          Our <b>line-blind player projections</b> — the layer that turns the snap-share model into
          per-player prop numbers. The rule we never break: <b>project volume, then multiply by a regressed
          efficiency baseline</b> (carries and targets persist; yards-per-touch is mostly noise). Like the
          game model, these are <b>published and graded in public</b> — not sold as locks.
        </p>
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

      <WeekNav base={base} cat={active.key} current={week} />

      <section className="pmcat">

        {rows.length === 0 ? (
          <div className="pmempty pmempty--solo" role="note">
            <span className="pmempty__tag">Projections arriving</span>
            <p>{active.note}</p>
            <p>
              The pipeline is <b>built and validated</b> (availability AUC ≈ 0.86). The weekly{" "}
              <b>{active.label.toLowerCase()}</b> numbers publish here as each week&apos;s live usage is
              captured — snap-share can&apos;t be backfilled, so it fills in with the season, not before.
            </p>
          </div>
        ) : (
          <>
            {games.map((g) => (
              <div className="pmgame" key={g}>
                <div className="pmgame__h">{g}</div>
                <ScrollHint />
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
                          <span className="pmcell pmcell--num pmcell--proj">
                            {r.proj}{unit}{" "}
                            <span className={`pmarrow ${r.proj >= r.book ? "pmarrow--up" : "pmarrow--down"}`} aria-hidden="true">{r.proj >= r.book ? "▲" : "▼"}</span>
                          </span>
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
