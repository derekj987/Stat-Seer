import { Brand, FlowSteps, SportTabs } from "../../Nav";
import { NCAAF_MODEL, type NcaafConf } from "../model-data";
import { StatCard } from "../StatCard";

// College Football — Context. What to understand around a game, not a pick driver.
// For now the durable, measured context: home field and conference strength. Game-week
// context (injuries, weather, matchups) fills in as the season's data flows.
export const metadata = {
  title: "StatSeer — College Football Context",
  description: "The measured context behind college football games — home field and conference strength. Context informs; it doesn't vote.",
};

const M = NCAAF_MODEL;

export default function Page() {
  const cx = M.context;
  const top = cx.conferences[0];

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Context · College Football · what to understand · ${M.season}`} />
      </header>

      <FlowSteps active="context" base="ncaaf" />
      <SportTabs active="ncaaf" />

      <section className="explainer">
        <p>
          <b>Context informs; it doesn&apos;t vote.</b> These are the things around a college game that shape it
          without setting the number — the backdrop your judgment runs on. Right now that&apos;s the <b>durable,
          measured</b> context: how much home field is worth, and how the leagues stack up. None of it is a pick.
        </p>
      </section>

      <div className="ncf-cards">
        <StatCard label="Home field" value={`+${cx.hfa}`}
          sub={`points, fit from ${M.seasons}. Dropped to zero at neutral sites — bowls, kickoff classics, and neutral-city rivalries.`} />
        <StatCard label="Conferences ranked" value={`${cx.conferences.length}`}
          sub="by average member rating — the league-strength backdrop behind any cross-conference matchup" />
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
          strong Sun Belt team on a neutral field — the schedules they survived aren&apos;t the same — but it never
          sets a number by itself.
        </p>
      </section>

      <div className="ncf-honest" role="note">
        <span className="ncf-honest__tag">Being built</span>
        <p>
          Game-week context — injuries, weather, specific matchup edges — fills in as each week&apos;s data flows.
          What&apos;s here now is the context that <b>doesn&apos;t change with a news cycle</b>. The NFL side&apos;s
          <a href="/context"> Upset Watch</a>, <a href="/considerations">Special Considerations</a>, and
          <a href="/tailgate"> Fan Analysis</a> are the template these will follow.
        </p>
      </div>

      <footer className="foot">
        <p>
          <b>Understand the game — don&apos;t get handed a pick.</b> For the line-blind read see
          <a href="/ncaaf"> The Model</a>; for where the price is wrong, <a href="/ncaaf/value">Value Finder</a>.
        </p>
      </footer>
    </main>
  );
}
