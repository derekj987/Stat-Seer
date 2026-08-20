import { Brand, FlowSteps, ContextSubnav } from "../../Nav";
import { NCAAF_MODEL, type NcaafConf } from "../model-data";
import { StatCard } from "../StatCard";

// College Football — Context · Special Considerations. The durable, measured
// situational context: home field and league strength. Backdrop, never a pick.
export const metadata = {
  title: "StatSeer — CFB Special Considerations",
  description: "The measured situational context for college football — home field and conference strength.",
};

const M = NCAAF_MODEL;

export default function Page() {
  const cx = M.context;
  const top = cx.conferences[0];

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Context · College Football · Special Considerations · ${M.season}`} />
      </header>

      <FlowSteps active="context" base="ncaaf" />
      <ContextSubnav active="special" base="ncaaf" />

      <section className="explainer">
        <p>
          <b>The stuff around a game that a rating leans on but doesn&apos;t announce.</b> For college football the
          durable, measured pieces are <b>home field</b> and <b>league strength</b> — they shape every number
          without being a pick. Game-week items (weather, injuries, specific matchups) fill in as the season runs.
        </p>
      </section>

      <div className="ncf-cards">
        <StatCard label="Home field" value={`+${cx.hfa}`}
          sub={`points, fit from ${M.seasons}. Dropped to zero at neutral sites — bowls, kickoff classics, neutral-city rivalries.`} />
        <StatCard label="Conferences ranked" value={`${cx.conferences.length}`}
          sub="by average member rating — the strength-of-schedule backdrop behind any cross-conference matchup" />
        <StatCard label="Strongest league" value={top.conf}
          sub={`the top conference by our rating (avg +${top.avgRating} per team)`} />
      </div>

      <section className="ncf-sec">
        <h2 className="ncf-h">Conference strength
          <span className="ncf-h__note">average team rating, end of {M.season}</span></h2>
        <div className="ncf-tbl">
          <div className="ncf-row ncf-row--head">
            <span>#</span><span>Conference</span><span>Teams</span><span>Avg</span>
          </div>
          {cx.conferences.map((c: NcaafConf, i: number) => (
            <div className="ncf-row" key={c.conf}>
              <span className="ncf-row__rk">{i + 1}</span>
              <span className="ncf-row__tm">{c.conf}</span>
              <span className="ncf-row__cf">{c.teams}</span>
              <span className="ncf-row__rt">{c.avgRating > 0 ? "+" : ""}{c.avgRating}</span>
            </div>
          ))}
        </div>
        <p className="ncf-note">
          League strength is <b>backdrop, not a lean</b>. It explains why a middling SEC team can be favored over a
          strong Sun Belt team on a neutral field — the schedules they survived differ — but it never sets a
          number by itself.
        </p>
      </section>

      <footer className="foot">
        <p>
          <b>Understand the game — don&apos;t get handed a pick.</b> For the line-blind read see
          <a href="/ncaaf/model"> The Model</a>; for where the price is wrong, <a href="/ncaaf/lines">Value Finder</a>.
        </p>
      </footer>
    </main>
  );
}
