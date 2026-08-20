import { Brand, FlowSteps, SportTabs } from "../../Nav";
import { NCAAF_MODEL, type NcaafKeyNum } from "../model-data";
import { StatCard } from "../StatCard";

// College Football — Value Finder. Where the price is wrong: key numbers (which
// margins actually happen, so a half-point is worth buying) and line shopping (books
// disagree, so the best book is worth real points). Live shopping + props go live
// once the odds capture deploys.
export const metadata = {
  title: "StatSeer — College Football Value Finder",
  description: "Where the college-football price is wrong: key numbers and line shopping, from five seasons of games and lines.",
};

const M = NCAAF_MODEL;

export default function Page() {
  const v = M.value;
  const three = v.keyNumbers[0];
  const bs = v.bookShop;

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`Value Finder · College Football · where the price is wrong · ${M.season}`} />
      </header>

      <FlowSteps active="value" base="ncaaf" />
      <SportTabs active="ncaaf" />

      <section className="explainer">
        <p>
          <b>Where&apos;s the price wrong?</b> This is the arithmetic section — no model needed. Two levers move
          real money in college football: <b>key numbers</b> (some final margins happen far more than others, so a
          half-point across one is worth buying) and <b>line shopping</b> (books post different numbers, so the
          right book is free value). Both are measured below from {v.games.toLocaleString()} games.
        </p>
      </section>

      <div className="ncf-cards">
        <StatCard tone="good" label="Best book is worth it" value={`${bs.pctGap1}%`}
          sub={`of games, sportsbooks disagree by a point or more (avg ${bs.avgRange}-pt spread across books). Shopping the number is free value.`} />
        <StatCard label="Top margin: 3" value={`${three.pct}%`}
          sub={`of games land exactly on 3 — still the most common CFB margin, but well under the NFL's ${three.nfl}%.`} />
        <StatCard tone="flat" label="Key numbers, softer" value="less peaked"
          sub="college scores more and blows out more, so margins spread out — key-number value is real but smaller than the NFL." />
      </div>

      <section className="ncf-sec">
        <h2 className="ncf-h">Key numbers — where CFB margins land
          <span className="ncf-h__note">share of games decided by exactly this margin, vs the NFL</span></h2>
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
          The takeaway: <b>3 and 7 are still the numbers</b> — a spread of 3 or 7 is worth more than the ones on
          either side of it — but a half-point across 3 buys you ~{three.pct}% of outcomes in college vs
          ~{three.nfl}% in the NFL. Pay up for key numbers, just don&apos;t overpay.
        </p>
      </section>

      <div className="ncf-honest" role="note">
        <span className="ncf-honest__tag">Going live</span>
        <p>
          Live line shopping across every book, player props, and per-game sweet spots turn on as the odds capture
          fills in — the prop pipeline is already running daily ahead of the openers. Until then, the two edges
          above are the durable ones, and they don&apos;t need a model — just the right number at the right book.
        </p>
      </div>

      <footer className="foot">
        <p>
          <b>Same bet, better number.</b> For the line-blind read see <a href="/ncaaf">The Model</a>; for the
          context around a game, <a href="/ncaaf/context">Context</a>.
        </p>
      </footer>
    </main>
  );
}
