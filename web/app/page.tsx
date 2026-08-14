// Landing / home. Static — tells the StatSeer story and routes into the three
// sections. Game Lines lives at /lines; Value Finder's front door is /best.

export const dynamic = "force-static";

const SECTIONS = [
  {
    href: "/best", kicker: "Value Finder", q: "Where's the price wrong?",
    body: "The best number across books, key-number sweet spots, and this week's value plays. Mostly arithmetic — and where the money actually is.",
    cta: "This week's value plays",
  },
  {
    href: "/model", kicker: "The Model", q: "What does the data say on its own?",
    body: "Line-blind predictions, locked before kickoff and graded in public. The trust engine — check our record, don't take our word.",
    cta: "See the model",
  },
  {
    href: "/context", kicker: "Context", q: "What should you understand?",
    body: "Weather, travel, injuries, and the market's own read on each game. All true and useful — and never a pick driver.",
    cta: "Read the context",
  },
];

export default function Home() {
  return (
    <main className="home">
      <section className="hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-hero.png" alt="StatSeer" className="hero__logo" width={640} height={640} />
        <div className="hero__pitch">
          <h1 className="hero__h1">NFL betting analysis you can actually check.</h1>
          <p className="hero__lead">
            StatSeer is built on one idea: <b>verifiable trust</b>. Published probabilities. A public track
            record — <b>including the bad stretches</b>. Calibration anyone can audit. Not confident-sounding
            picks.
          </p>
          <div className="hero__cta">
            <a href="/best" className="btn btn--primary">This week&apos;s value plays →</a>
            <a href="/model" className="btn">See the model →</a>
          </div>
        </div>
      </section>

      <section className="hcards">
        {SECTIONS.map((s) => (
          <a key={s.href} href={s.href} className="hcard">
            <span className="hcard__k">{s.kicker}</span>
            <h2 className="hcard__q">{s.q}</h2>
            <p className="hcard__b">{s.body}</p>
            <span className="hcard__cta">{s.cta} →</span>
          </a>
        ))}
      </section>

      <section className="creed">
        <h2 className="creed__h">No locks. No hype. No tout.</h2>
        <p className="creed__p">
          Everyone else sells confidence. We show you where the value actually is, predict honestly, and
          publish a track record you can audit. A good bet is <b>+EV over time</b> — not a guarantee on Sunday.
          The three sections stay separate on purpose: combining zero-edge signals into one confident score is
          exactly the machine we refuse to build.
        </p>
      </section>

      <footer className="homefoot">
        <p>
          StatSeer is statistical analysis, not financial or betting advice. For adults of legal age only. If
          gambling stops being fun, help is available — call <b>1-800-GAMBLER</b>.
        </p>
      </footer>
    </main>
  );
}
