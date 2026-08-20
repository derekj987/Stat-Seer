import { Brand, FlowSteps, SportTabs } from "../Nav";
import { NCAAF_MODEL, type NcaafTeam } from "./model-data";
import { StatCard } from "./StatCard";

// College Football — The Model. A line-blind power rating, published with its real
// out-of-sample track record: it predicts as well as a mature Elo, and we've verified
// it does NOT beat the closing spread. That honesty is the point — this is Context /
// trust, not a pick driver ("panels inform, they do not vote").
export const metadata = {
  title: "StatSeer — College Football Model",
  description: "A line-blind CFB power rating, graded in public. Verified honest: predicts well, doesn't beat the market.",
};

const M = NCAAF_MODEL;

export default function Page() {
  const v = M.validation;
  const a = M.ats;
  const beatsMarket = a.atsPct > a.breakeven;

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Model · College Football · line-blind power rating · ${M.season}`} />
      </header>

      <FlowSteps active="analyze" base="ncaaf" />
      <SportTabs active="ncaaf" />

      <section className="explainer">
        <p>
          <b>The Model, for college football.</b> A line-blind power rating — every team&apos;s strength from
          point differential alone (never win-loss), with home field and prior-season carryover baked in.
          It is <b>published and gradeable</b>, and it drives <b>no picks</b>. Here&apos;s exactly how good it
          is, measured out of sample — the good and the inconvenient.
        </p>
      </section>

      {/* The honest scoreboard — this transparency is the product. */}
      <div className="ncf-cards">
        <StatCard tone="good" label="Predicts as well as Elo"
          value={`${v.ourSU}%`}
          sub={`straight-up, ${v.games.toLocaleString()} games out of sample — vs CFBD Elo ${v.eloSU}% and a ${v.homeSU}% home-team baseline`} />
        <StatCard tone="good" label="Margin error (RMSE)"
          value={`${v.ourRMSE}`}
          sub={`points per game — right with CFBD Elo (${v.eloRMSE}). A competent, honest rating.`} />
        <StatCard tone="flat" label="Against the closing spread"
          value={`${a.atsPct}%`}
          sub={`${a.bets.toLocaleString()} bets — below the ${a.breakeven}% a −110 bettor must clear. It does ${beatsMarket ? "" : "NOT "}beat the market.`} />
      </div>

      <div className="ncf-honest" role="note">
        <span className="ncf-honest__tag">Why we show you this</span>
        <p>
          Most sites would bury that last number. We lead with it. Our CFB model reads games as well as the
          best public systems — but we <b>tested it against the closing line and it doesn&apos;t beat the
          number</b>, the same result we found for NFL game lines. So we publish it as <b>context you can
          trust</b>, graded in the open — <b>not</b> as a pick. A rating that can&apos;t beat the market is
          still a great way to understand one. Panels inform; they don&apos;t vote.
        </p>
      </div>

      <section className="ncf-sec">
        <h2 className="ncf-h">Power ratings — top 25 <span className="ncf-h__note">end of {M.season}, in points vs an average FBS team</span></h2>
        <div className="ncf-tbl">
          <div className="ncf-row ncf-row--head">
            <span>#</span><span>Team</span><span>Conf</span><span>Rating</span>
          </div>
          {M.top.map((t: NcaafTeam) => (
            <div className="ncf-row" key={t.team}>
              <span className="ncf-row__rk">{t.rank}</span>
              <span className="ncf-row__tm">{t.team}</span>
              <span className="ncf-row__cf">{t.conf}</span>
              <span className="ncf-row__rt">{t.rating > 0 ? "+" : ""}{t.rating}</span>
            </div>
          ))}
        </div>
        <p className="ncf-note">
          Read it as a spread: a team rated +{Math.abs(M.top[0].rating)} over one rated +0 is favored by about
          that many points on a neutral field, plus <b>{M.hfa} points</b> of home advantage for the host.
        </p>
      </section>

      <details className="ncf-method">
        <summary className="ncf-method__h">How the rating is built</summary>
        <div className="ncf-method__b">
          <ul>
            <li><b>Point differential, never win-loss.</b> A 3-point win and a 30-point win are different evidence; a win and a loss on the scoreboard hide it.</li>
            <li><b>Ridge-regularized</b> so a team with a thin or lopsided early schedule is pulled toward the mean instead of ballooning on noise.</li>
            <li><b>Prior-season carryover.</b> Each season starts from last year&apos;s regressed rating, then the new games take over — so week 3 isn&apos;t a coin flip.</li>
            <li><b>Blowouts capped</b> at {28} points — running up the score is barely more information than a comfortable win.</li>
            <li><b>Home field = {M.hfa} points</b>, estimated from the data, dropped entirely at neutral sites.</li>
            <li><b>Fit on {M.seasons}</b>, {M.teamsRated} FBS teams, tested walk-forward (each week predicted only from earlier weeks).</li>
          </ul>
        </div>
      </details>

      <footer className="foot">
        <p>
          <b>Line-blind and graded in public.</b> These reads never see the betting line before they&apos;re set,
          and we publish the track record — including where it falls short. For where the price is actually
          wrong, that lives in <a href="/ncaaf/lines">Value Finder</a>; the NFL model is on <a href="/model">The Model</a>.
        </p>
      </footer>
    </main>
  );
}
