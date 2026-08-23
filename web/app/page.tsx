// Landing hub — the single front door. The flow (Model → Context → Value) with one
// NFL | NCAAF toggle leads; that toggle also drives the live snapshot below it (The
// Model Card, Players We Like, Upsets) — the views that used to live on separate sport
// homepages. Then the bet-slip + community invites. Sections live at /model, /ncaaf/model, …
import { fetchHome, type CardRow, type UpsetRow, type PlayerPick } from "@/lib/home";
import { NCAAF_MODEL, type NcaafCardGame, type NcaafUpset } from "./ncaaf/model-data";
import LandingHub from "./LandingHub";
import HomePromo from "./HomePromo";
import { BetslipPromo } from "./Nav";

export const metadata = {
  title: "StatSeer — the model vs the market, every sport",
  description: "See the Model, read the Room, find the Value — NFL and College Football. Published probabilities, an honest track record, and the best price on every pick.",
};

const SEASON = 2026;

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
  return (
    <>
      {/* Full-bleed hero — a body-level banner so the seer's eyes span the whole
          viewport width; the wordmark now sits over the bottom-left of the image. */}
      <header className="lp-hero">
        <div className="lp-hero__banner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/seereyes.jpg" alt="" className="lp-hero__img" width={1600} height={640} />
          <h1 className="lp-hero__wm">StatSeer</h1>
        </div>
      </header>

      {/* Value prop PINNED to the left edge like the "Message Us" widget — a slim tab that
          slides the panel out OVER the page when clicked. Out of the content flow entirely. */}
      <div className="lp-drawer">
        <input type="checkbox" id="lp-pitch-toggle" className="lp-drawer__chk" defaultChecked aria-hidden="true" tabIndex={-1} />
        <label htmlFor="lp-pitch-toggle" className="lp-drawer__tab" title="Why StatSeer">
          <span className="lp-drawer__tabtext">Raise your hit rate</span>
          <span className="lp-drawer__chev" aria-hidden="true">›</span>
        </label>
        <label htmlFor="lp-pitch-toggle" className="lp-drawer__scrim" aria-hidden="true" />
        <aside className="lp-drawer__panel" aria-label="Why StatSeer">
          <label htmlFor="lp-pitch-toggle" className="lp-drawer__close" title="Close" aria-label="Close">✕</label>
          <section className="lp-pitch">
            <h2 className="lp-pitch__h">Raise your <b>hit rate</b>.</h2>
            <p className="lp-pitch__sub">
              In a typical year, about <b>60% of bettors finish down</b>. The average wins just{" "}
              <b>48% of their bets</b> — short of the <b>52.4%</b> you need just to <b>break even</b>. (Sportsbooks
              take a cut on every bet, so the break-even line sits above 50%.) Only <b>~3% turn a lasting profit</b>.{" "}
              <b className="lp-pitch__key">StatSeer is built to move you past that line:</b> <b>line-blind projections</b>, the <b>single best price</b>{" "}
              on every pick, and the <b>context</b> that moves markets. Every call graded against the closing line.
            </p>
            <div className="lp-pitch__bars">
              <div className="lp-pitch__row lp-pitch__row--a">
                <span className="lp-pitch__label">Average bettor</span>
                <span className="lp-pitch__bar"><span className="lp-pitch__fill" style={{ ["--w" as string]: "48%" }} /></span>
                <span className="lp-pitch__n">48<span className="lp-pitch__slash">%</span></span>
              </div>
              <div className="lp-pitch__row lp-pitch__row--b">
                <span className="lp-pitch__label">Break-even line</span>
                <span className="lp-pitch__bar"><span className="lp-pitch__fill lp-pitch__fill--good" style={{ ["--w" as string]: "52.4%" }} /></span>
                <span className="lp-pitch__n">52.4<span className="lp-pitch__slash">%</span></span>
              </div>
            </div>
            <p className="lp-pitch__cap">Only about 3% of bettors clear it. That&apos;s the line we&apos;re built to move you past.</p>
            <label htmlFor="lp-pitch-toggle" className="btn btn--primary lp-pitch__cta">Got it — show me the board →</label>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/crest.png?v=3" alt="" className="lp-pitch__crest" width={120} height={128} />
          </section>
        </aside>
      </div>

      {/* Value Finder PINNED to the RIGHT edge — mirrors the left drawer, slides an example
          betslip out over the page. Collapsed by default (a slim tab); click to slide out. */}
      <div className="vf-drawer">
        <input type="checkbox" id="vf-toggle" className="vf-drawer__chk" aria-hidden="true" tabIndex={-1} />
        <label htmlFor="vf-toggle" className="vf-drawer__tab" title="Value Finder">
          <span className="vf-drawer__chev" aria-hidden="true">‹</span>
          <span className="vf-drawer__tabtext">Find the best price</span>
        </label>
        <label htmlFor="vf-toggle" className="vf-drawer__scrim" aria-hidden="true" />
        <aside className="vf-drawer__panel" aria-label="Value Finder">
          <label htmlFor="vf-toggle" className="vf-drawer__close" title="Close" aria-label="Close">✕</label>
          <section className="vf-pitch">
            <h2 className="vf-pitch__h">Find the <b>best price</b>.</h2>
            <p className="vf-pitch__sub">
              <b>Value Finder</b> shops every pick across <b>~10 sportsbooks</b> and shows you the single
              best place to bet each one — plus the <b>one book that pays the most</b> on your whole parlay.
              Same bets, better price.
            </p>

            <div className="vf-slip">
              <div className="vf-slip__tag">Example slip · 5 picks</div>
              <ul className="vf-slip__legs">
                <li className="vf-slip__leg">
                  <span className="vf-slip__bet">NE <b>+3.5</b><small>NE @ SEA</small></span>
                  <span className="vf-slip__book">FanDuel</span>
                  <span className="vf-slip__odds">-108</span>
                </li>
                <li className="vf-slip__leg">
                  <span className="vf-slip__bet">Under <b>48.5</b><small>SF @ LA</small></span>
                  <span className="vf-slip__book">DraftKings</span>
                  <span className="vf-slip__odds">-105</span>
                </li>
                <li className="vf-slip__leg">
                  <span className="vf-slip__bet">D. Maye <b>o223.5</b><small>Pass Yds</small></span>
                  <span className="vf-slip__book">FanDuel</span>
                  <span className="vf-slip__odds">-110</span>
                </li>
                <li className="vf-slip__leg">
                  <span className="vf-slip__bet">C. McCaffrey <b>o59.5</b><small>Rush Yds</small></span>
                  <span className="vf-slip__book">BetMGM</span>
                  <span className="vf-slip__odds">-112</span>
                </li>
                <li className="vf-slip__leg">
                  <span className="vf-slip__bet">P. Nacua <b>o5.5</b><small>Rec</small></span>
                  <span className="vf-slip__book">Caesars</span>
                  <span className="vf-slip__odds">-120</span>
                </li>
              </ul>
              <div className="vf-slip__best">
                <div className="vf-slip__besth">Best book for this slip: <b>FanDuel</b></div>
                <div className="vf-slip__bestrow"><span>Parlay all 5 at FanDuel</span><b>+2280</b></div>
                <div className="vf-slip__bestrow"><span>Each leg at its own best book</span><b>+2391</b></div>
                <p className="vf-slip__bestnote">
                  Two ways to play — Value Finder shows you both: put the whole parlay on <b>one book</b>
                  (FanDuel pays the most here), or bet each leg <b>separately</b> at its own best price for a
                  slightly bigger payout.
                </p>
              </div>
            </div>

            <a href="/lines" className="btn btn--primary vf-pitch__cta">Open the Value Finder →</a>
          </section>
        </aside>
      </div>

      <main className="lp">
      <LandingHub initialSport={initialSport} nfl={nfl} ncaaf={ncaaf} />

      <BetslipPromo />
      <HomePromo />

      <section className="lp-tagline">
        <p className="lp-hero__tag">
          One model reads every game <b>line-blind</b>, then shows you exactly where it disagrees with the
          market — and the <b>best price</b> on every pick.
        </p>
        <div className="lp-stats">
          <div className="lp-stat"><span className="lp-stat__n">100%</span><span className="lp-stat__l">reads graded in public</span></div>
          <div className="lp-stat lp-stat--wide"><span className="lp-stat__n">Line-blind</span><span className="lp-stat__l">every read, before the line</span></div>
        </div>
      </section>

      <section className="hb-creed">
        <div className="hb-creed__h">Bet smarter. <b>Win more often.</b></div>
        <p className="hb-creed__p">
          StatSeer finds real edges and proves them in the open — published probabilities, an honest
          track record, and the best price on every pick. <a href="/how">How our model works →</a>
        </p>
      </section>
      </main>
    </>
  );
}
