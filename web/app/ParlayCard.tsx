// Parlay of the Week — the attention-grabber at the top of a sport page.
//
// Two rules from the house style hold here even though this is a headline card:
//   * NO COPY ON THE BOARD. Every sentence lives in the <Tip> scroll, including the legend line.
//     A wall of caveat above a card is worse for honesty than one line plus a click, because
//     unread caveats protect nobody.
//   * COLOUR BY WHOSE CLAIM IT IS. Our probability is --model blue; the de-vigged market number
//     beside it is --mkt maroon; the book price is green. The reader learns the key once.
//
// And the number that makes it defensible is the pair "we rate X%" / "pays Y%" sitting together.
// A payout with no probability next to it is a pick sheet; the two side by side is a measurement.
import Tip from "./Tip";
import { fmtOdds, bookName } from "@/lib/slipPricing";
import { independenceCaveat, type Parlay } from "@/lib/parlayOfWeek";

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

export interface ParlayRecord { tickets: number; hit: number }

export default function ParlayCard({
  parlay, sportLabel, record, graded, abbrev,
}: {
  parlay: Parlay | null;
  sportLabel: string;
  /** Shorten team names for display. NCAAF's feed names are long enough to wrap the matchup cell
   *  and leave the rows ragged; the fix is shorter CONTENT, not an ellipsis. */
  abbrev?: (team: string) => string;
  /** Graded history. Omit until at least one ticket has been settled. */
  record?: ParlayRecord | null;
  /** Where the track record is published. */
  graded?: string;
}) {
  const short = (s: string) => (abbrev ? abbrev(s) : s);
  if (!parlay || parlay.legs.length === 0) return null;
  const { legs, ourProb, american, breakEven, marketProb, bestBook, belowTarget } = parlay;

  return (
    <section className="pw" aria-label={`${sportLabel} parlay of the week`}>
      <div className="pw__bar">
        <h2 className="pw__h">
          Parlay of the Week
          <Tip
            text={
              <>
                <span className="tip__lead">
                  Our {legs.length} most confident calls this week, priced as one ticket.
                </span>
                <br /><br />
                Legs are chosen by <b>our own published win probability</b> — the number locked
                before kickoff and graded on the report card — never by how far we disagree with
                the market. We pick the most confident combination that still pays +500 or better,
                which is why the legs are solid favourites rather than longshots.
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
        <div className="pw__price">
          <b className="pw__odds">{american}</b>
          {belowTarget ? <em className="pw__short">best available — short of +500 this week</em> : null}
        </div>
      </div>

      <ol className="pw__legs">
        {legs.map((l) => (
          <li key={l.eventId} className="pw__leg">
            <span className="pw__pick">{short(l.pick)}</span>
            <span className="pw__match">{short(l.away)} @ {short(l.home)}</span>
            <span className="pw__ours">we rate {pct(l.ourProb)}</span>
            <span className="pw__mkt">
              {l.marketProb === null ? "—" : `market ${pct(l.marketProb)}`}
            </span>
            <span className="pw__book">
              {fmtOdds(l.price)} <i>{l.books.slice(0, 2).map(bookName).join(" / ")}</i>
            </span>
          </li>
        ))}
      </ol>

      <div className="pw__foot">
        {/* 🚨 THREE NUMBERS, NO VERDICT. This row used to badge (ours - breakEven) in green, which
            on the live slate read "+11.3pt" and asserted an edge the track record contradicts:
            our week-9 Brier was 0.1488 against the market's 0.1115, so where we disagree with the
            market the market has been the better forecaster. Our number, the market's number and
            the break-even sit side by side and the reader draws the conclusion. */}
        <span className="pw__combined">
          Combined: <b className="pw__ours">we rate {pct(ourProb)}</b>
          {marketProb !== null ? <>{" · "}<b className="pw__mkt">market {pct(marketProb)}</b></> : null}
          {" · "}
          <span className="pw__be">pays {pct(breakEven)}</span>
        </span>
        {bestBook ? (
          <span className="pw__bb">
            Best single book: <b>{bookName(bestBook.book)}</b> {bestBook.american}
          </span>
        ) : null}
        {record && record.tickets > 0 ? (
          <span className="pw__rec">
            Record: <b>{record.hit}-{record.tickets - record.hit}</b> ({record.tickets} graded)
          </span>
        ) : (
          <span className="pw__rec pw__rec--none">Record: first graded ticket pending</span>
        )}
      </div>
    </section>
  );
}
