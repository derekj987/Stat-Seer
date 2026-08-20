import { NCAAF_MODEL, type NcaafCardGame } from "./model-data";
import SportStrip from "../SportStrip";
import HomePromo from "../HomePromo";

// College Football home — mirrors the NFL homepage broadsheet. The Card is our
// LINE-BLIND read: the power rating's projected margin for the week's marquee games,
// before any market. Not a pick (the rating doesn't beat the spread — see The Model).
export const metadata = {
  title: "StatSeer — College Football",
  description: "College football read line-blind — our power-rating projection for the week's marquee games, plus the honest track record.",
};

const M = NCAAF_MODEL;

function TheCard({ games }: { games: readonly NcaafCardGame[] }) {
  return (
    <details className="hb-panel hb-panel--card" open>
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">The Card — our line-blind read</span>
        <span className="hb-bar__count">{games.length} games</span>
        <span className="hb-bar__hint">the power rating&apos;s projected margin, before the market</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        <div className="hb-legend">
          <b>Line-blind.</b> Our projection from the power rating alone — no betting line involved. A read to
          understand the week&apos;s biggest games, <b>not a pick</b> (the model doesn&apos;t beat the spread —
          see <a href="/ncaaf/model">The Model</a>). Marquee matchups first.
        </div>
        <div className="hb-formwrap">
          <table className="hb-form">
            <thead>
              <tr><th className="hb-l">Game</th><th className="ncf-projh">Our projection</th></tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={`${g.away}-${g.home}`}>
                  <td className="hb-l">
                    <span className="hb-game">{g.away}<span className="hb-at">at</span>{g.home}</span>
                    {g.neutral ? <span className="ncf-site"> · neutral</span> : null}
                  </td>
                  <td className="ncf-proj"><b>{g.fav}</b> by {g.margin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

export default function Home() {
  return (
    <main className="hb">
      <div className="hb-main">
      <header className="hb-mast">
        <div className="hb-mast__eyes">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/seereyes.png" alt="" width={1983} height={793} />
        </div>
        <div className="hb-mast__row">
          <span className="hb-mast__tag">College football — every game, read line-blind.</span>
          <span className="hb-mast__crest" role="img" aria-label="StatSeer crest" />
        </div>
        <div className="hb-mast__rule"></div>
      </header>

      <SportStrip />

      <div className="hb-weeklabel">NCAAF Week {M.card.week} · {M.card.season}</div>
      <TheCard games={M.card.games} />

      <HomePromo />

      <section className="hb-nav3">
        <h2 className="hb-nav3__h">There&apos;s a lot more inside</h2>
        <p className="hb-nav3__sub">
          The rating above reads the games; the rest of the section keeps us honest and finds you the
          <b> best price</b>. Here&apos;s where each lives:
        </p>
        <div className="hb-nav3__grid">
          <a href="/ncaaf/model" className="hb-nav3__c">
            <span className="hb-nav3__k">The Model</span>
            <span className="hb-nav3__d">The power rating in full — top-25, the methodology, and the honest track record (it predicts as well as Elo, and we show that it doesn&apos;t beat the spread).</span>
            <span className="hb-nav3__go">Open The Model →</span>
          </a>
          <a href="/ncaaf/context" className="hb-nav3__c">
            <span className="hb-nav3__k">Context</span>
            <span className="hb-nav3__d">The measured backdrop — home field and conference strength — plus Upset Watch and Fan Analysis as the season&apos;s data flows.</span>
            <span className="hb-nav3__go">Read the Context →</span>
          </a>
          <a href="/ncaaf/lines" className="hb-nav3__c">
            <span className="hb-nav3__k">Value Finder</span>
            <span className="hb-nav3__d">Where the price is wrong — key numbers and line shopping now, live boards and props as the odds capture fills in.</span>
            <span className="hb-nav3__go">Find the best price →</span>
          </a>
        </div>
      </section>
      </div>

      <section className="hb-creed">
        <div className="hb-creed__h">Read the game. <b>Trust the numbers.</b></div>
        <p className="hb-creed__p">
          Our college model reads every game line-blind and proves itself in the open — including where it falls
          short. <a href="/ncaaf/model">See the full model →</a> · <a href="/how">How our model works →</a>
        </p>
      </section>

      <div className="hb-side" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-hero.png?v=3" alt="" className="hb-seerimg" width={543} height={724} />
      </div>
    </main>
  );
}
