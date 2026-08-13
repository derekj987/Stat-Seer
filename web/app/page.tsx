import { fetchWeek, buildBoard, fmtOdds, type Game, type Line } from "@/lib/board";

export const revalidate = 120; // ISR: rebuild at most every 2 minutes

const WEEK = 1;
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

function fmtPt(p: number | null): string {
  if (p === null) return "";
  return p > 0 ? `+${p}` : String(p);
}

export default async function Page() {
  let board: Game[] = [];
  let error: string | null = null;
  try {
    board = buildBoard(await fetchWeek(WEEK, SEASON));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <main className="wrap">
        <h1 className="brand__mark">VALUE&nbsp;FINDER</h1>
        <p className="foot">Couldn&apos;t load odds: {error}</p>
      </main>
    );
  }

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
          <span className="brand__sub">Line shopping &amp; sweet spots · Week {WEEK}, {SEASON}</span>
        </div>
        <div className="asof">
          lines as of<br />
          <b>{snap ? et(snap, snapFmt) : "n/a"}</b>
        </div>
      </header>

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
    </main>
  );
}
