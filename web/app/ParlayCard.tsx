// Parlay of the Week — laid out like a sportsbook betslip, because that is the thing a reader is
// comparing it against. Derek: "I want the parlay of the week to look more like a betslip from
// fanduel. Also create at least 2 parlays of the week at +500 odds."
//
// A slip reads top-to-bottom as SELECTION / market / matchup, with the price hard right and a
// total at the foot. That shape is doing work: it is the layout a member already knows how to
// scan, so the numbers that matter (which side, what price) land without a legend.
//
// Two house rules still hold over the borrowed shape:
//   * NO COPY ON THE BOARD. Every sentence lives in the <Tip> scroll, including the legend line.
//   * COLOUR BY WHOSE CLAIM IT IS — our probability is --model blue, the de-vigged market number
//     --mkt maroon, the book price green. The reader learns the key once.
//
// And the number that keeps it honest is the pair at the foot: our combined chance NEXT TO what
// the price implies you must hit. A payout with no probability beside it is a pick sheet.
import Tip from "./Tip";
import { fmtOdds, bookName } from "@/lib/slipPricing";
import { independenceCaveat, type Parlay } from "@/lib/parlayOfWeek";

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

export interface ParlayRecord { tickets: number; hit: number }

function Slip({
  parlay, index, total, abbrev,
}: { parlay: Parlay; index: number; total: number; abbrev?: (t: string) => string }) {
  const short = (s: string) => (abbrev ? abbrev(s) : s);
  const { legs, ourProb, american, breakEven, marketProb, bestBook, belowTarget } = parlay;
  return (
    <article className="slip">
      <div className="slip__top">
        <span className="slip__n">
          {total > 1 ? `Parlay ${index + 1} of ${total}` : "Parlay"} · {legs.length} legs
        </span>
        <b className="slip__odds">{american}</b>
      </div>

      <ol className="slip__legs">
        {legs.map((l) => (
          <li key={l.eventId} className="slip__leg">
            <span className="slip__pick">{short(l.pick)}</span>
            <span className="slip__price">{fmtOdds(l.price)}</span>
            <span className="slip__mkt">Moneyline</span>
            <span className="slip__book">{l.books.slice(0, 2).map(bookName).join(" / ")}</span>
            <span className="slip__match">{short(l.away)} @ {short(l.home)}</span>
            <span className="slip__probs">
              <i className="slip__ours">we rate {pct(l.ourProb)}</i>
              {l.marketProb !== null ? <i className="slip__market">market {pct(l.marketProb)}</i> : null}
            </span>
          </li>
        ))}
      </ol>

      <div className="slip__foot">
        {/* Three numbers, no verdict. An earlier version badged (ours − break-even) in green and
            read "+11.3pt" on the live slate — an edge claim the graded record contradicts. */}
        <span className="slip__sum">
          <b className="slip__ours">we rate {pct(ourProb)}</b>
          {marketProb !== null ? <><span className="slip__dot">·</span><b className="slip__market">market {pct(marketProb)}</b></> : null}
          <span className="slip__dot">·</span>
          <span className="slip__be">pays {pct(breakEven)}</span>
        </span>
        {bestBook ? (
          <span className="slip__bb">Best single book: <b>{bookName(bestBook.book)}</b> {bestBook.american}</span>
        ) : null}
        {belowTarget ? <em className="slip__short">best available — short of +500</em> : null}
      </div>
    </article>
  );
}

export default function ParlayCard({
  parlays, sportLabel, record, graded, abbrev,
}: {
  /** One or more tickets with no game shared between them — see pickParlays. */
  parlays: Parlay[];
  sportLabel: string;
  record?: ParlayRecord | null;
  graded?: string;
  /** Shorten team names for display; NCAAF's feed names are long enough to wrap a cell. */
  abbrev?: (team: string) => string;
}) {
  const live = (parlays ?? []).filter((p) => p && p.legs.length);
  if (!live.length) return null;

  return (
    <section className="pw" aria-label={`${sportLabel} parlay of the week`}>
      <div className="pw__bar">
        <h2 className="pw__h">
          {live.length > 1 ? "Parlays of the Week" : "Parlay of the Week"}
          <Tip
            text={
              <>
                <span className="tip__lead">
                  Our most confident calls this week, priced as {live.length > 1 ? "two tickets" : "one ticket"}.
                </span>
                <br /><br />
                Legs are chosen by <b>our own published win probability</b> — the number locked
                before kickoff and graded on the report card — never by how far we disagree with
                the market. We take the most confident combination that still pays +500 or better.
                {live.length > 1 ? (
                  <> The second ticket <b>shares no game</b> with the first: two slips built from
                  the same game would be one bet sold twice, concentrated rather than spread.</>
                ) : null}
                <br /><br />
                <b>&ldquo;We rate&rdquo;</b> is our chance for that side. <b>&ldquo;Market&rdquo;</b>{" "}
                is the same side&rsquo;s de-vigged fair price across the US books we track.{" "}
                <b>&ldquo;Pays&rdquo;</b> is what the ticket&rsquo;s price implies you must hit to
                break even.
                <br /><br />
                A parlay multiplies the vig on every leg, so it is the hardest ticket on the board
                to beat — that is why the percentages are printed together rather than just the
                payout. {independenceCaveat}
                <br /><br />
                <b>Where we and the market disagree, read the market first.</b> Our win
                probabilities are graded every week and they are the less accurate of the two: in
                Week 9 our Brier score was 0.1488 against the market&rsquo;s 0.1115. So our number
                sitting above the market&rsquo;s is evidence that we are confident, not evidence
                that the price is wrong — and because these legs are picked by our own confidence,
                they are exactly the games where that gap is widest.
                {graded ? <> Every ticket is published before kickoff and graded at {graded}.</> : null}
              </>
            }
          />
        </h2>
        <span className="pw__rec">
          {record && record.tickets > 0
            ? <>Record: <b>{record.hit}-{record.tickets - record.hit}</b> ({record.tickets} graded)</>
            : <>Record: first graded ticket pending</>}
        </span>
      </div>

      <div className="pw__slips">
        {live.map((p, i) => (
          <Slip key={p.legs.map((l) => l.eventId).join("|")} parlay={p} index={i} total={live.length} abbrev={abbrev} />
        ))}
      </div>
    </section>
  );
}
