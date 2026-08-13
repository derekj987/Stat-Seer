import { fetchWeek, weekRange, buildBoard, fmtOdds, type Game, type Line } from "@/lib/board";

export const revalidate = 120; // fetch-level ISR: refresh Supabase reads every 2 min

const SEASON = 2026;

const kickFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit",
});
const snapFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit",
});
const et = (iso: string, f: Intl.DateTimeFormat) => f.format(new Date(iso)) + " ET";

function fmtPt(p: number | null): string {
  if (p === null) return "";
  return p > 0 ? `+${p}` : String(p);
}

function LineChip({ label, line, best }: { label: string; line: Line; best?: boolean }) {
  const book =
    line.books.length === 1 ? (
      <span className="book">{line.books[0]}</span>
    ) : (
      <span className="book tie" title={line.books.join(", ")}>×{line.books.length} books</span>
    );
  return (
    <div className={best ? "line best" : "line"}>
      <span className="team">{label}</span>
      <span className="odds">{fmtOdds(line.price)}</span>
      {book}
    </div>
  );
}

function WeekNav({ min, max, current }: { min: number; max: number; current: number }) {
  const weeks = [];
  for (let w = min; w <= max; w++) weeks.push(w);
  return (
    <nav className="weeknav" aria-label="Select week">
      <span className="weeknav__label">Week</span>
      <div className="weeknav__list">
        {weeks.map((w) => (
          <a
            key={w}
            href={`/?week=${w}`}
            className={w === current ? "weeknav__w active" : "weeknav__w"}
            aria-current={w === current ? "page" : undefined}
          >
            {w}
          </a>
        ))}
      </div>
    </nav>
  );
}

function GameCard({ g }: { g: Game }) {
  const ml = Object.entries(g.ml);
  const bestSide = ml.length ? ml.reduce((a, b) => (b[1].edge > a[1].edge ? b : a))[0] : null;
  const bestEdge = ml.reduce((m, [, s]) => Math.max(m, s.edge), 0);
  const c = g.coherence;
  const s = g.spread;
  const t = g.total;

  return (
    <article className={s.key ? "game key" : "game"}>
      <header className="game__head">
        <span className="matchup">{g.away}<span className="at">@</span>{g.home}</span>
        <time className="kick">{et(g.commence, kickFmt)}</time>
        {s.key && <span className="badge">SWEET SPOT</span>}
      </header>

      <div className="markets">
        <div className="mkt">
          <span className="mkt__label">Moneyline</span>
          <div className="lines">
            {ml.map(([side, m]) => (
              <LineChip key={side} label={side} line={{ point: null, price: m.price, books: m.books }} best={side === bestSide} />
            ))}
          </div>
          <div className="mkt__note"><span className="edge">shop&nbsp;+{bestEdge.toFixed(1)}%</span></div>
        </div>

        {s.home && s.away && (
          <div className="mkt">
            <span className="mkt__label">Spread</span>
            <div className="lines">
              <LineChip label={`${g.home} ${fmtPt(s.home.point)}`} line={s.home} />
              <LineChip label={`${g.away} ${fmtPt(s.away.point)}`} line={s.away} />
            </div>
            <div className="mkt__note">
              {s.key && <span className="keytag">on {s.key.num} · ½pt ≈ {s.key.cost.toFixed(0)}%</span>}
            </div>
          </div>
        )}

        {t.over && t.under && (
          <div className="mkt">
            <span className="mkt__label">Total</span>
            <div className="lines">
              <LineChip label={`O ${t.over.point}`} line={t.over} />
              <LineChip label={`U ${t.under.point}`} line={t.under} />
            </div>
            <div className="mkt__note" />
          </div>
        )}
      </div>

      {c && (
        <div className={c.flag === "investigate" ? "coh invest" : "coh"}>
          <span className="coh__k">Market</span>
          <span className="coh__v">{c.flag === "investigate" ? "Investigate" : "Fair"}</span>
          <span className="coh__d">
            {c.fav} priced {Math.round(c.mktFair * 100)}% vs 27-yr {Math.round(c.emp * 100)}% · hold {(c.hold * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </article>
  );
}

function Shell({ children, sub }: { children: React.ReactNode; sub: string }) {
  return (
    <main className="wrap">
      <header className="masthead">
        <div className="brand">
          <span className="brand__mark">VALUE&nbsp;FINDER</span>
          <span className="brand__sub">{sub}</span>
        </div>
      </header>
      {children}
    </main>
  );
}

export default async function Page({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;

  let range: { min: number; max: number } | null = null;
  try {
    range = await weekRange(SEASON);
  } catch (e) {
    return <Shell sub="Line shopping & sweet spots"><p className="foot">Couldn&apos;t load odds: {e instanceof Error ? e.message : String(e)}</p></Shell>;
  }
  if (!range) {
    return <Shell sub="Line shopping & sweet spots"><p className="foot">No odds captured yet. Once the capture job has run, games will appear here.</p></Shell>;
  }

  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested)
    ? Math.min(range.max, Math.max(range.min, requested))
    : range.min;

  const board = buildBoard(await fetchWeek(week, SEASON));
  const snap = board[0]?.snapshot ?? "";
  const edges = board.flatMap((g) => Object.values(g.ml).map((s) => s.edge));
  const avgEdge = edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : 0;
  const keyGames = board.filter((g) => g.spread.key).length;
  const cohs = board.map((g) => g.coherence).filter((c): c is NonNullable<typeof c> => !!c);
  const fairN = cohs.filter((c) => c.flag === "fair").length;

  return (
    <main className="wrap">
      <header className="masthead">
        <div className="brand">
          <span className="brand__mark">VALUE&nbsp;FINDER</span>
          <span className="brand__sub">Line shopping &amp; sweet spots · Week {week}, {SEASON}</span>
        </div>
        {snap && (
          <div className="asof">
            lines as of<br />
            <b>{et(snap, snapFmt)}</b>
          </div>
        )}
      </header>

      <WeekNav min={range.min} max={range.max} current={week} />

      {board.length === 0 ? (
        <p className="foot">No odds captured for Week {week} yet.</p>
      ) : (
        <>
          <section className="stats" aria-label="summary">
            <div className="stat"><span className="stat__v">+{avgEdge.toFixed(2)}%</span><span className="stat__l">avg shopping edge / side</span></div>
            <div className="stat"><span className="stat__v">{keyGames}</span><span className="stat__l">sweet-spot games</span></div>
            <div className="stat"><span className="stat__v">{cohs.length ? `${fairN}/${cohs.length}` : "—"}</span><span className="stat__l">priced fair vs history</span></div>
            <div className="stat"><span className="stat__v">10</span><span className="stat__l">books compared</span></div>
          </section>

          <section className="grid">
            {board.map((g) => <GameCard key={g.eventId} g={g} />)}
          </section>

          <footer className="foot">
            <p>
              <b>No model. No pick.</b> Value Finder shows the best available number across
              books, where a half-point sits on a sweet spot (a 3 or 7, worth the most), and a
              fair-price check — the de-vigged price vs. how a favorite of that spread has
              actually done over 27 seasons. Prices move; this updates automatically as new
              odds are captured.
            </p>
          </footer>
        </>
      )}
    </main>
  );
}
