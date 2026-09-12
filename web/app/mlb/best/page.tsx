import { fetchMlbBets, fetchMlbBestProps, MLB_KEYS, type RunLinePlay, type MlbPropPlay } from "@/lib/mlbBest";
import { bookLabel } from "@/lib/bookLabel";
import { fmtOdds, type KeyPlay } from "@/lib/bestbets";
import { ShopSubnav, Brand, FlowSteps, DayBadge } from "../../Nav";
import SavableRow from "../../best/SavableRow";
import PinButton from "../../PinButton";
import { StatCard } from "../../ncaaf/StatCard";
import { etToday, groupByGameDay, dayBasis } from "@/lib/gameDays";
import { DayHeader } from "../../DayHeader";
import Tip from "../../Tip";

// MLB · Value Finder · Sweet Spots. The NFL page's shape — key numbers first, then the best
// prices, then the best props — with baseball's own key numbers. Football's are 3 and 7;
// baseball's are the ONE-RUN GAME (which decides whether a run line or a moneyline is the
// cheaper way to back a team, and depends on who is at home) and WHOLE-NUMBER TOTALS (a total on
// 7 pushes more often than an NFL spread lands on 3). Every number is measured; see lib/mlbBest.ts.
export const metadata = {
  title: "StatSeer — MLB Sweet Spots",
  description: "MLB key numbers and best prices — the one-run game, whole-number totals, run line vs moneyline, and the best price across books.",
};
export const revalidate = 120;
const TOP_N = 8;
const RL_MIN_GAP = 0.02;   // two points of probability before a run-line / moneyline gap is worth showing

function BookTag({ books }: { books: string[] }) {
  return books.length === 1
    ? <span className="book">{bookLabel(books[0])}</span>
    : <span className="book tie" title={books.map(bookLabel).join(", ")}>×{books.length} books</span>;
}

const pct = (p: number) => `${(p * 100).toFixed(0)}%`;

function RunLineCard({ r }: { r: RunLinePlay }) {
  const rlBetter = r.gap > 0;
  const venue = r.favHome ? "home" : "away";
  return (
    <article className="play play--key">
      <header className="play__head">
        <span className="play__game">{r.game}</span>
        <span className="badge">{rlBetter ? "RUN LINE" : "MONEYLINE"}</span>
        <span className="play__mkt">{r.fav}</span>
      </header>
      <div className="play__body">
        <div className="play__val"><b>{(Math.abs(r.gap) * 100).toFixed(1)}%</b><span>{rlBetter ? "run line pays over the moneyline" : "moneyline pays over the run line"}</span></div>
        <div className="play__sides">
          <div className="play__side">
            <span className="play__lbl">{r.fav} ML</span>
            <span className="play__price">{fmtOdds(r.ml.price)}</span>
            <BookTag books={r.ml.books} />
          </div>
          <div className="play__side">
            <span className="play__lbl">{r.fav} −1.5</span>
            <span className="play__price">{fmtOdds(r.rl.price)}</span>
            <BookTag books={r.rl.books} />
          </div>
        </div>
      </div>
      <p className="play__why">
        The moneyline makes {r.fav} a <b>{pct(r.ml.fair)}</b> favourite. A team covers −1.5 in{" "}
        <b>{pct(MLB_KEYS.coverGivenWin[venue])}</b> of its {venue === "home" ? "home" : "road"} wins, so
        the run line should be worth about <b>{pct(r.impliedCover)}</b> — the book prices it at{" "}
        <b>{pct(r.rl.fair)}</b>. {rlBetter
          ? <>Laying the run gets you more than the moneyline says it is giving up.</>
          : <>The moneyline is the cheaper way to back them; the run line charges more for the 1.5 than the one-run games cost.</>}
      </p>
    </article>
  );
}

