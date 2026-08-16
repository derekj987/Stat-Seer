import { weekRange } from "@/lib/board";
import { fetchBets, fetchBestProps, fmtOdds, type Play, type KeyPlay, type PropPlay } from "@/lib/bestbets";
import { ContextSubnav, Brand, FlowSteps } from "../Nav";

export const revalidate = 120;
const SEASON = 2026;
const TOP_N = 8;

const kickFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const et = (iso: string) => kickFmt.format(new Date(iso)) + " ET";

function BookTag({ books }: { books: string[] }) {
  return books.length === 1
    ? <span className="book">{books[0]}</span>
    : <span className="book tie" title={books.join(", ")}>×{books.length} books</span>;
}

function WeekNav({ min, max, current }: { min: number; max: number; current: number }) {
  const weeks: number[] = [];
  for (let w = min; w <= max; w++) weeks.push(w);
  return (
    <nav className="weeknav" aria-label="Select week">
      <span className="weeknav__label">Week</span>
      <div className="weeknav__list">
        {weeks.map((w) => (
          <a key={w} href={`/best?week=${w}`}
            className={w === current ? "weeknav__w active" : "weeknav__w"}
            aria-current={w === current ? "page" : undefined}>{w}</a>
        ))}
      </div>
    </nav>
  );
}

function KeyCard({ k }: { k: KeyPlay }) {
  const isSpread = k.market === "Spread";
  return (
    <article className="play play--key">
      <header className="play__head">
        <span className="play__game">{k.game}</span>
        <span className="badge">SWEET SPOT</span>
        <span className="play__mkt">{k.market}</span>
      </header>
      <div className="play__body">
        <div className="play__val"><b>{k.cost.toFixed(0)}%</b><span>½-pt value on {k.num}</span></div>
        <div className="play__sides">
          {[k.sideA, k.sideB].map((s) => (
            <div className="play__side" key={s.label}>
              <span className="play__lbl">{s.label}</span>
              <span className="play__price">{fmtOdds(s.price)}</span>
              <BookTag books={s.books} />
            </div>
          ))}
        </div>
      </div>
      <p className="play__why">
        {isSpread ? (
          <>The margin lands on <b>{k.num}</b> more than any other number, so getting the right side of it
          (or buying the half-point) is worth ~{k.cost.toFixed(0)}% — bigger than any model edge on a game line.</>
        ) : (
          <>The total lands on <b>{k.num}</b> more than most numbers (~{k.cost.toFixed(0)}% of games), so the
          half-point here carries real push value — softer than a spread key, but still worth shopping.</>
        )}
      </p>
    </article>
  );
}

function PriceRow({ p }: { p: Play }) {
  return (
    <div className="pricerow" role="row">
      <span className="pricerow__edge">+{p.edge.toFixed(1)}%</span>
      <span className="pricerow__bet">
        <b>{p.label}</b>
        <span className="pricerow__mkt">{p.market} · {p.game}</span>
      </span>
      <span className="pricerow__price">{fmtOdds(p.price)}</span>
      <BookTag books={p.books} />
    </div>
  );
}

function PropRow({ p }: { p: PropPlay }) {
  return (
    <div className="pricerow" role="row">
      <span className="pricerow__edge">+{p.edge.toFixed(1)}%</span>
      <span className="pricerow__bet">
        <b>{p.player} · {p.label}</b>
        <span className="pricerow__mkt">{p.market} · {p.game}</span>
      </span>
      <span className="pricerow__price">{fmtOdds(p.price)}</span>
      <BookTag books={p.books} />
    </div>
  );
}

export default async function Page({ searchParams }: PageProps<"/best">) {
  const sp = await searchParams;
  let range: { min: number; max: number } | null = null;
  try { range = await weekRange(SEASON); } catch { range = null; }
  const min = range?.min ?? 1;
  const max = range?.max ?? 1;
  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested) ? Math.min(max, Math.max(min, requested)) : min;

  const [{ plays, keys }, propPlays] = await Promise.all([
    fetchBets(week, SEASON),
    fetchBestProps(week, SEASON, TOP_N).catch(() => [] as PropPlay[]),
  ]);
  const topPrices = plays.filter((p) => p.edge > 0.5).slice(0, TOP_N);

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Context · Sweet Spots · Week ${week}, ${SEASON}`} />
      </header>

      <FlowSteps active="context" />
      <ContextSubnav active="best" />
      <WeekNav min={min} max={max} current={week} />

      <details className="readbox">
        <summary className="readbox__h">What am I seeing here?</summary>
        <p>
          <b>Where the value is this week.</b> These are <b>price edges we can prove</b> — the best available
          number across books, and the games where a half-point matters most. Same bet, better price. They are
          <b> not</b> outcome predictions: &quot;we think team X wins&quot; picks only appear once the model
          earns them with a public, calibrated record. A good play means <em>+EV over time</em>, not a lock on
          Sunday.
        </p>
      </details>

      {plays.length === 0 ? (
        <p className="foot">No odds captured for Week {week} yet.</p>
      ) : (
        <>
          {keys.length > 0 && (
            <section className="ctxsec">
              <h2 className="ctxsec__h">Key numbers</h2>
              <p className="ctxsec__d">
                Games sitting on <b>3</b> or <b>7</b>, where the margin lands most often. The single largest
                edge in the whole app, and it&apos;s pure arithmetic.
              </p>
              <div className="playgrid">
                {keys.map((k) => <KeyCard key={k.eventId} k={k} />)}
              </div>
            </section>
          )}

          <section className="ctxsec">
            <h2 className="ctxsec__h">Best prices this week</h2>
            <p className="ctxsec__d">
              The biggest <b>shopping edges</b> — how much better the best book&apos;s price is than the market
              average on the same bet. Placing at the named book captures the difference; it&apos;s the same
              wager everyone else makes at a worse number.
            </p>
            <div className="pricetable" role="table" aria-label="Best prices">
              <div className="pricerow pricerow--head" role="row">
                <span>edge</span><span>bet</span><span>price</span><span>book</span>
              </div>
              {topPrices.map((p) => <PriceRow key={`${p.eventId}:${p.market}:${p.label}`} p={p} />)}
            </div>
          </section>

          {propPlays.length > 0 && (
            <section className="ctxsec">
              <h2 className="ctxsec__h">Best props this week</h2>
              <p className="ctxsec__d">
                Player props where <b>one book is priced well above the field</b> — the same prop at a better
                number. Shopping edge is the de-vigged gap vs. the other books.
              </p>
              <div className="pricetable" role="table" aria-label="Best props">
                <div className="pricerow pricerow--head" role="row">
                  <span>edge</span><span>prop</span><span>price</span><span>book</span>
                </div>
                {propPlays.map((p) => <PropRow key={`${p.eventId}:${p.market}:${p.player}:${p.label}`} p={p} />)}
              </div>
            </section>
          )}
        </>
      )}

      <footer className="foot">
        <p>
          <b>Line shopping, not tips.</b> Every number here is the best available price or a key-number spot,
          updated as new odds are captured. Bet sizing and whether to bet at all are yours — we just make sure
          you never leave value on the table.
        </p>
      </footer>
    </main>
  );
}
