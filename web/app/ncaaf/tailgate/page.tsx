import { Brand, FlowSteps, ContextSubnav } from "../../Nav";
import { NcaafSoon } from "../Soon";

// College Football — Context · Local Intelligence. Fan sentiment from team boards — needs a
// CFB fan-scan feed, which isn't wired yet. Clearly a color feature, never graded.
export const metadata = {
  title: "StatSeer — CFB Local Intelligence",
  description: "What college-football fans are saying on team boards — arriving once the CFB fan scan is wired.",
};

export default function Page() {
  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NCAAF</span> · Local Intelligence</>}
          art={{ src: "/fans.png?v=1", alt: "Local Intelligence" }}
        />
      </header>

      <FlowSteps active="context" base="ncaaf" />
      <ContextSubnav active="fan" base="ncaaf" />

      <NcaafSoon
        title="Local Intelligence — the word around the league"
        blurb="A read on which players the fan boards are heating up on and souring on, team by team — ammo for your own research, not our model and never graded. The NFL version scans team subreddits and forums; the college feed points at the same kind of sources."
        waitingOn="the CFB fan scan (team boards → extraction) being pointed at college programs."
        links={[
          { href: "/tailgate", label: "See the NFL Local Intelligence" },
          { href: "/ncaaf/model", label: "The Model" },
        ]}
      />

      <footer className="foot">
        <p>
          <b>Sentiment, not a signal.</b> For the numbers, see <a href="/ncaaf/model">The Model</a>; for measured
          context, <a href="/ncaaf/considerations">Special Considerations</a>.
        </p>
      </footer>
    </main>
  );
}
