import { Brand, FlowSteps, ContextSubnav } from "../../Nav";
import { NCAAF_MODEL, type NcaafUpset } from "../model-data";

// College Football — Context · Upset Watch (Context landing). Mirrors the NFL Context
// page: underdogs our line-blind rating backs against the market, then every game's line
// beside our own read, then the honest roadmap of what's still arriving. The rating is
// compressed and doesn't beat the spread, so nothing here is a cover pick — it flags
// where our independent read diverges, to arm your judgment. Panels inform; they don't vote.
export const metadata = {
  title: "StatSeer — CFB Upset Watch",
  description: "College-football underdogs our model backs against the market, plus every game's line beside our line-blind read.",
};

const M = NCAAF_MODEL;

export default function Page() {
  const c = M.card;
  const upsets: readonly NcaafUpset[] = c.upsets;

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Context · College Football · Upset Watch · Week ${c.week}, ${c.season}`} />
      </header>

      <FlowSteps active="context" base="ncaaf" />
      <ContextSubnav active="upset" base="ncaaf" />


      {/* --- Upset Watch: where our rating backs the market's underdog --- */}
      <section className="ctxsec">
        <h2 className="ctxsec__h">Upset watch</h2>
        <p className="ctxsec__d">
          Games where our <b>line-blind rating outright picks the underdog</b> the market favors — on a competitive
          line. These aren&apos;t locks (the market is usually right, and our rating doesn&apos;t beat it against the
          number); they&apos;re where a surprise is most in play by our independent read.
        </p>
        {upsets.length === 0 ? (
          <p className="foot">No upset flags this week — our rating agrees with the market&apos;s favorite in every game on the board.</p>
        ) : (
          <div className="upsets">
            {upsets.map((u) => (
              <div className="upset" key={`${u.dog}-${u.matchup}`}>
                <span className="upset__game">{u.dog} <span className="upset__mspread">{u.matchup}</span></span>
                <span className="upset__pick">
                  model: win <b>{u.modelPct}%</b> <span className="upset__mspread">(by {u.byPoints.toFixed(1)})</span>
                </span>
                <span className="upset__mkt">market: {u.spread} · {u.marketPct}%</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="ctxsec__d">
        Looking for the market&apos;s line beside our read on every game? That full model view lives on{" "}
        <a href="/ncaaf/model">The Model</a>.
      </p>

      {/* --- Honest roadmap: data-dependent panels not yet live for CFB --- */}
      <section className="ctxsec">
        <h2 className="ctxsec__h">Arriving this season</h2>
        <p className="ctxsec__d">
          The panels below need live in-season data we&apos;re capturing as the year runs. We&apos;d rather show
          nothing than fake it — here&apos;s what&apos;s coming and why it isn&apos;t here yet.
        </p>
        <div className="soongrid">
          <div className="soon">
            <span className="soon__h">Weather</span>
            <p>Wind is the one measured lead in football totals — the market under-sets ~1.3 pts at 15+ mph. Wires in once we pull game-site forecasts.</p>
          </div>
          <div className="soon">
            <span className="soon__h">Injury &amp; availability</span>
            <p>College depth charts swing games. Availability can&apos;t be backfilled — the daily capture starts as the season&apos;s reports and two-deeps post.</p>
          </div>
          <div className="soon">
            <span className="soon__h">Live weekly odds</span>
            <p>The board above is a Tuesday snapshot of the openers. The full weekly line — moving through kickoff — turns on as the NCAAF odds capture feeds the site.</p>
          </div>
          <div className="soon">
            <span className="soon__h">Rivalry &amp; letdown spots</span>
            <p>A marker of <em>uncertainty</em> around a game, never a direction to bet — flagged once the schedule context (rivalry weeks, look-aheads) is wired in.</p>
          </div>
        </div>
      </section>

      <footer className="foot">
        <p>
          <b>Context informs; it doesn&apos;t vote.</b> The measured context — home field and conference strength — is
          live on <a href="/ncaaf/considerations">Special Considerations</a>; the line-blind rating and its honest
          record are on <a href="/ncaaf/model">The Model</a>.
        </p>
      </footer>
    </main>
  );
}
