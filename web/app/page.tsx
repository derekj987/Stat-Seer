// Landing hub — the multi-sport front door. A snapshot of the whole app: the
// Model-vs-Market Card as the headliner (NFL + NCAAF together), sport tiles into each
// section, a plain-English tour of what the app does, and the community + bet-slip
// invitations. Individual sports live at /nfl, /ncaaf, … and link back up here.
import { fetchHome, type CardRow } from "@/lib/home";
import { NCAAF_MODEL, type NcaafCardGame } from "./ncaaf/model-data";
import { SPORTS } from "./Nav";
import HomePromo from "./HomePromo";

export const revalidate = 120;
export const metadata = {
  title: "StatSeer — the model vs the market, every sport",
  description: "One line-blind model read beside the market on every game — NFL and College Football now, more coming. Published probabilities, an honest track record, the best price on every pick.",
};

const SEASON = 2026;
const numStr = (v: number | null) => (v === null ? "—" : String(v));

// A single normalized headliner row, from either sport's own data shape.
type Head = {
  sport: string; href: string; away: string; home: string;
  spread: string; total: string; suggest: string[]; off: boolean;
};

function fromNFL(r: CardRow): Head {
  const suggest = [
    r.spreadLean ? `${r.spreadLean.side} ${r.spreadLean.num}` : null,
    r.totalLean ? `${r.totalLean.dir === "OVER" ? "Over" : "Under"} ${r.totalLean.num}` : null,
  ].filter(Boolean) as string[];
  return {
    sport: "NFL", href: "/nfl", away: r.away, home: r.home,
    spread: r.marketSpread ?? "—", total: numStr(r.marketTotal), suggest, off: r.off,
  };
}

function fromNCAAF(g: NcaafCardGame): Head {
  const ms = g.marketSpread; const ps = g.projSpread; const tl = g.totalLean;
  const suggest = [
    `${ps.fav} ${ps.num}`,
    tl ? `${tl.dir === "OVER" ? "Over" : "Under"} ${tl.num}` : null,
  ].filter(Boolean) as string[];
  return {
    sport: "NCAAF", href: "/ncaaf", away: g.away, home: g.home,
    spread: ms ? `${ms.fav} ${ms.num}` : "—",
    total: g.marketTotal !== null ? String(g.marketTotal) : "—", suggest, off: g.off,
  };
}

