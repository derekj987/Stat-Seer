import { Brand } from "../Nav";

export const metadata = {
  title: "How Our Model Works — StatSeer",
  description: "Plain-English: what our AI/ML model does, and what 'success' really means for a betting model.",
};

// A ladder of what a win rate actually means at standard -110 odds. Break-even is
// 52.4%; everything credible sits just above it. 60% is the aspirational north star.
const LADDER = [
  { pct: 50, label: "Coin flip", note: "No edge. You lose the vig over time.", tone: "bad" },
  { pct: 52.4, label: "Break-even", note: "Exactly clears the −110 juice. Zero profit.", tone: "mid" },
  { pct: 54, label: "Sharp / professional", note: "Where sustained winners actually live.", tone: "good" },
  { pct: 57, label: "Elite", note: "Rare air over a full season.", tone: "great" },
  { pct: 60, label: "Our north star", note: "Aspirational — almost nobody holds this long-term.", tone: "star" },
];

export default function How() {
  return (
    <main className="wrap how2">
      <header className="masthead">
        <Brand sub="How our model works · plain English" />
      </header>

      <section className="how2__hero">
        <h1 className="how2__h1">No crystal ball. A calibrated guess you can check.</h1>
        <p className="how2__lead">
          StatSeer runs every game through machine-learning models, publishes a probability, and
          <b> locks it before kickoff</b> — then grades every one in public. Here&apos;s what that actually
          means, and what &ldquo;winning&rdquo; really looks like for a betting model (hint: it&apos;s a
          lot lower than the numbers touts shout).
        </p>
      </section>

      <section className="how2__block">
        <h2 className="how2__h2">What the model actually does</h2>
        <p>
          A machine-learning model isn&apos;t magic and it isn&apos;t a tipster with a hunch. It&apos;s a
          program that has read <b>thousands of past games</b> and learned which measurable things — team
          strength, snap shares, matchups, pace — have historically moved the outcome. For each new game it
          weighs those signals and outputs a <b>probability</b>: &ldquo;we think the Lions win this about 57%
          of the time.&rdquo; Not a lock. A number, with the reasoning attached.
        </p>
        <p>
          Two rules keep us honest. First, our game model is <b>line-blind</b> — it never sees the betting
          line before it predicts, so it can genuinely agree or disagree with Vegas instead of just echoing
          it. Second, every prediction is <b>published and frozen before kickoff</b>. We can&apos;t quietly
          rewrite a bad call after the fact; the track record is what it is.
        </p>
      </section>

      <section className="how2__block">
        <h2 className="how2__h2">Probabilities, not promises</h2>
        <p>
          The right way to read a 60% pick is: <b>if we made a hundred picks like this, about sixty should
          hit.</b> Which means forty won&apos;t — and that&apos;s not the model being wrong, that&apos;s the
          model being <b>calibrated</b>. A calibrated 60% that loses on Sunday is still a good process; a
          &ldquo;guaranteed lock&rdquo; that wins is still a bad one. Over a season, honest probabilities beat
          confident-sounding certainty every time.
        </p>
      </section>

      <section className="how2__block">
        <h2 className="how2__h2">What &ldquo;success&rdquo; actually means</h2>
        <p>
          Here&apos;s the number nobody advertises: at standard <b>−110</b> odds you have to win
          <b> 52.4%</b> of your bets just to break even — the extra juice is the house&apos;s cut. So the bar
          for &ldquo;good&rdquo; is far lower than it sounds:
        </p>
        <div className="ladder">
          {LADDER.map((r) => (
            <div className={`ladder__row ladder__row--${r.tone}`} key={r.pct}>
              <span className="ladder__pct">{r.pct}%</span>
              <div className="ladder__bar"><span style={{ width: `${(r.pct - 48) / (61 - 48) * 100}%` }} /></div>
              <div className="ladder__txt">
                <b className="ladder__label">{r.label}</b>
                <span className="ladder__note">{r.note}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="how2__fine">
          Sustained winners in this world hit roughly <b>53–55%</b>. A full season above <b>55%</b> is
          genuinely elite. <b>60% over the long haul is essentially a myth</b> — it&apos;s what people claim,
          not what holds up once the sample gets big. We aim for 60% on our strongest, highest-confidence
          spots as a north star, but we will always show you the <b>real</b> number, good stretch or bad.
        </p>
      </section>

      <section className="how2__block">
        <h2 className="how2__h2">How we grade ourselves (and how you can too)</h2>
        <ul className="how2__list">
          <li>
            <b>Calibration.</b> When we say 60%, do those picks actually win ~60%? We publish the reliability
            table so you can check it — not our word, the math.
          </li>
          <li>
            <b>Closing-line value.</b> Did we beat the number the market closed at? Consistently landing a
            better price than the close is the single best sign an edge is real, win or lose that day.
          </li>
          <li>
            <b>The bottom line.</b> Are we clearing that 52.4% break-even over time? That&apos;s the whole
            game — not one loud Sunday.
          </li>
        </ul>
      </section>

      <section className="how2__cta">
        <h2 className="how2__h2">No locks. No black box.</h2>
        <p>
          The AI and ML do the analysis; <b>you</b> decide what to bet. We show our probabilities, our
          reasoning, and a track record you can audit — never a guaranteed lock, never a number we can&apos;t
          back up.
        </p>
        <div className="how2__ctarow">
          <a href="/model" className="btn btn--primary">See the live model →</a>
          <a href="/" className="btn">Back to the board →</a>
        </div>
      </section>
    </main>
  );
}
