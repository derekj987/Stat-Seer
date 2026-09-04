import { cfbWeekTailgate } from "@/lib/cfbTailgate";
import { Brand, FlowSteps, ContextSubnav, WeekBadge } from "../../Nav";
import Tip from "../../Tip";
import { NCAAF_MODEL } from "../model-data";
import { NcaafWeekNav, readNcaafWeek, ncaafCard } from "../NcaafWeek";
import LocalIntelFeed from "./LocalIntelFeed";

// College Football — Context · Local Intelligence ("Fan Stock"). Which players fans are
// buying ▲ / selling ▼ on team boards + r/CFB. Sentiment, never a pick, never graded.
// Pick a conference → team (or this week's slate) from the dropdowns to navigate.
export const metadata = {
  title: "StatSeer — CFB Local Intelligence",
  description: "Fan Stock for college football — which players fans are buying and selling on team boards. Fan sentiment, shown for context.",
};

export const revalidate = 300;

// Serves every scheduled week with the standard week wheel, matching the NFL page and every other
// NCAAF board. The slate filter follows the SELECTED week, not the current one — otherwise picking
// week 3 would filter its buzz against week 1's fixtures.
export default async function Page({ searchParams }: PageProps<"/ncaaf/local-intelligence">) {
  const sp = await searchParams;
  const week = readNcaafWeek(sp.week, NCAAF_MODEL.card.week);
  const season = NCAAF_MODEL.card.season;
  const feed = await cfbWeekTailgate(week, season);
  // Teams playing in the SELECTED week — powers the "This week's slate" filter.
  const slate = [...new Set(ncaafCard(week).games.flatMap((g) => [g.home, g.away]))];

  return (
    <main className="tg">
      <div className="tg-main">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NCAAF</span> · Local Intelligence</>}
          art={{ src: "/fans.png?v=1", alt: "Local Intelligence" }}
        />
      </header>

      <WeekBadge week={week} note="fan boards this week" />
      <FlowSteps active="context" base="ncaaf" />
      <div className="subnavrow">
        <ContextSubnav active="fan" base="ncaaf" />
        <Tip label="What is Fan Stock?" text={<>This is <b>Fan Stock</b>: a read on which players fans are <b className="tgwall__up">buying&nbsp;▲</b> and
          which they&apos;re <b className="tgwall__down">selling&nbsp;▼</b> on their teams&apos; boards and r/CFB —
          sleepers heating up, and names the crowd is souring on. It&apos;s <b>ammo for your own research</b>, not
          our model, not a StatSeer pick, and it is <b>never graded</b>.</>} />
      </div>

      <NcaafWeekNav base="/ncaaf/local-intelligence" week={week} />

      {feed.sample && (
        <p className="tgsample">
          <b>Sample feed.</b> No fan buzz has been gathered for Week {week} yet — these entries show the
          format. The live scan reads r/CFB and each school&apos;s SB Nation team blog.
        </p>
      )}

      {feed.buzz.length === 0 ? (
        <p className="foot">No fan buzz gathered for Week {week} yet — check back closer to kickoff.</p>
      ) : (
        <LocalIntelFeed buzz={feed.buzz} slate={slate} />
      )}

      <footer className="foot">
        <p>
          <b>Sentiment, not a signal.</b> Fan boards are passionate and sometimes right — but they&apos;re a
          crowd, not a model. Everything here is opinion aggregated for color and ideas. For the numbers, see
          <a href="/ncaaf/model"> The Model</a>; for where the price is wrong, <a href="/ncaaf/best">Sweet Spots</a>.
        </p>
      </footer>
      </div>
    </main>
  );
}
