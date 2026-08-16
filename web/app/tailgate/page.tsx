import { weekRange } from "@/lib/board";
import { weekTailgate, HEAT_LABEL, type Buzz } from "@/lib/tailgate";
import { Brand, FlowSteps, ValueSubnav } from "../Nav";
import AddToSlip from "../AddToSlip";

export const revalidate = 300;
const SEASON = 2026;

function flames(heat: Buzz["heat"]): string {
  return "🔥".repeat(heat);
}

function BuzzCard({ b }: { b: Buzz }) {
  return (
    <article className={`tgcard tgcard--h${b.heat}`}>
      <header className="tgcard__head">
        <div className="tgcard__id">
          <span className="tgcard__player">{b.player}</span>
          <span className="tgcard__team">{b.team}{b.matchup && <> · {b.matchup}</>}</span>
        </div>
        <span className={`tgheat tgheat--h${b.heat}`} title={`Fan hype: ${HEAT_LABEL[b.heat]}`}>
          <span aria-hidden="true">{flames(b.heat)}</span>
          <span className="tgheat__l">{HEAT_LABEL[b.heat]}</span>
        </span>
      </header>

      <div className="tgcard__angle">The buzz: <b>{b.angle}</b></div>
      <p className="tgcard__take">{b.take}</p>

      <div className="tgcard__src">
        <span className="tgcard__srck">Heard on</span>
        {b.sources.map((s, i) => (
          <span key={`${b.id}-${i}`} className="tgsrc">
            {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.board}</a> : s.board}
          </span>
        ))}
        <AddToSlip item={{ id: `fan-${b.id}`, kind: "fan", title: b.player, detail: `${b.team} — ${b.angle}` }} />
      </div>
    </article>
  );
}

export default async function Page() {
  let range: { min: number; max: number } | null = null;
  try { range = await weekRange(SEASON); } catch { range = null; }
  const week = range?.min ?? 1;

  const feed = await weekTailgate(week, SEASON);

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`Analysis · Fan Analysis · what fans are saying · Week ${week}, ${SEASON}`} />
      </header>

      <FlowSteps active="value" />
      <ValueSubnav active="fans" />

      {/* The wall: this is fan sentiment, NOT a StatSeer pick or model output. */}
      <div className="tgwall" role="note">
        <span className="tgwall__tag">Fan chatter — not a pick</span>
        <p>
          This is <b>Fan Analysis</b>: a digest of what fans are buzzing about on their teams&apos; boards and
          blogs — sleepers who might go <b>over</b> their number this week. It&apos;s <b>ammo for your own
          research</b>, not our model, not a StatSeer pick, and it is <b>never graded</b>. We&apos;re not
          crunching numbers here — we&apos;re handing you the word around the league. Do your own homework.
        </p>
      </div>

      {feed.sample && (
        <p className="tgsample">
          <b>Sample feed.</b> The live fan scan (Reddit team boards first, more forums to follow) turns on for
          the season — these entries show the format.
        </p>
      )}

      {feed.buzz.length === 0 ? (
        <p className="foot">No fan buzz gathered for Week {week} yet — check back closer to kickoff.</p>
      ) : (
        <section className="tgfeed">
          {feed.buzz.map((b) => <BuzzCard key={b.id} b={b} />)}
        </section>
      )}

      <footer className="foot">
        <p>
          <b>Sentiment, not a signal.</b> Fan boards are passionate and sometimes right — but they&apos;re a
          crowd, not a model. Everything here is opinion aggregated for color and ideas. For the numbers, see
          <a href="/model"> The Model</a>; for where the price is wrong, <a href="/best">Best Bets</a>.
        </p>
      </footer>
    </main>
  );
}
