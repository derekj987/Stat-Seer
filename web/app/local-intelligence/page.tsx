import { weekRange } from "@/lib/board";
import { weekTailgate } from "@/lib/tailgate";
import { Brand, FlowSteps, ContextSubnav, WeekBadge } from "../Nav";
import { WeekNav } from "../WeekNav";
import Tip from "../Tip";
import NflIntelFeed from "./NflIntelFeed";

export const revalidate = 300;
const SEASON = 2026;

// Every week is served, with the same week wheel as the other boards. This page used to pin itself
// to `range.max` on the theory that fan boards are only about the game in front of them — but
// weekRange().max is the LAST week the schedule knows about (18), not the current one, so the page
// asked for Week 18, found no buzz, and silently fell back to the hand-written sample feed. That one
// bug produced both reported symptoms: the wrong week label AND a "reddit-only" source list, because
// the sample is reddit-heavy while the live scan also covers all 32 SB Nation team blogs.
export default async function Page({ searchParams }: PageProps<"/local-intelligence">) {
  const sp = await searchParams;
  let range: { min: number; max: number } | null = null;
  try { range = await weekRange(SEASON); } catch { range = null; }
  const min = range?.min ?? 1;
  const max = range?.max ?? 1;
  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested) ? Math.min(max, Math.max(min, requested)) : min;

  const feed = await weekTailgate(week, SEASON);

  return (
    <main className="tg">
      <div className="tg-main">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NFL</span> · Local Intelligence</>}
          art={{ src: "/fans.png?v=1", alt: "Local Intelligence" }}
        />
      </header>

      <WeekBadge week={week} note="fan boards this week" />
      <FlowSteps active="context" />
      <div className="subnavrow">
        <ContextSubnav active="fan" />
        <Tip label="What is Fan Stock?" text={<>This is <b>Fan Stock</b>: a read on which players fans are <b className="tgwall__up">buying&nbsp;▲</b> and
          which they&apos;re <b className="tgwall__down">selling&nbsp;▼</b> on their teams&apos; boards and blogs —
          sleepers heating up, and names the crowd is souring on. It&apos;s <b>ammo for your own research</b>, not
          our model, not a StatSeer pick, and it is <b>never graded</b>. We&apos;re handing you the word around the
          league — do your own homework.</>} />
      </div>

      <WeekNav min={min} max={max} current={week} base="/local-intelligence" />

      {feed.sample && (
        <p className="tgsample">
          <b>Sample feed.</b> No fan buzz has been gathered for Week {week} yet — these entries show the
          format. The live scan reads each team&apos;s Reddit board and its SB Nation blog.
        </p>
      )}

      {feed.buzz.length === 0 ? (
        <p className="foot">No fan buzz gathered for Week {week} yet — check back closer to kickoff.</p>
      ) : (
        <NflIntelFeed buzz={feed.buzz} />
      )}

      <footer className="foot">
        <p>
          <b>Sentiment, not a signal.</b> Fan boards are passionate and sometimes right — but they&apos;re a
          crowd, not a model. Everything here is opinion aggregated for color and ideas. For the numbers, see
          <a href="/model"> The Model</a>; for where the price is wrong, <a href="/best">Sweet Spots</a>.
        </p>
      </footer>
      </div>
    </main>
  );
}
