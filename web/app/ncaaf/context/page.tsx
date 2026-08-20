import { Brand, FlowSteps, SportTabs, ContextSubnav } from "../../Nav";
import { NcaafSoon } from "../Soon";

// College Football — Context · Upset Watch (Context landing). Flags underdogs the
// model backs against the market — needs live odds + this week's model reads, so it
// turns on once the odds capture feeds the site. The durable context is one tab over.
export const metadata = {
  title: "StatSeer — CFB Upset Watch",
  description: "College-football underdogs our model backs against the market — arriving with the season's odds.",
};

export default function Page() {
  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Context · College Football · Upset Watch`} />
      </header>

      <FlowSteps active="context" base="ncaaf" />
      <SportTabs active="ncaaf" />
      <ContextSubnav active="upset" base="ncaaf" />

      <NcaafSoon
        title="Upset Watch — underdogs the model backs"
        blurb="When our line-blind rating makes a game closer than the market does — or flips the side outright — the underdog shows up here, with our win probability beside the market's. It&apos;s an alert, not a pick. It fires only when a live line and our read diverge, so it needs this week's odds on the board."
        waitingOn="live NCAAF odds feeding the site each week (the rating itself is already built and validated)."
        links={[
          { href: "/ncaaf/considerations", label: "Special Considerations (live now)" },
          { href: "/ncaaf", label: "The Model" },
        ]}
      />

      <footer className="foot">
        <p>
          <b>Context informs; it doesn&apos;t vote.</b> The measured context — home field and league strength — is
          live on <a href="/ncaaf/considerations">Special Considerations</a>.
        </p>
      </footer>
    </main>
  );
}
