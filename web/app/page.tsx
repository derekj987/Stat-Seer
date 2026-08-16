// Landing / home. Static — the restructured flow: review the AI/ML analysis, build
// your slip, and the Value Finder tells you where to place it.
import AccountPromo from "./AccountPromo";

export const dynamic = "force-static";

const STEPS = [
  {
    n: "1", href: "/model", kicker: "Review the analysis", q: "Find picks you jive with.",
    body: "Read our line-blind ML model, the upset & context watch, and AI-distilled fan buzz. Agree with a read? That's a pick.",
    cta: "See the analysis",
  },
  {
    n: "2", href: "/lines", kicker: "Build your slip", q: "Collect as you read.",
    body: "See something you like on any page — a model read, a fan sleeper, a line, a prop? Add it to your slip. It follows you everywhere.",
    cta: "Start a slip",
  },
  {
    n: "3", href: "/best", kicker: "The Value Finder", q: "We find the value.",
    body: "Your slip becomes a Value Finder: the single best sportsbook for each pick, plus the key-number sweet spots. Exactly where to place it.",
    cta: "See best bets",
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
          <span className="hero__eyebrow">AI + ML model analysis</span>
          <h1 className="hero__h1">Review the analysis. Build your slip. <em>We find the value.</em></h1>
          <p className="hero__lead">
            StatSeer runs every game through <b>calibrated ML models</b> and distills the fan boards with
            <b> AI</b> — then publishes the probabilities and a public track record you can audit. You bring the
            reads you believe in; the <b>Value Finder</b> handles the shopping.
          </p>
          <div className="hero__cta">
            <a href="/model" className="btn btn--primary">Start with the model →</a>
            <a href="/tailgate" className="btn">See what fans are saying →</a>
          </div>
        </div>
      </section>

      <section className="how">
        <h2 className="how__h">How it works — three steps</h2>
        <div className="hcards">
          {STEPS.map((s) => (
            <a key={s.kicker} href={s.href} className="hcard">
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
          <span className="slipfeat__eyebrow">The payoff</span>
          <h2 className="slipfeat__h">Your slip becomes a Value Finder.</h2>
          <p className="slipfeat__p">
            Everything you collect — a model read, a fan sleeper, a line, a prop — lands in <b>one slip</b>.
            StatSeer finds the <b>single best sportsbook for each pick</b> and the <b>key-number sweet spots</b>,
            so you never leave money on the table by betting everything in one app.
          </p>
          <a href="/lines" className="btn btn--primary">Start a slip →</a>
        </div>
        <div className="slipfeat__demo">
          <div className="slipdemo" aria-hidden="true">
            <div className="slipdemo__h">Value Finder · your picks</div>
            <div className="slipdemo__leg">
              <span className="slipdemo__pick"><span className="slipdemo__grp">MODEL</span>DET −7</span>
              <span className="slipdemo__book">best at <b>DraftKings</b> −135</span>
            </div>
            <div className="slipdemo__leg">
              <span className="slipdemo__pick"><span className="slipdemo__grp">FAN</span>Tank Dell O 62.5</span>
              <span className="slipdemo__book">best at <b>FanDuel</b> −112</span>
            </div>
            <div className="slipdemo__leg">
              <span className="slipdemo__pick"><span className="slipdemo__grp">LINES</span>SEA/SF Over 47.5</span>
              <span className="slipdemo__book">best at <b>BetMGM</b> −130</span>
            </div>
            <div className="slipdemo__leg">
              <span className="slipdemo__pick"><span className="slipdemo__grp">PROP</span>Mahomes 250+ pass yds</span>
              <span className="slipdemo__book">best at <b>DraftKings</b> −140</span>
            </div>
            <div className="slipdemo__save">DraftKings covers the most in one app — or split each to its best book</div>
          </div>
        </div>
      </section>

      <section className="creed">
        <h2 className="creed__h">No locks. No hype. No tout.</h2>
        <p className="creed__p">
          The AI and ML do the analysis; <b>you</b> decide what to bet. We show you where the value actually is,
          predict honestly, and publish a track record you can audit — <b>never a black box, never a guaranteed
          lock</b>. A good bet is +EV over time, not a promise on Sunday.
        </p>
      </section>
      </div>
    </main>
  );
}
