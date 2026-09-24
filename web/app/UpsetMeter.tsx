import type { UpsetRead } from "@/lib/upsetMeter";

// The Upset Meter, rendered at the top of each game's Special Considerations block.
//
// One number, its tier, and every driver that produced it — the drivers are the point, not
// decoration. A reader who disagrees with the reading can see exactly which factor carried it, and
// the two components that are NOT predictive claims (chaos, and the context factors) say so on
// the card rather than only in the code.

const TIER_WORD: Record<UpsetRead["tier"], string> = {
  high: "Live upset spot", notable: "Worth a look", low: "Chalk holds up",
};

export function UpsetMeter({ read }: { read: UpsetRead }) {
  if (!read.drivers.length) return null;
  return (
    <div className={`upmeter upmeter--${read.tier}`}>
      <div className="upmeter__head">
        <span className="upmeter__k">Upset meter</span>
        <span className="upmeter__score">{read.score}</span>
        <span className="upmeter__tier">{TIER_WORD[read.tier]}</span>
      </div>
      <div className="upmeter__bar" aria-hidden="true">
        <span className="upmeter__fill" style={{ width: `${read.score}%` }} />
      </div>
      <p className="upmeter__say">{read.headline}</p>
      <ul className="upmeter__drivers">
        {read.drivers.map((d) => (
          <li key={d.key} className={`upmeter__d upmeter__d--${d.key}`} title={d.note}>
            <span className="upmeter__dl">{d.label}</span>
            <span className="upmeter__dbar" aria-hidden="true">
              <span className="upmeter__dfill" style={{ width: `${d.score}%` }} />
            </span>
            <span className="upmeter__dv">{Math.round(d.score)}</span>
          </li>
        ))}
      </ul>
      <p className="upmeter__foot">
        Weighted toward <b>our line-blind model</b>, the only part with a graded track record;
        scoring, weather and referee are context, and chaos is deliberately non-predictive.
        Not a pick.
      </p>
    </div>
  );
}
