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

      <main className="lp">
      {/* Why you'd use this — the first thing a new visitor sees, before any data. */}
      <section className="lp-pitch" aria-label="Why StatSeer">
        <h2 className="lp-pitch__h">You hit maybe <b>3 of 10</b>. Our goal is to make it <b>6</b>.</h2>
        <p className="lp-pitch__sub">
          Most bettors land around 3 in 10. StatSeer hands you the data to bet smarter — a{" "}
          <b>line-blind model</b> that reads every game before the market, the <b>single best price</b>{" "}
          across every book, and the <b>context</b> the sharps already know. Our whole goal is to move that number.
        </p>
        <div className="lp-pitch__bars">
          <div className="lp-pitch__row lp-pitch__row--a">
            <span className="lp-pitch__label">On your own</span>
            <span className="lp-pitch__dots">
              {Array.from({ length: 10 }, (_, i) => <span key={i} className={`lp-dot${i < 3 ? " lp-dot--on" : ""}`} />)}
            </span>
            <span className="lp-pitch__n">3<span className="lp-pitch__slash">/10</span></span>
          </div>
          <div className="lp-pitch__row lp-pitch__row--b">
            <span className="lp-pitch__label">With StatSeer</span>
            <span className="lp-pitch__dots lp-pitch__dots--good">
              {Array.from({ length: 10 }, (_, i) => <span key={i} className={`lp-dot${i < 6 ? " lp-dot--on lp-dot--good" : ""}`} />)}
            </span>
            <span className="lp-pitch__n">6<span className="lp-pitch__slash">/10</span> <small>the goal</small></span>
          </div>
        </div>
        <a href="#lp-board" className="btn btn--primary lp-pitch__cta">Show me this week&apos;s board →</a>
      </section>

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
