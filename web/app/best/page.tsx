import { weekRange } from "@/lib/board";
import { bookLabel } from "@/lib/bookLabel";
import { fetchBets, fetchBestProps, fmtOdds, type KeyPlay, type PropPlay } from "@/lib/bestbets";
import { ShopSubnav, Brand, FlowSteps, WeekBadge } from "../Nav";
import { WeekNav } from "../WeekNav";
import SavableRow from "./SavableRow";
import PinButton from "../PinButton";
import { etToday, groupByGameDay, dayBasis } from "@/lib/gameDays";
import { DayHeader } from "../DayHeader";
import Tip from "../Tip";

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
    ? <span className="book">{bookLabel(books[0])}</span>
    : <span className="book tie" title={books.map(bookLabel).join(", ")}>×{books.length} books</span>;
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
  const { today, tomorrow } = etToday();

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NFL</span> · Sweet Spots</>}
          art={{ src: "/bag.png?v=1", alt: "Value Finder" }}
        />
      </header>

      <WeekBadge week={week} pin={<PinButton size="sm" pin={{ id: "/best", kind: "sweetspots", label: "Sweet Spots · Best Prices", detail: `NFL · Week ${week}`, href: `/best?week=${week}` }} />} />
      <FlowSteps active="value" />
      <div className="subnavrow"><ShopSubnav active="best" /></div>
      <WeekNav min={min} max={max} current={week} base="/best" />

      <details className="readbox">
        <summary className="readbox__h">What am I seeing here?</summary>
        <p>
          <b>Where the value is this week.</b> These are <b>price edges we can prove</b> — the best available
          number across books, and the games where a half-point matters most. Same bet, better price. They are
          <b> not</b> outcome calls: &quot;we think team X wins&quot; picks only appear once the model
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
              <h2 className="ctxsec__h">Key numbers — what to do</h2>
              {/* One line on the board, the detail in the scroll — the house pattern. 476
                  characters stacked above a chart is a wall nobody reads, which protects nobody. */}
              <p className="ctxsec__d">
                Margins land on <b>3</b> and <b>7</b> more than any other number, so a line sitting on one is
                worth acting on.{" "}
                {/* Tip content uses <br /><br />, never <p>: this legend IS a <p>, and a nested <p>
                    makes the parser close the outer one, so the "moved into the scroll" copy pops
                    back out onto the page as siblings. It looked moved and was not. */}
                <Tip label="How to play a key number" text={<>
                  NFL games are decided by <b>3</b> or <b>7</b> far more than any other margin. So when a
                  spread or total sits right on one of those numbers, do one of two things: <b>take the side
                  that already has the number working for it</b> (the favorite laying fewer than 3, or the dog
                  getting 3+), or <b>buy the half-point</b> to move onto it.<br /><br />
                  That half-point swings more games than any model edge on a line — the biggest, cheapest edge
                  in the app. Each card below shows the number and exactly what the half-point is worth.
                </>} />
              </p>
              <div className="daygrid">
                {groupByGameDay(keys, (k) => k.commence, today, tomorrow).map((grp) => (
                  <div className="daygrid__day" key={grp.key} style={dayBasis(grp.items.length, 3, 290, 14)}>
                    <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} noun="play" />
                    <div className="playgrid">{grp.items.map((k) => <KeyCard key={k.eventId} k={k} />)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <p className="ctxsec__lead">
            <b>Tap any row to add it to your slip.</b>{" "}
            <Tip label="How the slip works" text={<>
              StatSeer lines up the single best sportsbook for each leg you save, and totals your ticket at
              the bottom of the screen.
            </>} />
          </p>

          <section className="ctxsec">
            <h2 className="ctxsec__h">Best prices this week</h2>
            <p className="ctxsec__d">
              The biggest <b>shopping edges</b> — how far the best book&apos;s price beats the market average.{" "}
              <Tip label="What a shopping edge is" text={<>
                Placing at the named book captures the difference. It is the same wager everyone else makes,
                at a worse number — no prediction involved, which is why this is the part of the app that
                does not depend on a model being right.
              </>} />
            </p>
            <div className="pricetable" role="table" aria-label="Best prices">
              {groupByGameDay(topPrices, (p) => p.commence, today, tomorrow).map((grp) => (
                <div key={grp.key}>
                  <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} noun="play" />
                  <div className="pricerow pricerow--head" role="row">
                    <span>bet</span><span>price</span><span>book</span><span>edge</span><span aria-hidden="true"></span>
                  </div>
                  {grp.items.map((p) => (
                    <SavableRow
                      key={`${p.eventId}:${p.market}:${p.label}`}
                      item={{ id: `best-${p.eventId}:${p.market}:${p.label}`, kind: "line",
                        title: `${p.market} ${p.label}`, detail: p.game, price: p.price, books: p.books }}
                      bet={p.label} sub={`${p.market} · ${p.game}`} price={fmtOdds(p.price)} books={p.books} edge={p.edge}
                    />
                  ))}
                </div>
              ))}
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
                {groupByGameDay(propPlays, (p) => p.commence, today, tomorrow).map((grp) => (
                  <div key={grp.key}>
                    <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} noun="prop" />
                    <div className="pricerow pricerow--head" role="row">
                      <span>prop</span><span>price</span><span>book</span><span>edge</span><span aria-hidden="true"></span>
                    </div>
                    {grp.items.map((p) => (
                      <SavableRow
                        key={`${p.eventId}:${p.market}:${p.player}:${p.label}`}
                        item={{ id: `bestprop-${p.eventId}:${p.market}:${p.player}:${p.label}`, kind: "prop",
                          title: `${p.player} ${p.label}`, detail: `${p.market} · ${p.game}`, price: p.price, books: p.books }}
                        bet={`${p.player} · ${p.label}`} sub={`${p.market} · ${p.game}`} price={fmtOdds(p.price)} books={p.books} edge={p.edge}
                      />
                    ))}
                  </div>
                ))}
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
