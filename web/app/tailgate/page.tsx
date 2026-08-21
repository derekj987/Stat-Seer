import { weekRange } from "@/lib/board";
import { weekTailgate, stockLabel, stockArrows, type Buzz } from "@/lib/tailgate";
import { Brand, FlowSteps, ContextSubnav } from "../Nav";
import AddToSlip from "../AddToSlip";

export const revalidate = 300;
const SEASON = 2026;

// Team primary colors, brightened where needed so they stay legible on both the
// light and dark (deep-green) themes. Keyed by nickname (Buzz.team).
const TEAM_COLOR: Record<string, string> = {
  Cardinals: "#e04f6e", Falcons: "#e24857", Ravens: "#9b7be8", Bills: "#4a8fe0",
  Panthers: "#35b4e8", Bears: "#e8792e", Bengals: "#fb6a2e", Browns: "#e8843c",
  Cowboys: "#7aa5e8", Broncos: "#fb7a3c", Lions: "#4aa8e0", Packers: "#5cb06a",
  Texans: "#e24857", Colts: "#5a9ae0", Jaguars: "#2fb6be", Chiefs: "#e8455a",
  Chargers: "#35a8e0", Rams: "#6a9ae8", Raiders: "#b3bac0", Dolphins: "#2ec6ce",
  Vikings: "#8a6fe0", Patriots: "#6a9ae8", Saints: "#cbab52", Giants: "#5a8fe8",
  Jets: "#4fa872", Eagles: "#2fae90", Steelers: "#e8c342", Seahawks: "#69be28",
  "49ers": "#cb5a6e", Buccaneers: "#d84a3c", Titans: "#4aace0", Commanders: "#cf7a5c",
};

// One card per buzz item, same shape as the Special Considerations cards — the bottom line only.
function BuzzCard({ b }: { b: Buzz }) {
  const label = stockLabel(b.direction, b.heat);
  return (
    <article className={`cxcard cxcard--fan cxcard--${b.direction}`}>
      <header className="cxcard__head">
        <span className="matchup" style={{ color: TEAM_COLOR[b.team] ?? "var(--ink)" }}>{b.player}</span>
        <span className={`tgstock tgstock--${b.direction}`} title={`Fan stock: ${label}`}>
          <span className="tgstock__arw" aria-hidden="true">{stockArrows(b.direction, b.heat)}</span>
          <span className="tgstock__l">{label}</span>
        </span>
      </header>
      <dl className="cxcard__rows">
        <div className="cxrow">
          <dt className="cxrow__k">Team</dt>
          <dd className="cxrow__v">{b.team}{b.matchup ? ` · ${b.matchup}` : ""}</dd>
        </div>
        <div className="cxrow">
          <dt className="cxrow__k">Bottom line</dt>
          <dd className="cxrow__v">{b.direction === "up" ? "Fans are buying" : "Fans are selling"} <b>{b.angle}</b>. {b.take}</dd>
        </div>
        <div className="cxrow">
          <dt className="cxrow__k">Heard on</dt>
          <dd className="cxrow__v cxfan__src">
            {b.sources.map((s, i) => (
              <span key={`${b.id}-${i}`} className="tgsrc">
                {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.board}</a> : s.board}
              </span>
            ))}
            <AddToSlip item={{ id: `fan-${b.id}`, kind: "fan", title: b.player, detail: `${b.team} — ${b.angle}` }} />
          </dd>
        </div>
      </dl>
    </article>
  );
}

function WeekNav({ min, max, current }: { min: number; max: number; current: number }) {
  const weeks: number[] = [];
  for (let w = min; w <= max; w++) weeks.push(w);
  return (
    <nav className="weeknav" aria-label="Select week">
      <span className="weeknav__label">Week</span>
      <div className="weeknav__list">
        {weeks.map((w) => (
          <a key={w} href={`/tailgate?week=${w}`}
            className={w === current ? "weeknav__w active" : "weeknav__w"}
            aria-current={w === current ? "page" : undefined}>{w}</a>
        ))}
      </div>
    </nav>
  );
}

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
        <Brand sub={`The Context · Fan Analysis · what fans are saying · Week ${week}, ${SEASON}`} />
      </header>

      {/* The wall: this is fan sentiment, NOT a StatSeer pick or model output. */}
      <div className="tgwall" role="note">
        <span className="tgwall__tag">Fan Stock</span>
        <p>
          This is <b>Fan Stock</b>: a read on which players fans are <b className="tgwall__up">buying&nbsp;▲</b> and
          which they&apos;re <b className="tgwall__down">selling&nbsp;▼</b> on their teams&apos; boards and blogs —
          sleepers heating up, and names the crowd is souring on. It&apos;s <b>ammo for your own research</b>, not
          our model, not a StatSeer pick, and it is <b>never graded</b>. We&apos;re not crunching numbers here —
          we&apos;re handing you the word around the league. Do your own homework.
        </p>
      </div>

      <FlowSteps active="context" />
      <ContextSubnav active="fan" />
      <WeekNav min={min} max={max} current={week} />

      {feed.sample && (
        <p className="tgsample">
          <b>Sample feed.</b> The live fan scan (Reddit team boards first, more forums to follow) turns on for
          the season — these entries show the format.
        </p>
      )}

      {feed.buzz.length === 0 ? (
        <p className="foot">No fan buzz gathered for Week {week} yet — check back closer to kickoff.</p>
      ) : (
        <section className="cxgrid" aria-label={`Week ${week} fan stock`}>
          {feed.buzz.map((b) => <BuzzCard key={b.id} b={b} />)}
        </section>
      )}

      <footer className="foot">
        <p>
          <b>Sentiment, not a signal.</b> Fan boards are passionate and sometimes right — but they&apos;re a
          crowd, not a model. Everything here is opinion aggregated for color and ideas. For the numbers, see
          <a href="/model"> The Model</a>; for where the price is wrong, <a href="/best">Sweet Spots</a>.
        </p>
      </footer>
      </div>

      {/* The seer runs static down the left rail on desktop (like the homepage seer
          on the right); on mobile she drops below the feed in a framed card. */}
      <div className="tg-side" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/newimage.png" alt="" className="tg-seerimg" width={1535} height={1024} />
      </div>
    </main>
  );
}
