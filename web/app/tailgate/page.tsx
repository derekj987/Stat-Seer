import { weekRange } from "@/lib/board";
import { weekTailgate, stockLabel, stockArrows, type Buzz } from "@/lib/tailgate";
import { Brand, FlowSteps, ContextSubnav } from "../Nav";
import { WeekNav } from "../WeekNav";
import { TeamNav } from "../TeamNav";
import Tip from "../Tip";
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

// A feed post: player + "{team} fans buying/selling", the fan take as the body, then a bold
// VERDICT (the bettable angle) with add-to-slip. Reads like a tweet with a call attached.
function BuzzCard({ b }: { b: Buzz }) {
  const label = stockLabel(b.direction, b.heat);
  const srcs = [...new Map(b.sources.map((s) => [s.board, s])).values()];
  return (
    <article className={`tgpost tgpost--${b.direction}`}>
      <header className="tgpost__head">
        <span className="tgpost__player" style={{ color: TEAM_COLOR[b.team] ?? "var(--ink)" }}>{b.player}</span>
        <span className="tgpost__who">{b.team} fans {b.direction === "up" ? "buying" : "selling"}</span>
        <span className={`tgstock tgstock--${b.direction}`} title={`Fan stock: ${label}`}>
          <span className="tgstock__arw" aria-hidden="true">{stockArrows(b.direction, b.heat)}</span>
          <span className="tgstock__l">{label}</span>
        </span>
      </header>
      <p className="tgpost__body">{b.take}{b.matchup ? ` (${b.matchup})` : ""}</p>
      <div className={`tgverdict tgverdict--${b.direction}`}>
        <span className="tgverdict__call">
          <span className="tgverdict__k">Verdict</span>
          <b className="tgprop">{b.angle}</b>
          <span className="tgverdict__side">{b.direction === "up" ? "▲ over" : "▼ under"}</span>
        </span>
        <AddToSlip item={{ id: `fan-${b.id}`, kind: "fan", title: b.player, detail: `${b.team} — ${b.angle}` }} />
      </div>
      <div className="tgpost__foot">
        Heard on {srcs.map((s, i) => (
          <span key={`${b.id}-${i}`} className="tgsrc">
            {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.board}</a> : s.board}
          </span>
        ))}
      </div>
    </article>
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

  // Consolidate the wall by team: one labelled group per team, busiest first.
  const teamMap = new Map<string, Buzz[]>();
  for (const b of feed.buzz) (teamMap.get(b.team) ?? teamMap.set(b.team, []).get(b.team)!).push(b);
  const byTeam = [...teamMap.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const teamId = (team: string) => `tgteam-${team.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  // Team wheel is alphabetical so members can find their team fast (sections stay busiest-first).
  const teamNav = byTeam
    .map(([team, items]) => ({ team, color: TEAM_COLOR[team] ?? "var(--ink)", id: teamId(team), count: items.length }))
    .sort((a, b) => a.team.localeCompare(b.team));

  return (
    <main className="tg">
      <div className="tg-main">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NFL</span> · Local Intelligence</>}
          art={{ src: "/fans.png?v=1", alt: "Local Intelligence" }}
        />
      </header>

      <FlowSteps active="context" />
      <div className="subnavrow">
        <ContextSubnav active="fan" />
        <Tip label="What is Fan Stock?" text={<>This is <b>Fan Stock</b>: a read on which players fans are <b className="tgwall__up">buying&nbsp;▲</b> and
          which they&apos;re <b className="tgwall__down">selling&nbsp;▼</b> on their teams&apos; boards and blogs —
          sleepers heating up, and names the crowd is souring on. It&apos;s <b>ammo for your own research</b>, not
          our model, not a StatSeer pick, and it is <b>never graded</b>. We&apos;re handing you the word around the
          league — do your own homework.</>} />
      </div>
      <WeekNav min={min} max={max} current={week} base="/tailgate" />

      {feed.sample && (
        <p className="tgsample">
          <b>Sample feed.</b> The live fan scan (Reddit team boards first, more forums to follow) turns on for
          the season — these entries show the format.
        </p>
      )}

      {feed.buzz.length === 0 ? (
        <p className="foot">No fan buzz gathered for Week {week} yet — check back closer to kickoff.</p>
      ) : (
        <>
        {teamNav.length > 1 && <TeamNav teams={teamNav} />}
        {byTeam.map(([team, items]) => (
          <section className="tgteam" id={teamId(team)} key={team} aria-label={`${team} fan stock`}>
            <h3 className="tgteam__h" style={{ color: TEAM_COLOR[team] ?? "var(--ink)" }}>
              {team}<span className="tgteam__n">{items.length}</span>
            </h3>
            <div className="tgfeed">
              {[...items].sort((a, b) => b.heat - a.heat || a.player.localeCompare(b.player)).map((b) => <BuzzCard key={b.id} b={b} />)}
            </div>
          </section>
        ))}
        </>
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
