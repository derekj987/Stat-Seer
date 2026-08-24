import { Brand } from "../Nav";

// MLB — coming-soon landing. Baseball is on the SPORTS roadmap (Nav.tsx) but not yet
// built; this is the teaser home the MLB tab links to. The seer image lives here.
export const metadata = {
  title: "StatSeer — MLB (coming soon)",
  description:
    "Baseball is next on the StatSeer board — the same line-blind model, context, and value finder, built for MLB.",
};

export default function Page() {
  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">MLB</span> · Coming Soon</>} />
      </header>

      <section className="mlbhero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/newimage.jpg" alt="The StatSeer" className="mlbhero__img" width={1200} height={801} />
        <div className="mlbhero__body">
          <span className="mlbhero__tag">On deck</span>
          <h1 className="mlbhero__h">Baseball is coming to StatSeer.</h1>
          <p className="mlbhero__p">
            The same three sections you know from football — <b>The Model</b> (line-blind, published, and
            graded in public), <b>Context</b>, and the <b>Value Finder</b> — built for MLB run lines, totals,
            and player props. We turn a sport on only once its numbers clear our own bar, not before.
          </p>
          <p className="mlbhero__p mlbhero__p--muted">
            Until then, the live boards are <a href="/model">NFL</a> and{" "}
            <a href="/ncaaf/model">College Football</a>.
          </p>
        </div>
      </section>
    </main>
  );
}
