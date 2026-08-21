// Landing hub — the single front door. The flow (Model → Context → Value) with one
// NFL | NCAAF toggle leads; that toggle also drives the live snapshot below it (The
// Model Card, Players We Like, Upsets) — the views that used to live on separate sport
// homepages. Then the bet-slip + community invites. Sections live at /model, /ncaaf/model, …
import { fetchHome, type CardRow, type UpsetRow, type PlayerPick } from "@/lib/home";
import { NCAAF_MODEL, type NcaafCardGame, type NcaafUpset } from "./ncaaf/model-data";
import { SPORTS } from "./Nav";
import LandingHub from "./LandingHub";
import HomePromo from "./HomePromo";

export const metadata = {
  title: "StatSeer — the model vs the market, every sport",
  description: "See the Model, read the Room, find the Value — NFL and College Football. Published probabilities, an honest track record, and the best price on every pick.",
};

const SEASON = 2026;

function Betslip() {
  return (
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
          leg</b>, and for a parlay, the <b>one book with the best combined price</b>.
        </p>
        <div className="hb-slipf__steps">
          <div className="hb-slipf__step"><span className="hb-slipf__n">1</span><b>Add your picks</b><span>Tap to save anything you like as you read the board.</span></div>
          <div className="hb-slipf__step"><span className="hb-slipf__n">2</span><b>We shop it</b><span>StatSeer compares every book and finds the best price.</span></div>
          <div className="hb-slipf__step"><span className="hb-slipf__n">3</span><b>You place it</b><span>Bet at the book we name — the same wager at a better number.</span></div>
        </div>
        <p className="hb-slipf__lead">Start on a game-lines board — tap a line to add it to your slip:</p>
        <div className="hb-slipf__cta">
          <a href="/lines" className="btn btn--primary">NFL Game Lines →</a>
          <a href="/ncaaf/lines" className="btn btn--primary">College Football Game Lines →</a>
          <a href="/how" className="btn">How it works →</a>
        </div>
      </div>
    </details>
  );
}

export default async function Landing({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const initialSport = sp.sport === "ncaaf" ? "ncaaf" : "nfl";

  let nfl: { week: number; card: CardRow[]; upsets: UpsetRow[]; players: PlayerPick[] } = { week: 0, card: [], upsets: [], players: [] };
  try {
    const home = await fetchHome(SEASON);
    nfl = { week: home.week, card: home.card, upsets: home.upsets, players: home.players };
  } catch { /* board not up yet */ }

  const cfb = NCAAF_MODEL.card;
  const ncaaf = {
    week: cfb.week,
    games: cfb.games as unknown as NcaafCardGame[],
    upsets: cfb.upsets as unknown as NcaafUpset[],
  };
  const liveCount = SPORTS.filter((s) => s.live).length;
  const totalGames = nfl.card.length + cfb.games.length;

  return (
    <main className="lp">
      <header className="lp-hero">
        <div className="lp-hero__banner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/seereyes.png" alt="" className="lp-hero__img" width={1983} height={793} />
        </div>
        <h1 className="lp-hero__wm">StatSeer</h1>
        <p className="lp-hero__tag">
          One model reads every game <b>line-blind</b>, then shows you exactly where it disagrees with the
          market — and the <b>best price</b> on every pick.
        </p>
        <div className="lp-stats">
          <div className="lp-stat"><span className="lp-stat__n">{liveCount}</span><span className="lp-stat__l">sports live</span></div>
          <div className="lp-stat"><span className="lp-stat__n">{totalGames}</span><span className="lp-stat__l">games on the board</span></div>
          <div className="lp-stat"><span className="lp-stat__n">100%</span><span className="lp-stat__l">reads graded in public</span></div>
          <div className="lp-stat lp-stat--wide"><span className="lp-stat__n">Line-blind</span><span className="lp-stat__l">every read, before the line</span></div>
        </div>
      </header>

      <LandingHub initialSport={initialSport} nfl={nfl} ncaaf={ncaaf} />

      <Betslip />
      <HomePromo />

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
