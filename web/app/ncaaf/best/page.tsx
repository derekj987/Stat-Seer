import { Brand, FlowSteps, ShopSubnav } from "../../Nav";
import { NCAAF_MODEL, type NcaafKeyNum } from "../model-data";
import { StatCard } from "../StatCard";

// College Football — Value Finder · Sweet Spots. Key numbers: which final margins
// actually happen, so a half-point across one is worth buying. Real, from 5 seasons.
export const metadata = {
  title: "StatSeer — CFB Sweet Spots",
  description: "College-football key numbers — which margins happen, so you know when a half-point is worth buying.",
};

const M = NCAAF_MODEL;

export default function Page() {
  const v = M.value;
  const three = v.keyNumbers[0];

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`Value Finder · College Football · Sweet Spots · key numbers`} />
      </header>

      <FlowSteps active="value" base="ncaaf" />
      <ShopSubnav active="best" base="ncaaf" />

      <section className="explainer">
        <p>
          <b>Key numbers — where CFB margins land.</b> Some final margins happen far more than others, so a
          half-point across one is worth paying for and a half-point away from one is worth selling. Measured
          from {v.games.toLocaleString()} FBS games, with the NFL alongside for contrast.
        </p>
      </section>

      <div className="ncf-cards">
        <StatCard label="Top margin: 3" value={`${three.pct}%`}
          sub={`of games land exactly on 3 — still the most common CFB margin, but under the NFL's ${three.nfl}%.`} />
        <StatCard label="Second: 7" value={`${v.keyNumbers[1].pct}%`}
          sub={`land on 7 — right in line with the NFL's ${v.keyNumbers[1].nfl}%. The other classic key number.`} />
        <StatCard tone="flat" label="Softer than the NFL" value="less peaked"
          sub="college scores more and blows out more, so margins spread out — key-number value is real but smaller." />
      </div>

      <section className="ncf-sec">
        <h2 className="ncf-h">Share of games decided by exactly…
          <span className="ncf-h__note">CFB vs NFL</span></h2>
        <div className="ncf-key">
          {v.keyNumbers.map((k: NcaafKeyNum) => (
            <div className="ncf-keyrow" key={k.margin}>
              <span className="ncf-keyrow__m">by {k.margin}</span>
              <span className="ncf-keyrow__track" aria-hidden="true">
                <span className="ncf-keyrow__fill" style={{ width: `${Math.min(100, k.pct * 6)}%` }} />
              </span>
              <span className="ncf-keyrow__p">{k.pct}%</span>
              <span className="ncf-keyrow__nfl">NFL {k.nfl}%</span>
            </div>
          ))}
        </div>
        <p className="ncf-note">
          <b>3 and 7 are still the numbers</b> — a spread of 3 or 7 is worth more than the ones on either side —
          but a half-point across 3 buys ~{three.pct}% of outcomes in college vs ~{three.nfl}% in the NFL. Pay up
          for key numbers, just don&apos;t overpay.
        </p>
      </section>

      <footer className="foot">
        <p>
          <b>Same bet, better number.</b> Line shopping is on <a href="/ncaaf/lines">Game Lines</a>; the line-blind
          read is <a href="/ncaaf">The Model</a>.
        </p>
      </footer>
    </main>
  );
}
