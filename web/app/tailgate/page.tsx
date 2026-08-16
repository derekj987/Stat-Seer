import { weekRange } from "@/lib/board";
import { weekTailgate, HEAT_LABEL, type Buzz } from "@/lib/tailgate";
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

function flames(heat: Buzz["heat"]): string {
  return "🔥".repeat(heat);
}

function BuzzCard({ b }: { b: Buzz }) {
  return (
    <article className={`tgcard tgcard--h${b.heat}`}>
      <header className="tgcard__head">
        <div className="tgcard__id">
          <span className="tgcard__player">{b.player}</span>
          {b.matchup && <span className="tgcard__team">{b.matchup}</span>}
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

// Group the flat feed by team, buzziest team first (max heat, then count, then name).
// Input is already heat-desc, so each team's cards stay heat-desc.
function groupByTeam(buzz: Buzz[]): [string, Buzz[]][] {
  const map = new Map<string, Buzz[]>();
  for (const b of buzz) {
    const list = map.get(b.team);
    if (list) list.push(b);
    else map.set(b.team, [b]);
  }
  return [...map.entries()].sort((a, z) => {
    const ah = Math.max(...a[1].map((x) => x.heat));
    const zh = Math.max(...z[1].map((x) => x.heat));
    if (zh !== ah) return zh - ah;
    if (z[1].length !== a[1].length) return z[1].length - a[1].length;
    return a[0].localeCompare(z[0]);
  });
}

export default async function Page() {
  let range: { min: number; max: number } | null = null;
  try { range = await weekRange(SEASON); } catch { range = null; }
  const week = range?.min ?? 1;

  const feed = await weekTailgate(week, SEASON);

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Context · Fan Analysis · what fans are saying · Week ${week}, ${SEASON}`} />
      </header>

      <FlowSteps active="context" />
      <ContextSubnav active="fan" />

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
          {groupByTeam(feed.buzz).map(([team, buzz]) => (
            <details className="tgteam" key={team}>
              <summary className="tgteam__h">
                <span className="tgteam__name" style={{ color: TEAM_COLOR[team] ?? "var(--gold)" }}>{team}</span>
                <span className="tgteam__n">{buzz.length}</span>
                <span className="tgteam__chev" aria-hidden="true">▸</span>
              </summary>
              <div className="tgteam__cards">
                {buzz.map((b) => <BuzzCard key={b.id} b={b} />)}
              </div>
            </details>
          ))}
        </section>
      )}

      <footer className="foot">
        <p>
          <b>Sentiment, not a signal.</b> Fan boards are passionate and sometimes right — but they&apos;re a
          crowd, not a model. Everything here is opinion aggregated for color and ideas. For the numbers, see
          <a href="/model"> The Model</a>; for where the price is wrong, <a href="/best">Sweet Spots</a>.
        </p>
      </footer>
    </main>
  );
}
