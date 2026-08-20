import { NCAAF_MODEL, type NcaafCardGame, type NcaafUpset } from "./model-data";

// College Football home — mirrors the NFL homepage broadsheet: The Card (model vs
// market), Potential Upsets, Players We Like, promo, and the 3-section nav. The Card
// pairs the market line with our LINE-BLIND projection — context, not a pick (our
// rating predicts well but doesn't beat the spread; see /ncaaf/model).
export const metadata = {
  title: "StatSeer — College Football",
  description: "College football: our power-rating read beside the market on every marquee game, plus potential upsets — with the honest track record.",
};

const M = NCAAF_MODEL;

function CardRows({ games }: { games: readonly NcaafCardGame[] }) {
  return (
    <>
      {games.map((g) => {
        const ms = g.marketSpread; const ps = g.projSpread; const tl = g.totalLean; const pk = g.pick;
        const pickTxt = pk ? `${pk.side} ${pk.num > 0 ? "+" : ""}${pk.num}` : `${ps.fav} ${ps.num}`;
        return (
          <tr key={`${g.away}-${g.home}`} className={g.off ? "hb-off" : undefined}>
            <td className="hb-l">
              <span className="hb-game">{g.away}<span className="hb-at">at</span>{g.home}</span>
              {g.neutral ? <span className="ncf-site"> · N</span> : null}
              {g.off && <span className="hb-dia hb-dia--end" aria-label="off consensus">◆</span>}
            </td>
            <td className="hb-num">{ms ? `${ms.fav} ${ms.num}` : "—"}</td>
            <td className="hb-num hb-tot">{g.marketTotal ?? "—"}</td>
            <td className="hb-suggest">
              <span className="hb-sugwrap">
                <span className="hb-sug"><span className="hb-sug__t">{pickTxt}</span></span>
                {tl && (
                  <span className="hb-sug">
                    <span className="hb-sug__t">{tl.dir === "OVER" ? "Over" : "Under"} {tl.num}</span>
                  </span>
                )}
              </span>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function CardHead() {
  return (
    <thead>
      <tr>
        <th className="hb-l">Game</th><th>Market Spread</th><th>Market O/U</th>
        <th>Our Model Suggests</th>
      </tr>
    </thead>
  );
}

function TheCard({ games }: { games: readonly NcaafCardGame[] }) {
  // Lead with games that involve a top-25 team; tuck the rest of the slate behind a
  // "see all" dropdown so the homepage isn't a 50-row wall.
  const featured = games.filter((g) => g.featured);
  const rest = games.filter((g) => !g.featured);
  const lead = featured.length ? featured : games;   // fall back if nothing is ranked
  const extra = featured.length ? rest : [];
  return (
    <details className="hb-panel hb-panel--card" open>
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">The Card — model vs market</span>
        <span className="hb-bar__count">{games.length} games</span>
        <span className="hb-bar__hint">our line-blind projection beside the market&apos;s number</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        <div className="hb-legend">
          <span className="hb-dia">◆</span> Off-consensus — our model and the market disagree on who&apos;s favored.
          <span className="hb-x"> · <b>Our Model Suggests</b> is the side of the market spread our line-blind read
            would take — informative, <b>not a guaranteed bet</b> (our rating doesn&apos;t beat the spread; see{" "}
            <a href="/ncaaf/model">The Model</a>).</span>
        </div>
        <div className="hb-formcap">Ranked matchups — every game with a top-25 team</div>
        <div className="hb-formwrap">
          <table className="hb-form">
            <CardHead />
            <tbody><CardRows games={lead} /></tbody>
          </table>
        </div>
        {extra.length > 0 && (
          <details className="hb-more">
            <summary className="hb-more__sum">
              <span className="hb-more__chev" aria-hidden="true">▸</span>
              See all {extra.length} other games
            </summary>
            <div className="hb-formwrap">
              <table className="hb-form">
                <CardHead />
                <tbody><CardRows games={extra} /></tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </details>
  );
}

function Upsets({ rows }: { rows: readonly NcaafUpset[] }) {
  return (
    <details className="hb-panel hb-panel--alert">
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">Potential Upsets of the Week</span>
        <span className="hb-bar__count hb-bar__count--gold">{rows.length}</span>
        <span className="hb-bar__hint">the market has them losing — our model says they win</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      {rows.length === 0 ? (
        <div className="hb-body">
          <p className="hb-empty">
            No upset alerts this week — our model and the market agree on every game&apos;s side. They fire when a
            competitive line and our read diverge; check back as the week&apos;s lines move.
          </p>
        </div>
      ) : (
        <div className="hb-cols">
          {rows.map((u) => (
            <div className="hb-up" key={`${u.dog}-${u.matchup}`}>
              <div className="hb-up__hd">
                <span className="hb-up__team">{u.dog}<small>{u.matchup}</small></span>
                <span className="hb-up__spread">{u.spread}</span>
              </div>
              <div className="hb-up__note">
                The market has the {u.dog} losing. Our model has them <b>winning</b> by {u.byPoints.toFixed(1)}.
              </div>
              <div className="hb-cap">Chance to win the game</div>
              <div className="hb-prob hb-prob--m">
                <div className="hb-prob__t"><span>Our model says</span><span className="hb-prob__v">{u.modelPct}%</span></div>
                <div className="hb-prob__tr"><span style={{ width: `${u.modelPct}%` }} /></div>
              </div>
              <div className="hb-prob hb-prob--k">
                <div className="hb-prob__t"><span>The market says</span><span className="hb-prob__v">{u.marketPct}%</span></div>
                <div className="hb-prob__tr"><span style={{ width: `${u.marketPct}%` }} /></div>
              </div>
              <div className="hb-up__ft">
                <span className="hb-up__edge">Model likes them +{u.modelPct - u.marketPct}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

function PlayersWeLike() {
  return (
    <details className="hb-panel">
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">Players We Like</span>
        <span className="hb-bar__count hb-bar__count--gold">—</span>
        <span className="hb-bar__hint">arriving with the season</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        <p className="hb-empty">
          Players the college boards are buzzing on land here once the CFB fan scan is wired — the same read we run
          for the NFL on <a href="/tailgate">Fan Analysis</a>. Nothing gathered yet.
        </p>
      </div>
    </details>
  );
}

export default function Home() {
  const c = M.card;
  return (
    <main className="hb">
      <div className="hb-main">
      <header className="hb-mast">
        <div className="hb-mast__eyes">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/seereyes.png" alt="" width={1983} height={793} />
        </div>
        <div className="hb-mast__rule"></div>
      </header>

      <div className="hb-weeklabel">NCAAF Week {c.week} · {c.season}</div>

      {/* Section links up top so the three tools stay connected to the board below. */}
      <section className="hb-nav3 hb-nav3--top">
        <div className="hb-nav3__grid">
          <a href="/ncaaf/model" className="hb-nav3__c">
            <span className="hb-nav3__k">The Model</span>
            <span className="hb-nav3__d">The power rating in full — top-25, methodology, and the honest track record.</span>
            <span className="hb-nav3__go">Open The Model →</span>
          </a>
          <a href="/ncaaf/context" className="hb-nav3__c">
            <span className="hb-nav3__k">Context</span>
            <span className="hb-nav3__d">Upset Watch, home field and conference strength — the measured backdrop.</span>
            <span className="hb-nav3__go">Read the Context →</span>
          </a>
          <a href="/ncaaf/lines" className="hb-nav3__c">
            <span className="hb-nav3__k">Value Finder</span>
            <span className="hb-nav3__d">Where the price is wrong — key numbers, line shopping, and the game-lines board.</span>
            <span className="hb-nav3__go">Find the best price →</span>
          </a>
        </div>
      </section>

      <TheCard games={c.games} />
      <Upsets rows={c.upsets} />
      <PlayersWeLike />
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