function Headliner({ rows }: { rows: Head[] }) {
  return (
    <section className="lp-card">
      <div className="lp-card__bar">
        <span className="lp-card__kicker">The headline read</span>
        <h2 className="lp-card__h">The Card — <span className="lp-gold">model vs market</span></h2>
        <p className="lp-card__sub">
          Our line-blind model&apos;s number beside the market&apos;s, on the week&apos;s marquee games —
          across every sport we cover. <b>Not a pick</b>: a read, published and graded in the open.
        </p>
      </div>
      <div className="lp-formwrap">
        <table className="lp-form">
          <thead>
            <tr>
              <th className="lp-sp">Sport</th><th className="hb-l">Game</th>
              <th>Market Spread</th><th>Market O/U</th><th>Our Model Suggests</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.sport}-${r.away}-${r.home}-${i}`} className={r.off ? "hb-off" : undefined}>
                <td className="lp-sp">
                  <a href={r.href} className={`lp-chip lp-chip--${r.sport.toLowerCase()}`}>{r.sport}</a>
                </td>
                <td className="hb-l">
                  <span className="hb-game">{r.away}<span className="hb-at">at</span>{r.home}</span>
                  {r.off && <span className="hb-dia hb-dia--end" aria-label="off consensus">◆</span>}
                </td>
                <td className="hb-num">{r.spread}</td>
                <td className="hb-num hb-tot">{r.total}</td>
                <td className="hb-suggest">
                  {r.suggest.length ? (
                    <span className="hb-sugwrap">
                      {r.suggest.map((s, j) => (
                        <span className="hb-sug" key={j}><span className="hb-sug__t">{s}</span></span>
                      ))}
                    </span>
                  ) : <span className="hb-leannone">even</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="lp-card__foot">
        <span className="lp-card__legend"><span className="hb-dia">◆</span> off-consensus — our model and the market disagree on the side.</span>
        <span className="lp-card__links">
          Full boards: <a href="/nfl">NFL →</a> <a href="/ncaaf">College Football →</a>
        </span>
      </div>
    </section>
  );
}

export default async function Landing() {
  let nfl: CardRow[] = [];
  let nflWeek = 0;
  try {
    const home = await fetchHome(SEASON);
    nfl = home.card; nflWeek = home.week;
  } catch { nfl = []; }

  const cfb = NCAAF_MODEL.card;
  const cfbFeatured = cfb.games.filter((g) => g.featured);

  // Headliner: a handful from each live sport, NFL first when it has a board.
  const rows: Head[] = [
    ...nfl.slice(0, 6).map(fromNFL),
    ...cfbFeatured.slice(0, 6).map(fromNCAAF),
  ];

  const liveCount = SPORTS.filter((s) => s.live).length;

  return (
    <main className="lp">
      <header className="lp-hero">
        <div className="lp-hero__eyes">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/seereyes.png" alt="" width={1983} height={793} />
        </div>
        <div className="lp-hero__body">
          <h1 className="lp-hero__wm">StatSeer</h1>
          <p className="lp-hero__tag">
            One model reads every game <b>line-blind</b> — then we show you exactly where it
            disagrees with the market, and the <b>best price</b> on every pick.
          </p>
          <div className="lp-stats">
            <div className="lp-stat"><span className="lp-stat__n">{liveCount}</span><span className="lp-stat__l">sports live</span></div>
            <div className="lp-stat"><span className="lp-stat__n">{nfl.length + cfb.games.length}</span><span className="lp-stat__l">games on the board</span></div>
            <div className="lp-stat"><span className="lp-stat__n">100%</span><span className="lp-stat__l">reads graded in public</span></div>
            <div className="lp-stat"><span className="lp-stat__n">$0</span><span className="lp-stat__l">to join</span></div>
          </div>
        </div>
      </header>

      <Headliner rows={rows} />

      {/* Pick a sport */}
      <section className="lp-sports">
        <h2 className="lp-h2">Pick your sport</h2>
        <div className="lp-sports__grid">
          {SPORTS.map((s) => s.live ? (
            <a key={s.key} href={s.home} className="lp-sport lp-sport--live">
              <span className="lp-sport__name">{s.label}</span>
              <span className="lp-sport__meta">
                {s.key === "nfl" ? (nflWeek ? `Week ${nflWeek} board` : "Full board") : `Week ${cfb.week} board`}
              </span>
              <span className="lp-sport__go">Enter →</span>
            </a>
          ) : (
            <span key={s.key} className="lp-sport lp-sport--soon">
              <span className="lp-sport__name">{s.label}</span>
              <span className="lp-sport__meta">building the model</span>
              <span className="lp-sport__soon">Soon</span>
            </span>
          ))}
        </div>
      </section>

      {/* What the app does */}
      <section className="lp-sections">
        <h2 className="lp-h2">Three tools, one board</h2>
        <p className="lp-sections__sub">
          Every sport is built the same way — three sections that each answer a different question.
        </p>
        <div className="hb-nav3__grid">
          <a href="/model" className="hb-nav3__c">
            <span className="hb-nav3__k">The Model</span>
            <span className="hb-nav3__d">Line-blind reads on every game, published and graded in public — with the calibration to check us. What the data says on its own.</span>
            <span className="hb-nav3__go">See The Model →</span>
          </a>
          <a href="/context" className="hb-nav3__c">
            <span className="hb-nav3__k">Context</span>
            <span className="hb-nav3__d">Upset Watch, situational factors, and fan analysis — everything around a game a single number can&apos;t capture. Informs, never votes.</span>
            <span className="hb-nav3__go">Read the Context →</span>
          </a>
          <a href="/lines" className="hb-nav3__c">
            <span className="hb-nav3__k">Value Finder</span>
            <span className="hb-nav3__d">Once you&apos;ve chosen a bet, the single best sportsbook for it — game lines, player props, and key-number sweet spots. Where the money is.</span>
            <span className="hb-nav3__go">Find the best price →</span>
          </a>
        </div>
      </section>

      <HomePromo />

      <details className="hb-slipf">
        <summary className="hb-slipf__bar">
          <span className="hb-slipf__ic" aria-hidden="true">🎟️</span>
          <span className="hb-slipf__h">Build your own bet slip — we tell you where to place it</span>
          <span className="hb-tav__right">
            <span className="hb-tav__ic hb-tav__ic--shut" aria-hidden="true">🍺</span>
            <span className="hb-tav__ic hb-tav__ic--open" aria-hidden="true">🍻</span>
            <span className="hb-tav__chev" aria-hidden="true">▾</span>
          </span>
        </summary>
        <div className="hb-slipf__body">
          <p className="hb-slipf__p">
            Tap any pick anywhere on StatSeer — a model suggestion, a moneyline, a spread, a prop — and it
            lands on your slip. When you&apos;re ready, we show you the <b>single best sportsbook for every
            leg</b>, and for a parlay, the <b>one book with the best combined price</b>. Same bets, better
            numbers — you never leave value on the table.
          </p>
          <div className="hb-slipf__steps">
            <div className="hb-slipf__step"><span className="hb-slipf__n">1</span><b>Add your picks</b><span>Tap to save anything you like as you read the board.</span></div>
            <div className="hb-slipf__step"><span className="hb-slipf__n">2</span><b>We shop it</b><span>StatSeer compares every book and finds the best price.</span></div>
            <div className="hb-slipf__step"><span className="hb-slipf__n">3</span><b>You place it</b><span>Bet at the book we name — the same wager at a better number.</span></div>
          </div>
          <div className="hb-slipf__cta">
            <a href="/lines" className="btn btn--primary">Start a slip →</a>
            <a href="/how" className="btn">How it works →</a>
          </div>
        </div>
      </details>

      <section className="hb-creed">
        <div className="hb-creed__h">Bet smarter. <b>Win more often.</b></div>
        <p className="hb-creed__p">
          StatSeer finds real edges and proves them in the open — published probabilities, an honest
          track record, and the best price on every pick. <a href="/how">How our model works →</a>
        </p>
      </section>
    </main>
  );
}
