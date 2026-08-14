import { weekRange } from "@/lib/board";
import { weekProps, type PropGame } from "@/lib/props";

export const revalidate = 120;
const SEASON = 2026;

const kickFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const et = (iso: string) => kickFmt.format(new Date(iso)) + " ET";
const fmtOdds = (p: number) => (p > 0 ? `+${p}` : String(p));

function Tabs() {
  return (
    <nav className="tabs" aria-label="View">
      <a href="/" className="tab">Game lines</a>
      <a href="/props" className="tab active" aria-current="page">Player props</a>
    </nav>
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
          <a key={w} href={`/props?week=${w}`}
            className={w === current ? "weeknav__w active" : "weeknav__w"}
            aria-current={w === current ? "page" : undefined}>{w}</a>
        ))}
      </div>
    </nav>
  );
}

// Anytime-TD is a Yes/No bet ("to score"), so "Yes" is implied by the market and
// dropped. Over/Under markets show the meaningful side + line, e.g. "O 249.5".
function sideLabel(side: string, line: number | null): string {
  if (side === "Yes") return "";
  if (side === "No") return "No";
  return line !== null ? `${side[0]} ${line}` : side;
}

function PropGameCard({ g, open }: { g: PropGame; open?: boolean }) {
  const nPlayers = new Set(g.markets.flatMap((m) => m.quotes.map((q) => q.player))).size;
  return (
    <details className="propgame" open={open}>
      <summary className="propgame__head">
        <span className="matchup">{g.away}<span className="at">@</span>{g.home}</span>
        <time className="kick">{et(g.commence)}</time>
        <span className="propgame__meta">{nPlayers} players<span className="propgame__chev">▸</span></span>
      </summary>
      <div className="propgame__body">
        {g.markets.map((m) => (
          <div className="propmkt" key={m.market}>
            <div className="propmkt__label">{m.label}</div>
            <ul className="propq__list">
              {m.quotes.map((q, i) => (
                <li className="propq" key={`${q.player}:${q.side}:${q.line}:${i}`}>
                  <span className="propq__player">{q.player}</span>
                  <span className="propq__side">{sideLabel(q.side, q.line)}</span>
                  <span className="propq__price">{fmtOdds(q.price)}</span>
                  <span className="propq__book">{q.books.join(" / ")}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

export default async function Page({ searchParams }: PageProps<"/props">) {
  const sp = await searchParams;
  let range: { min: number; max: number } | null = null;
  try {
    range = await weekRange(SEASON);
  } catch {
    range = null;
  }
  const min = range?.min ?? 1;
  const max = range?.max ?? 1;
  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested) ? Math.min(max, Math.max(min, requested)) : min;

  const games = await weekProps(week, SEASON);
  const snap = games[0]?.snapshot ?? "";
  const players = games.reduce((n, g) => n + new Set(g.markets.flatMap((m) => m.quotes.map((q) => q.player))).size, 0);

  return (
    <main className="wrap">
      <header className="masthead">
        <div className="brand">
          <span className="brand__mark">VALUE&nbsp;FINDER</span>
          <span className="brand__sub">Player props · best price across books · Week {week}, {SEASON}</span>
        </div>
        {snap && <div className="asof">props as of<br /><b>{et(snap)}</b></div>}
      </header>

      <Tabs />
      <WeekNav min={min} max={max} current={week} />

      {games.length === 0 ? (
        <p className="foot">
          No player props posted for Week {week} yet. Books post most props closer to kickoff —
          this fills in on its own during game week. (Anytime touchdown is usually first up.)
        </p>
      ) : (
        <>
          <p className="hint">{games.length} games · {players} players · best available price on each, shopped across books. Tap a game to expand.</p>
          <section className="propstack">
            {games.map((g, i) => <PropGameCard key={g.eventId} g={g} open={i === 0} />)}
          </section>
          <footer className="foot">
            <p><b>No model. No pick.</b> Just the best available price on each player prop across books —
            where props edge most plausibly lives, since books price hundreds of them semi-independently.
            Projections (is the line beatable?) come later. Prices move; updates as new odds are captured.</p>
          </footer>
        </>
      )}
    </main>
  );
}
