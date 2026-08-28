import { cfbWeekTailgate, stockLabel, stockArrows, type Buzz } from "@/lib/cfbTailgate";
import { Brand, FlowSteps, ContextSubnav } from "../../Nav";
import { TeamNav } from "../../TeamNav";
import Tip from "../../Tip";
import AddToSlip from "../../AddToSlip";
import { NCAAF_MODEL } from "../model-data";

// College Football — Context · Local Intelligence ("Fan Stock"). Mirrors the NFL page:
// which players fans are buying ▲ / selling ▼ on team boards + r/CFB. Sentiment, never a
// pick, never graded. Live scan lands later; a seeded sample shows the format until then.
export const metadata = {
  title: "StatSeer — CFB Local Intelligence",
  description: "Fan Stock for college football — which players fans are buying and selling on team boards. Sentiment, not a pick.",
};

export const revalidate = 300;

// A few school colors brightened to stay legible on both themes; anything else falls to gold.
const TEAM_COLOR: Record<string, string> = {
  USC: "#e8455a", TCU: "#8a6fe0", "NC State": "#e24857", "North Carolina": "#4a9fe0",
  Virginia: "#e8843c", "San Jose State": "#4aa8e0", "Florida State": "#cb5a3c",
  Stanford: "#cb5a6e", UNLV: "#e8c342", Memphis: "#35a8e0",
};
const teamColor = (t: string) => TEAM_COLOR[t] ?? "var(--gold)";

// A feed post: player + "{team} fans buying/selling", the fan take as the body, then a bold
// VERDICT (the bettable angle) with add-to-slip. Reads like a tweet with a call attached.
function BuzzCard({ b }: { b: Buzz }) {
  const label = stockLabel(b.direction, b.heat);
  const srcs = [...new Map(b.sources.map((s) => [s.board, s])).values()];
  return (
    <article className={`tgpost tgpost--${b.direction}`}>
      <header className="tgpost__head">
        <span className="tgpost__player" style={{ color: teamColor(b.team) }}>{b.player}</span>
        <span className="tgpost__who">{b.team} fans {b.direction === "up" ? "buying" : "selling"}</span>
        <span className={`tgstock tgstock--${b.direction}`} title={`Fan stock: ${label}`}>
          <span className="tgstock__arw" aria-hidden="true">{stockArrows(b.direction, b.heat)}</span>
          <span className="tgstock__l">{label}</span>
        </span>
      </header>
      <p className="tgpost__body">{b.take}{b.matchup ? ` (${b.matchup})` : ""}</p>
      <div className={`tgverdict tgverdict--${b.direction}`}>
        <span className="tgverdict__k">Verdict</span>
        <b className="tgprop">{b.angle}</b>
        <span className="tgverdict__side">{b.direction === "up" ? "▲ over" : "▼ under"}</span>
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

export default async function Page() {
  const week = NCAAF_MODEL.card.week;
  const season = NCAAF_MODEL.card.season;
  const feed = await cfbWeekTailgate(week, season);

  const teamMap = new Map<string, Buzz[]>();
  for (const b of feed.buzz) (teamMap.get(b.team) ?? teamMap.set(b.team, []).get(b.team)!).push(b);
  const byTeam = [...teamMap.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const teamId = (team: string) => `tgteam-${team.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const teamNav = byTeam
    .map(([team, items]) => ({ team, color: teamColor(team), id: teamId(team), count: items.length }))
    .sort((a, b) => a.team.localeCompare(b.team));

  return (
    <main className="tg">
      <div className="tg-main">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NCAAF</span> · Local Intelligence</>}
          art={{ src: "/fans.png?v=1", alt: "Local Intelligence" }}
        />
      </header>

      <FlowSteps active="context" base="ncaaf" />
      <div className="subnavrow">
        <ContextSubnav active="fan" base="ncaaf" />
        <Tip label="What is Fan Stock?" text={<>This is <b>Fan Stock</b>: a read on which players fans are <b className="tgwall__up">buying&nbsp;▲</b> and
          which they&apos;re <b className="tgwall__down">selling&nbsp;▼</b> on their teams&apos; boards and r/CFB —
          sleepers heating up, and names the crowd is souring on. It&apos;s <b>ammo for your own research</b>, not
          our model, not a StatSeer pick, and it is <b>never graded</b>.</>} />
      </div>

      {feed.sample && (
        <p className="tgsample">
          <b>Sample feed.</b> The live college fan scan (r/CFB + team boards) turns on for the season — these
          entries show the format with real current starters.
        </p>
      )}

      {feed.buzz.length === 0 ? (
        <p className="foot">No fan buzz gathered for Week {week} yet — check back closer to kickoff.</p>
      ) : (
        <>
        {teamNav.length > 1 && <TeamNav teams={teamNav} />}
        {byTeam.map(([team, items]) => (
          <section className="tgteam" id={teamId(team)} key={team} aria-label={`${team} fan stock`}>
            <h3 className="tgteam__h" style={{ color: teamColor(team) }}>
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
          <a href="/ncaaf/model"> The Model</a>; for where the price is wrong, <a href="/ncaaf/best">Sweet Spots</a>.
        </p>
      </footer>
      </div>
    </main>
  );
}
