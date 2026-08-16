// Landing / home. Static — tells the StatSeer story and teaches the 1-2-3 flow.
// Game Lines lives at /lines; Value Finder's front door is /best.
import AccountPromo from "./AccountPromo";

export const dynamic = "force-static";

const STEPS = [
  {
    n: "1", href: "/model", kicker: "The Model", q: "Start here — what does the data say?",
    body: "Our line-blind read on every game: calibrated win probabilities, locked before kickoff, graded in public. Find the games you agree with.",
    cta: "See the model",
  },
  {
    n: "2", href: "/context", kicker: "Upset Watch", q: "Pressure-test it.",
    body: "Where our model likes the underdog, plus the situational factors — weather, referee crews, roster moves. We flag upset risk; we never fake an adjusted number.",
    cta: "Check the upset watch",
  },
  {
    n: "3", href: "/best", kicker: "Value Finder", q: "Place it.",
    body: "Made your picks? Here's the best number across books, the key-number sweet spots, and exactly where to bet each one. This is where the money is.",
    cta: "Find the value",
  },
];

export default function Home() {
  return (
    <main className="home">
      <aside className="home__banner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-hero.png" alt="StatSeer — See the edge. Trust the data." className="home__bannerimg" width={543} height={724} />
      </aside>

      <div className="home__content">
      <AccountPromo />
      <section className="hero">
        <div className="hero__pitch">
          <h1 className="hero__h1">Betting analysis you can actually check.</h1>
          <p className="hero__lead">
            StatSeer is built on one idea: <b>verifiable trust</b>. Published probabilities. A public track
            record — <b>including the bad stretches</b>. Calibration anyone can audit. We walk you through it
            in <b>three honest steps</b>.
          </p>
          <div className="hero__cta">
            <a href="/model" className="btn btn--primary">Start with the model →</a>
            <a href="/best" className="btn">Jump to value plays →</a>
          </div>
        </div>
      </section>

      <section className="how">
        <h2 className="how__h">How it works — three steps</h2>
        <div className="hcards">
          {STEPS.map((s) => (
            <a key={s.href} href={s.href} className="hcard">
              <span className="hcard__top">
                <span className="hcard__n">{s.n}</span>
                <span className="hcard__k">{s.kicker}</span>
              </span>
              <h3 className="hcard__q">{s.q}</h3>
              <p className="hcard__b">{s.body}</p>
              <span className="hcard__cta">{s.cta} →</span>
            </a>
          ))}
        </div>
      </section>

      <section className="slipfeat">
        <div className="slipfeat__text">
          <span className="slipfeat__eyebrow">Only on StatSeer</span>
          <h2 className="slipfeat__h">Build your slip. We tell you where to place it.</h2>
          <p className="slipfeat__p">
            Tap the bets you like on any page to build a slip. StatSeer finds the <b>single best
            sportsbook for each pick</b> — and the <b>one book with the best price for the whole parlay</b> —
            so you never leave money on the table by betting everything in one app.
          </p>
          <a href="/lines" className="btn btn--primary">Build a slip →</a>
        </div>
        <div className="slipfeat__demo">
          <div className="slipdemo" aria-hidden="true">
            <div className="slipdemo__h">Your slip</div>
            <div className="slipdemo__leg">
              <span className="slipdemo__pick">BUF −2.5</span>
              <span className="slipdemo__book">best at <b>DraftKings</b> −110</span>
            </div>
            <div className="slipdemo__leg">
              <span className="slipdemo__pick">SEA/SF Over 47.5</span>
              <span className="slipdemo__book">best at <b>DraftKings</b> −108</span>
            </div>
            <div className="slipdemo__leg">
              <span className="slipdemo__pick">Mahomes 275+ pass yds</span>
              <span className="slipdemo__book">best at <b>DraftKings</b> +115</span>
            </div>
            <div className="slipdemo__leg">
              <span className="slipdemo__pick">Bijan 70+ rush yds</span>
              <span className="slipdemo__book">best at <b>DraftKings</b> −105</span>
            </div>
            <div className="slipdemo__leg">
              <span className="slipdemo__pick">Jefferson anytime TD</span>
              <span className="slipdemo__book">best at <b>FanDuel</b> +140</span>
            </div>
            <div className="slipdemo__leg">
              <span className="slipdemo__pick">Ravens ML</span>
              <span className="slipdemo__book">best at <b>BetMGM</b> −150</span>
            </div>
            <div className="slipdemo__parlay">
              <span>Parlay · all 6</span>
              <span className="slipdemo__odds">best at <b>DraftKings</b> +6070</span>
            </div>
            <div className="slipdemo__save">$10 → $617 — the best combined price across books</div>
          </div>
        </div>
      </section>

      <section className="creed">
        <h2 className="creed__h">No locks. No hype. No tout.</h2>
        <p className="creed__p">
          Everyone else sells confidence. We show you where the value actually is, predict honestly, and
          publish a track record you can audit. A good bet is <b>+EV over time</b> — not a guarantee on Sunday.
          The three steps stay separate on purpose: combining zero-edge signals into one confident score is
          exactly the machine we refuse to build.
        </p>
      </section>
      </div>
    </main>
  );
}
