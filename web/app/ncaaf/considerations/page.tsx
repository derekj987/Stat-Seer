import { Brand, FlowSteps, ContextSubnav, WeekBadge } from "../../Nav";
import Tip from "@/app/Tip";
import { NcaafWeekNav, NcaafOffWeek, readNcaafWeek } from "../NcaafWeek";
import { NCAAF_MODEL, type NcaafConf, type NcaafCardGame } from "../model-data";
import { StatCard } from "../StatCard";
import NcaafConsiderationsView from "./NcaafConsiderationsView";
import { etToday } from "@/lib/gameDays";

// College Football — Context · Special Considerations. Mirrors the NFL page: one card per
// game with the situational context around it, plus the durable measured backdrop (home
// field + league strength). Context arms judgment; it is never a pick.
export const metadata = {
  title: "StatSeer — CFB Special Considerations",
  description: "The situational context for every college game — site, poll stakes, our power read, and scoring environment — plus home field and conference strength.",
};

const M = NCAAF_MODEL;

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cx = M.context;
  const c = M.card;
  const week = readNcaafWeek((await searchParams).week, c.week);
  const top = cx.conferences[0];
  const games: NcaafCardGame[] = [...c.games]
    .sort((a, b) => (a.commence || "9999").localeCompare(b.commence || "9999")); // soonest kickoff first
  // Power ratings + national rank exist for the top 25; hand them to the client view.
  const ratings: Record<string, { rank: number; rating: number }> = {};
  for (const t of M.top) ratings[t.team] = { rank: t.rank, rating: t.rating };
  // Teams playing this week — powers the "This week's slate" filter.
  const slate = [...new Set(games.flatMap((g) => [g.home, g.away]))];

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NCAAF</span> · Special Considerations</>}
          art={{ src: "/coach.png?v=1", alt: "Coach" }}
        />
      </header>

      <WeekBadge week={c.week} tip={
        <Tip label="Special Considerations" text={<>
          <b>The stuff that doesn&apos;t fit in a number.</b> One card per game with the context around it: the
          <b> site</b> &amp; <b>weather</b> (⚑ marks notable wind), the <b>AP poll</b> stakes, each side&apos;s
          <b> power rating</b> + national rank, and the <b>scoring environment</b> (our total vs the market&apos;s).
          These <b>arm your judgment</b> — not a pick. Referee crews and coaching tendencies aren&apos;t published
          for college, so those rows stay NFL-only. The durable backdrop — home field &amp; league strength — is below.
        </>} />
      } />
      <FlowSteps active="context" base="ncaaf" />
      <div className="subnavrow">
        <ContextSubnav active="special" base="ncaaf" />
      </div>
      <NcaafWeekNav base="/ncaaf/considerations" week={week} />
      <NcaafOffWeek current={c.week} week={week} />

      <section className="ncf-sec">
        <NcaafConsiderationsView games={games} ratings={ratings} hfa={cx.hfa} slate={slate} {...etToday()} />
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
          {cx.conferences.map((cf: NcaafConf, i: number) => (
            <div className="ncf-row" key={cf.conf}>
              <span className="ncf-row__rk">{i + 1}</span>
              <span className="ncf-row__tm">{cf.conf}</span>
              <span className="ncf-row__cf">{cf.teams}</span>
              <span className="ncf-row__rt">{cf.avgRating > 0 ? "+" : ""}{cf.avgRating}</span>
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