function TotalKeyCard({ k }: { k: KeyPlay }) {
  return (
    <article className="play play--key">
      <header className="play__head">
        <span className="play__game">{k.game}</span>
        <span className="badge">SWEET SPOT</span>
        <span className="play__mkt">Total</span>
      </header>
      <div className="play__body">
        <div className="play__val"><b>{k.cost.toFixed(0)}%</b><span>land exactly on {k.num}</span></div>
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
        The total sits on <b>{k.num}</b>, a number games land on <b>{k.cost.toFixed(0)}%</b> of the time — so
        this bet pushes that often, and a book offering {k.num - 0.5} or {k.num + 0.5} instead is moving you
        across all of it. Shop the half-run before the price.
      </p>
    </article>
  );
}

export default async function Page() {
  const [{ plays, keys, runLines }, propPlays] = await Promise.all([
    fetchMlbBets().catch(() => ({ plays: [], keys: [], runLines: [], snapshot: null })),
    fetchMlbBestProps(TOP_N).catch(() => [] as MlbPropPlay[]),
  ]);
  const topPrices = plays.filter((p) => p.edge > 0.5).slice(0, TOP_N);
  const rlPlays = runLines.filter((r) => Math.abs(r.gap) >= RL_MIN_GAP).slice(0, TOP_N);
  const { today, tomorrow } = etToday();
  const K = MLB_KEYS;

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">MLB</span> · Sweet Spots</>}
          art={{ src: "/bag.png?v=1", alt: "Value Finder" }}
        />
      </header>

      <DayBadge pin={<PinButton size="sm" pin={{ id: "/mlb/best", kind: "sweetspots", label: "MLB · Sweet Spots", detail: "today's slate", href: "/mlb/best" }} />} />
      <FlowSteps active="value" base="mlb" />
      <div className="subnavrow"><ShopSubnav active="best" base="mlb" /></div>

      <details className="readbox">
        <summary className="readbox__h">What am I seeing here?</summary>
        <p>
          <b>Where the value is tonight.</b> These are <b>price edges we can prove</b> — the best available
          number across books, the games where a whole-number total makes the half-run worth shopping, and
          where a run line and a moneyline disagree about the same team. Same bet, better price. They are
          <b> not</b> outcome calls: for who we think wins, see <a href="/mlb/model">The Model</a>.
        </p>
      </details>

      <section className="ctxsec">
        <h2 className="ctxsec__h">Baseball&apos;s key numbers <Tip label="Where these numbers come from" text={<>
          <span className="tip__lead">Football has 3 and 7. Baseball has the <b>one-run game</b> and the <b>whole-number total</b>.</span><br /><br />Measured on <b>{K.games.toLocaleString()}</b> completed games this season. <b>{K.margin[0].pct}%</b> were
            decided by exactly one run, <b>{K.margin[1].pct}%</b> by two, <b>{K.margin[2].pct}%</b> by three.<br /><br />
            <b>The walk-off skews it.</b> A home team that scores in the ninth or later stops playing the moment it
            leads, so <b>{K.oneRunWins.home}%</b> of home wins are by exactly one run against <b>{K.oneRunWins.away}%</b>{" "}
            of road wins. That is why a team covers −1.5 in only <b>{pct(K.coverGivenWin.home)}</b> of its home
            wins and <b>{pct(K.coverGivenWin.away)}</b> of its road wins — and why the same run line is worth
            different amounts depending on who is batting last. The books agree: across 2,000 quotes, the
            ratio they price in is 0.68 at home and 0.77 on the road.<br /><br />
            <b>Totals</b> land exactly on 7 in <b>{K.total[7]}%</b> of games, on 9 in <b>{K.total[9]}%</b>, on 8 in{" "}
            <b>{K.total[8]}%</b> — the same order as an NFL spread landing on 3. A total sitting on one of those
            numbers pushes that often, so the half-run either side of it is the most valuable half-run on the board.
        </>} /></h2>
        <div className="ncf-cards">
          <StatCard tone="good" label="Decided by one run" value={`${K.margin[0].pct}%`}
            sub="of games — the run line's whole story. Every −1.5 gives these up; the price has to pay for them." />
          <StatCard label="Home wins by one run" value={`${K.oneRunWins.home}%`}
            sub={`of home wins, vs ${K.oneRunWins.away}% of road wins. The walk-off: a home favourite's run line is worth less than a road favourite's.`} />
          <StatCard tone="flat" label="Totals land on 7" value={`${K.total[7]}%`}
            sub={`of games — and ${K.total[9]}% on 9, ${K.total[8]}% on 8. A total sitting on one of these pushes that often.`} />
        </div>
      </section>

      {plays.length === 0 ? (
        <p className="foot">No odds captured for upcoming games yet — the board fills as the capture runs.</p>
      ) : (
        <>
          {rlPlays.length > 0 && (
            <section className="ctxsec">
              <h2 className="ctxsec__h">Run line or moneyline — which is cheaper <Tip label="How this is worked out" text={<>
                <span className="tip__lead">Two ways to back the same team. The moneyline says how good the team is; the run line adds a price for the one-run games. When the two disagree by two points or more, one of them is the better buy.</span><br /><br />Both prices are de-vigged first. The moneyline&apos;s fair win chance, multiplied by how often a
                  favourite in that venue covers −1.5 when it wins, is what the run line <i>should</i> be worth.
                  The card shows that against what the book actually charges. It is arithmetic on the market&apos;s
                  own numbers — no model, no prediction about the game.
              </>} /></h2>
              <div className="daygrid">
                {groupByGameDay(rlPlays, (r) => r.commence, today, tomorrow).map((grp) => (
                  <div className="daygrid__day" key={grp.key} style={dayBasis(grp.items.length, 3, 290, 14)}>
                    <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} noun="play" />
                    <div className="playgrid">{grp.items.map((r) => <RunLineCard key={r.eventId} r={r} />)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {keys.length > 0 && (
            <section className="ctxsec">
              <h2 className="ctxsec__h">Totals on a whole number <Tip label="Totals on a whole number" text={<>
                <span className="tip__lead">A total sitting on 7, 8 or 9 pushes far more often than one on a half — shop for the half-run first, then the price.</span>
              </>} /></h2>
              <div className="daygrid">
                {groupByGameDay(keys, (k) => k.commence, today, tomorrow).map((grp) => (
                  <div className="daygrid__day" key={grp.key} style={dayBasis(grp.items.length, 3, 290, 14)}>
                    <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} noun="play" />
                    <div className="playgrid">{grp.items.map((k) => <TotalKeyCard key={k.eventId} k={k} />)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}


          <section className="ctxsec">
            <h2 className="ctxsec__h">Best prices tonight <Tip label="What a shopping edge is" text={<>
              <span className="tip__lead"><b>Tap any row to add it to your slip</b> — StatSeer lines up the single best book for each leg and totals your ticket at the bottom of the screen. The biggest <b>shopping edges</b> — how far the best book&apos;s price beats the market average.</span><br /><br />Placing at the named book captures the difference. It is the same wager everyone else makes,
                at a worse number — no prediction involved, which is why this is the part of the app that
                does not depend on a model being right.
            </>} /></h2>
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
                      item={{ id: `mlbbest-${p.eventId}:${p.market}:${p.label}`, kind: "line",
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
              <h2 className="ctxsec__h">Best props tonight <Tip label="Best props tonight" text={<>
                <span className="tip__lead">Player props where <b>one book is priced well above the field</b> — the same prop at a better number. Shopping edge is the de-vigged gap vs. the other books.</span>
              </>} /></h2>
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
                        item={{ id: `mlbbestprop-${p.eventId}:${p.market}:${p.player}:${p.label}`, kind: "prop",
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
          <b>Line shopping, not tips.</b> Every number here is the best available price or a measured key
          number, updated as new odds are captured. Bet sizing and whether to bet at all are
          yours — we just make sure you never leave value on the table.
        </p>
      </footer>
    </main>
  );
}
