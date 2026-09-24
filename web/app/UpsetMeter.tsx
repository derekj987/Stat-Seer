import type { UpsetRead } from "@/lib/upsetMeter";
import Tip from "@/app/Tip";

// The Upset Meter, under each game's Special Considerations factors — it reads them, so it sits
// beneath them.
//
// One number, its tier, and every driver that produced it. The drivers are the point, not
// decoration: a reader who disagrees can see which factor carried the reading. What each number
// MEANS lives in the scroll beside the heading — Derek: "We need to explain what the numbers mean
// in the Upset Meter in an informational scroll. For example, I do not know what 'Scoring 22'
// means." No copy on the board; the explanation is one click away, which is the house pattern.

// Plain words, not betting slang. "Chalk holds up" means nothing to a reader who does not
// already know that chalk is the favourite — Derek: "What does chalk holds up mean? That needs to
// be different." Each of these says what the number is telling you.
const TIER_WORD: Record<UpsetRead["tier"], string> = {
  high: "Upset in play", notable: "Some upset risk", low: "Favourite should hold",
};

export function UpsetMeter({ read }: { read: UpsetRead }) {
  if (!read.drivers.length) return null;
  return (
    <>
      {/* The heading is a SECTION header now, outside the box and matching "Market vs model
          breakdown" and "Special considerations" — Derek: "take the Upset Meter text out of the
          upset meter section and make that a header as well. Make all the headers uniform."
          The scroll rides on the header, where its bubble has the block's full width. */}
      <h4 className="impsec">Upset meter
        <Tip label="Upset meter" text={<>
          <span className="tip__lead">How upset-prone this game looks, 0-100 — and every number
          behind it. It is context, not a pick, and nothing here feeds The Model or the
          Value Finder.</span><br /><br />
          <b>The headline number</b> is a weighted blend of the drivers below. Above <b>62</b> reads
          as a live upset spot, <b>48-61</b> worth a look, under 48 chalk. A driver a game does not
          have (no forecast, no crew yet) drops out and the rest re-weight, so the scale always
          runs 0-100.<br /><br />
          <b>Each driver is 0-100 too, where 50 is a neutral game.</b> Higher means that factor
          argues MORE for an upset. So &quot;Scoring 22&quot; means the underdog&apos;s offence and the
          favourite&apos;s defence, measured in points per game this season, point well AWAY from an
          upset — the dog does not score much and the favourite does not concede much. &quot;Scoring
          78&quot; would be the reverse.<br /><br />
          <b>Our model (weight 40)</b> — our line-blind projected margin against the market&apos;s
          number. 40 means we agree with the market; it climbs as our number leans toward the
          underdog and tops out when we project the dog to win outright. This is the only driver
          with a graded, published track record, which is why it carries the most.<br /><br />
          <b>Scoring (18)</b> — the dog&apos;s points scored and the favourite&apos;s points allowed,
          each against the league rate.<br /><br />
          <b>Chaos (16)</b> — the old Upset Lab index: how volatile the favourite has been and how
          high the dog&apos;s ceiling is, over the last two seasons, plus the dog&apos;s payout.
          Deliberately <b>non-predictive</b> — it is flavour, and it carries little weight.<br /><br />
          <b>Weather (14)</b> — wind. Above ~15 mph it measurably shrinks the passing game, which
          compresses a favourite&apos;s edge.<br /><br />
          <b>Referee (12)</b> — the crew&apos;s penalty rate against the league&apos;s, which is the
          one crew tendency measured to persist year to year, plus two HISTORICAL readings at half
          weight: how often the favourite covered in his games, and how often they went over.
          Those two are history, not a carried-over tendency, and are weighted accordingly.
        </>} />
      </h4>
      <div className={`upmeter upmeter--${read.tier}`}>
      <div className="upmeter__head">
        <span className="upmeter__score">{read.score}</span>
        <span className="upmeter__tier">{TIER_WORD[read.tier]}</span>
      </div>
      <div className="upmeter__bar" aria-hidden="true">
        <span className="upmeter__fill" style={{ width: `${read.score}%` }} />
      </div>
      <p className="upmeter__say">{read.headline}</p>
      <ul className="upmeter__drivers">
        {read.drivers.map((d) => (
          <li key={d.key} className={`upmeter__d upmeter__d--${d.key}`} title={`${d.label}: ${d.note}`}>
            <span className="upmeter__dl">{d.label}</span>
            <span className="upmeter__dbar" aria-hidden="true">
              <span className="upmeter__dfill" style={{ width: `${d.score}%` }} />
            </span>
            <span className="upmeter__dv">{Math.round(d.score)}</span>
          </li>
        ))}
      </ul>
      </div>
    </>
  );
}
