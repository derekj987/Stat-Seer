import { Brand } from "../Nav";

// MLB — the section's home. The MLB tab links straight to /mlb/model (Nav.tsx SPORTS), so this
// page is reached by URL; it used to be the "coming soon" teaser and said so long after the
// Model and the Value Finder were live. Now it is the section map: the same three sections as
// football, with Context the one still on deck. The seer image stays.
export const metadata = {
  title: "StatSeer — MLB",
  description:
    "Baseball on StatSeer — the line-blind game and player models, and the Value Finder for run lines, totals and player props.",
};

export default function Page() {
  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">MLB</span> · Home</>} />
      </header>

      <section className="mlbhero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/newimage.jpg" alt="The StatSeer" className="mlbhero__img" width={1200} height={801} />
        <div className="mlbhero__body">
          <span className="mlbhero__tag">Live</span>
          <h1 className="mlbhero__h">Baseball, the StatSeer way.</h1>
          <p className="mlbhero__p">
            The same three sections you know from football. <b><a href="/mlb/model">The Model</a></b> —
            line-blind winners, run lines and totals, and calibrated hit, home-run and strikeout
            probabilities, published before first pitch and graded after. The <b>Value Finder</b> —{" "}
            <a href="/mlb/lines">Line Shopping</a> across every book, <a href="/mlb/props">Player Props</a>{" "}
            with the single best price, and <a href="/mlb/best">Sweet Spots</a>: the one-run game, the
            whole-number total, and whether a run line or a moneyline is the cheaper way to back a team.
          </p>
          <p className="mlbhero__p mlbhero__p--muted">
            <b>Context</b> — weather, umpires, the lineup card — is still on deck. Football&apos;s is live on{" "}
            <a href="/considerations">NFL</a> and <a href="/ncaaf/considerations">College Football</a>.
          </p>
        </div>
      </section>
    </main>
  );
}
